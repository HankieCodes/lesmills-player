import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  alignmentCacheKey,
  readAlignment,
  readParsedLrc,
  sha256File,
  writeAlignment,
  writeParsedLrc,
} from "../cache/cache";
import { crossCorrelation, matchFingerprintSeries } from "./align";
import { parseLrc } from "./lrc";
import { CROSSFADE_TOLERANCE_SEC, GOOD_CONFIDENCE, MIN_CONFIDENCE, statusForConfidence } from "./status";
import type {
  Alignment,
  AlignmentMethod,
  MatchReport,
  MatchStatus,
  ParsedLrc,
  ReleaseFolder,
  ReleaseIdentity,
  TrackAlignment,
  TrackMatchResult,
  VideoSource,
} from "../shared/types";

export const ALIGNER_VERSION = "0.2.0";

const WAV_RATE = 11025;
const ENVELOPE_FRAME_SAMPLES = 2756;
const ENVELOPE_FRAME_SEC = ENVELOPE_FRAME_SAMPLES / WAV_RATE;

export interface AnalyzeInput {
  videoPath: string;
  source: VideoSource;
  fileName: string;
  release: ReleaseIdentity;
  releaseFolder: ReleaseFolder;
}

export interface AnalyzeProgress {
  phase: "hashing" | "decoding-video" | "track" | "done";
  message: string;
  /** 0..1 */
  fraction: number;
}

export interface AnalyzeOutput {
  alignment: Alignment;
  matchReport: MatchReport;
  cached: boolean;
  /** Parsed LRC per trackNo for every track present in the alignment. */
  lrcs: Record<number, ParsedLrc>;
}

export interface AnalyzerOptions {
  ffmpegPath?: string;
  fpcalcPath?: string;
  cacheDir: string;
  alignerVersion?: string;
  now?: () => Date;
  onProgress?: (progress: AnalyzeProgress) => void;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    const out: Buffer[] = [];
    let stderr = "";
    let settled = false;
    child.stdout?.on("data", (d: Buffer) => out.push(d));
    child.stderr?.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      resolve({ code: null, stdout: "", stderr: `${stderr}\n${err.message}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr });
    });
  });
}

/** Parse a WAV file's `data` chunk location. */
async function wavDataRange(handle: fs.promises.FileHandle): Promise<{ start: number; length: number }> {
  const header = Buffer.alloc(4096);
  const { bytesRead } = await handle.read(header, 0, header.length, 0);
  let pos = 12;
  while (pos + 8 <= bytesRead) {
    const id = header.toString("ascii", pos, pos + 4);
    const size = header.readUInt32LE(pos + 4);
    if (id === "data") return { start: pos + 8, length: size };
    pos += 8 + size + (size % 2);
  }
  throw new Error("WAV data chunk not found");
}

/** Stream a mono 16-bit WAV and reduce it to a mean-absolute-amplitude envelope. */
async function wavEnvelope(wavPath: string): Promise<{ envelope: Float32Array; durationSec: number }> {
  const handle = await fs.promises.open(wavPath, "r");
  try {
    const stat = await handle.stat();
    const { start, length } = await wavDataRange(handle);
    // ffmpeg writing to a file leaves the data size as 0xFFFFFFFF-ish when it cannot seek; clamp to file size.
    const dataBytes = Math.min(length, stat.size - start);
    const totalSamples = Math.floor(dataBytes / 2);
    const frames = Math.ceil(totalSamples / ENVELOPE_FRAME_SAMPLES);
    const envelope = new Float32Array(frames);
    const chunk = Buffer.alloc(ENVELOPE_FRAME_SAMPLES * 2 * 64);
    let sampleIndex = 0;
    let position = start;
    while (sampleIndex < totalSamples) {
      const want = Math.min(chunk.length, (totalSamples - sampleIndex) * 2);
      const { bytesRead } = await handle.read(chunk, 0, want, position);
      if (bytesRead < 2) break;
      position += bytesRead;
      for (let i = 0; i + 1 < bytesRead; i += 2, sampleIndex++) {
        envelope[Math.floor(sampleIndex / ENVELOPE_FRAME_SAMPLES)] += Math.abs(chunk.readInt16LE(i)) / 32768;
      }
    }
    for (let f = 0; f < frames; f++) envelope[f] /= ENVELOPE_FRAME_SAMPLES;
    return { envelope, durationSec: totalSamples / WAV_RATE };
  } finally {
    await handle.close();
  }
}

function matchResult(
  trackNo: number,
  status: MatchStatus,
  videoStartSec: number | null,
  confidence: number | null,
  method: AlignmentMethod | null,
  reason: string,
): TrackMatchResult {
  return { trackNo, status, videoStartSec, confidence, method, reason };
}

function reportFromAlignment(alignment: Alignment): MatchReport {
  return {
    videoPath: alignment.video.filePath,
    release: alignment.release,
    results: alignment.tracks.map((t) =>
      matchResult(t.trackNo, statusForConfidence(t.confidence), t.videoStartSec, t.confidence, t.method, "cached"),
    ),
  };
}

export class Analyzer {
  private readonly ffmpegPath: string;
  private readonly fpcalcPath: string;
  private readonly cacheDir: string;
  private readonly alignerVersion: string;
  private readonly now: () => Date;
  private readonly onProgress: (progress: AnalyzeProgress) => void;

  constructor(options: AnalyzerOptions) {
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.fpcalcPath = options.fpcalcPath ?? "fpcalc";
    this.cacheDir = options.cacheDir;
    this.alignerVersion = options.alignerVersion ?? ALIGNER_VERSION;
    this.now = options.now ?? (() => new Date());
    this.onProgress = options.onProgress ?? (() => undefined);
  }

  async getAlignment(key: string): Promise<Alignment | null> {
    return readAlignment(key, this.cacheDir);
  }

  async getParsedLrcBySha256(lrcSha256: string): Promise<ParsedLrc | null> {
    return readParsedLrc(lrcSha256, this.cacheDir);
  }

  async loadLrc(lrcPath: string): Promise<ParsedLrc | null> {
    try {
      const digest = await sha256File(lrcPath);
      const cached = await readParsedLrc(digest, this.cacheDir);
      if (cached !== null) return cached;
      const parsed = parseLrc(await fs.promises.readFile(lrcPath, "utf8"), lrcPath);
      await writeParsedLrc(digest, parsed, this.cacheDir);
      return parsed;
    } catch {
      return null;
    }
  }

  private async decodeToWav(input: string, output: string): Promise<void> {
    const result = await runProcess(this.ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(WAV_RATE),
      "-c:a",
      "pcm_s16le",
      output,
    ]);
    if (result.code !== 0) {
      throw new Error(`ffmpeg could not decode ${path.basename(input)}: ${result.stderr.trim() || "unknown error"}`);
    }
  }

  private async fingerprint(wavPath: string): Promise<number[]> {
    const result = await runProcess(this.fpcalcPath, ["-json", "-raw", "-length", "0", wavPath]);
    if (result.code !== 0) {
      throw new Error(`fpcalc failed for ${path.basename(wavPath)}: ${result.stderr.trim() || "unknown error"}`);
    }
    const parsed = JSON.parse(result.stdout) as { fingerprint?: number[] };
    if (!Array.isArray(parsed.fingerprint) || parsed.fingerprint.length === 0) {
      throw new Error(`fpcalc returned no fingerprint for ${path.basename(wavPath)}`);
    }
    return parsed.fingerprint;
  }

  async analyzeVideo(input: AnalyzeInput): Promise<AnalyzeOutput> {
    this.onProgress({ phase: "hashing", message: "Hashing video…", fraction: 0 });
    const videoSha256 = await sha256File(input.videoPath);
    const key = alignmentCacheKey(videoSha256, input.release, this.alignerVersion);
    const cached = await readAlignment(key, this.cacheDir);
    if (cached !== null) {
      this.onProgress({ phase: "done", message: "Loaded from cache", fraction: 1 });
      return {
        alignment: cached,
        matchReport: reportFromAlignment(cached),
        cached: true,
        lrcs: await this.lrcsFor(cached.tracks),
      };
    }

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lmsync-"));
    try {
      const tracks = [...input.releaseFolder.tracks].sort((a, b) => a.trackNo - b.trackNo);
      this.onProgress({ phase: "decoding-video", message: "Decoding video audio…", fraction: 0.02 });
      const videoWav = path.join(tempDir, "video.wav");
      await this.decodeToWav(input.videoPath, videoWav);
      const videoFp = await this.fingerprint(videoWav);
      let videoEnvelope: { envelope: Float32Array; durationSec: number } | null = null;
      const getVideoEnvelope = async () => (videoEnvelope ??= await wavEnvelope(videoWav));
      const videoDurationSec = (await getVideoEnvelope()).durationSec;

      const accepted: TrackAlignment[] = [];
      const results: TrackMatchResult[] = [];
      let previousStart = -Infinity;

      for (const [index, track] of tracks.entries()) {
        this.onProgress({
          phase: "track",
          message: `Matching track ${track.trackNo} (${index + 1}/${tracks.length})…`,
          fraction: 0.1 + (0.9 * index) / Math.max(1, tracks.length),
        });
        try {
          const trackWav = path.join(tempDir, `track-${track.trackNo}.wav`);
          await this.decodeToWav(track.mp3Path, trackWav);
          const trackFp = await this.fingerprint(trackWav);

          let startSec: number | null = null;
          let confidence = 0;
          let method: AlignmentMethod = "chromaprint";
          const fp = matchFingerprintSeries(videoFp, trackFp);
          if (fp !== null && fp.confidence >= MIN_CONFIDENCE) {
            startSec = fp.offsetSec;
            confidence = fp.confidence;
          } else {
            const trackEnv = await wavEnvelope(trackWav);
            const cc = crossCorrelation((await getVideoEnvelope()).envelope, trackEnv.envelope, ENVELOPE_FRAME_SEC);
            if (cc !== null && cc.confidence >= GOOD_CONFIDENCE) {
              startSec = cc.offsetSec;
              confidence = cc.confidence;
              method = "cross-correlation";
            }
          }

          if (startSec === null) {
            results.push(matchResult(track.trackNo, "unmatched", null, null, null, "no confident match"));
          } else if (startSec < -CROSSFADE_TOLERANCE_SEC || startSec > videoDurationSec) {
            results.push(matchResult(track.trackNo, "unmatched", null, null, null, "offset outside video"));
          } else if (startSec <= previousStart) {
            results.push(matchResult(track.trackNo, "unmatched", null, null, null, "offset not after previous track"));
          } else {
            const videoStartSec = Math.max(0, startSec);
            accepted.push({
              trackNo: track.trackNo,
              mp3Path: track.mp3Path,
              lrcPath: track.lrcPath,
              videoStartSec,
              mp3StartSec: 0,
              confidence,
              method,
            });
            previousStart = startSec;
            results.push(
              matchResult(track.trackNo, statusForConfidence(confidence), videoStartSec, confidence, method, "matched"),
            );
          }
        } catch (error) {
          results.push(
            matchResult(
              track.trackNo,
              "unmatched",
              null,
              null,
              null,
              error instanceof Error ? error.message : String(error),
            ),
          );
        }
      }

      const alignment: Alignment = {
        version: 1,
        video: {
          source: input.source,
          fileName: input.fileName,
          filePath: input.videoPath,
          durationSec: videoDurationSec,
        },
        release: input.release,
        tracks: accepted,
        generatedAt: this.now().toISOString(),
        alignerVersion: this.alignerVersion,
      };
      await writeAlignment(key, alignment, this.cacheDir);
      this.onProgress({ phase: "done", message: "Done", fraction: 1 });
      return {
        alignment,
        matchReport: { videoPath: input.videoPath, release: input.release, results },
        cached: false,
        lrcs: await this.lrcsFor(accepted),
      };
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async lrcsFor(tracks: TrackAlignment[]): Promise<Record<number, ParsedLrc>> {
    const lrcs: Record<number, ParsedLrc> = {};
    for (const track of tracks) {
      const lrc = await this.loadLrc(track.lrcPath);
      if (lrc !== null) lrcs[track.trackNo] = lrc;
    }
    return lrcs;
  }
}
