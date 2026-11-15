import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  cachedSha256,
  readFeatures,
  readMatch,
  readParsedLrc,
  writeAlignment,
  writeFeatures,
  writeMatch,
  writeParsedLrc,
  type AudioFeatures,
  type TrackMatchRecord,
} from "../cache/cache";
import { crossCorrelation, matchFingerprintSeries } from "./align";
import { parseLrc } from "./lrc";
import { CROSSFADE_TOLERANCE_SEC, GOOD_CONFIDENCE, MIN_CONFIDENCE, statusForConfidence } from "./status";
import type {
  Alignment,
  AlignmentTrack,
  AnalyzeTrackInput,
  MatchReport,
  ParsedLrc,
  TrackMatchResult,
} from "../shared/types";

export const ALIGNER_VERSION = "0.3.0";

const WAV_RATE = 11025;
const ENVELOPE_FRAME_SAMPLES = 2756;
const ENVELOPE_FRAME_SEC = ENVELOPE_FRAME_SAMPLES / WAV_RATE;

export interface AnalyzeInput {
  videoPath: string;
  fileName: string;
  /** Tracks that have an MP3. Order does not matter. */
  tracks: AnalyzeTrackInput[];
}

export interface AnalyzeProgress {
  videoPath: string;
  message: string;
  /** 0..1 */
  fraction: number;
}

export interface AnalyzeOutput {
  alignment: Alignment;
  matchReport: MatchReport;
  /** How many tracks were answered from the cache without touching the audio. */
  cachedTracks: number;
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
async function wavEnvelope(wavPath: string): Promise<{ envelope: number[]; durationSec: number }> {
  const handle = await fs.promises.open(wavPath, "r");
  try {
    const stat = await handle.stat();
    const { start, length } = await wavDataRange(handle);
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
    return { envelope: Array.from(envelope, (v) => Math.round(v * 1e5) / 1e5), durationSec: totalSamples / WAV_RATE };
  } finally {
    await handle.close();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  /** Parsed LRC for a file, cached by content hash. */
  async loadLrc(lrcPath: string): Promise<ParsedLrc | null> {
    try {
      const digest = await cachedSha256(lrcPath, this.cacheDir);
      const cached = await readParsedLrc(digest, this.cacheDir);
      if (cached !== null) return { ...cached, path: lrcPath };
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

  /** Features of a video soundtrack or MP3, from the cache when possible. */
  private async features(inputPath: string, sha: string, tempDir: string): Promise<AudioFeatures> {
    const cached = await readFeatures(sha, this.alignerVersion, this.cacheDir);
    if (cached !== null) return cached;
    const wav = path.join(tempDir, `${sha}.wav`);
    await this.decodeToWav(inputPath, wav);
    try {
      const fingerprint = await this.fingerprint(wav);
      const { envelope, durationSec } = await wavEnvelope(wav);
      const features: AudioFeatures = { durationSec, fingerprint, envelope, envelopeFrameSec: ENVELOPE_FRAME_SEC };
      await writeFeatures(sha, this.alignerVersion, features, this.cacheDir);
      return features;
    } finally {
      await fs.promises.rm(wav, { force: true });
    }
  }

  private matchTrack(video: AudioFeatures, track: AudioFeatures): TrackMatchRecord {
    const fp = matchFingerprintSeries(video.fingerprint, track.fingerprint);
    if (fp !== null && fp.confidence >= MIN_CONFIDENCE) {
      return { startSec: fp.offsetSec, confidence: fp.confidence, method: "chromaprint", reason: "matched" };
    }
    const cc = crossCorrelation(video.envelope, track.envelope, video.envelopeFrameSec);
    if (cc !== null && cc.confidence >= GOOD_CONFIDENCE) {
      return { startSec: cc.offsetSec, confidence: cc.confidence, method: "cross-correlation", reason: "matched" };
    }
    return { startSec: null, confidence: fp?.confidence ?? 0, method: null, reason: "no confident match" };
  }

  /**
   * Align the given tracks to a video. Per (video, MP3) results are cached by content hash, so
   * adding one MP3 to a workspace only costs that MP3; the rest is read back from the cache.
   */
  async analyzeVideo(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const { videoPath } = input;
    const report = (message: string, fraction: number) => this.onProgress({ videoPath, message, fraction });
    const tracks = [...input.tracks].sort((a, b) => a.trackNo - b.trackNo);

    report("Reading video…", 0);
    const videoSha = await cachedSha256(videoPath, this.cacheDir);
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lmsync-"));
    try {
      let videoFeatures: AudioFeatures | null = null;
      const getVideoFeatures = async () => {
        if (videoFeatures === null) {
          report("Decoding video audio…", 0.05);
          videoFeatures = await this.features(videoPath, videoSha, tempDir);
        }
        return videoFeatures;
      };

      const records = new Map<string, TrackMatchRecord>();
      const failures = new Map<string, string>();
      let cachedTracks = 0;
      for (const [index, track] of tracks.entries()) {
        report(`Matching track ${track.trackNo} (${index + 1}/${tracks.length})…`, 0.1 + (0.9 * index) / tracks.length);
        try {
          const mp3Sha = await cachedSha256(track.mp3Path, this.cacheDir);
          const cached = await readMatch(videoSha, mp3Sha, this.alignerVersion, this.cacheDir);
          if (cached !== null) {
            records.set(track.trackKey, cached);
            cachedTracks++;
            continue;
          }
          const video = await getVideoFeatures();
          const mp3 = await this.features(track.mp3Path, mp3Sha, tempDir);
          const record = this.matchTrack(video, mp3);
          await writeMatch(videoSha, mp3Sha, this.alignerVersion, record, this.cacheDir);
          records.set(track.trackKey, record);
        } catch (error) {
          failures.set(track.trackKey, errorMessage(error));
        }
      }

      const durationSec = (await getVideoFeatures()).durationSec;
      const accepted: AlignmentTrack[] = [];
      const results: TrackMatchResult[] = [];
      let previousStart = -Infinity;
      for (const track of tracks) {
        const fail = (reason: string): TrackMatchResult => ({
          trackKey: track.trackKey,
          trackNo: track.trackNo,
          status: "unmatched",
          videoStartSec: null,
          confidence: null,
          method: null,
          reason,
        });
        const record = records.get(track.trackKey);
        if (record === undefined) {
          results.push(fail(failures.get(track.trackKey) ?? "not analyzed"));
        } else if (record.startSec === null) {
          results.push(fail(record.reason));
        } else if (record.startSec < -CROSSFADE_TOLERANCE_SEC || record.startSec > durationSec) {
          results.push(fail("offset outside the video"));
        } else if (record.startSec <= previousStart) {
          results.push(fail("offset not after the previous track"));
        } else {
          const videoStartSec = Math.max(0, record.startSec);
          previousStart = record.startSec;
          accepted.push({
            trackKey: track.trackKey,
            trackNo: track.trackNo,
            mp3Path: track.mp3Path,
            videoStartSec,
            mp3StartSec: 0,
            confidence: record.confidence,
            method: record.method ?? "chromaprint",
          });
          results.push({
            trackKey: track.trackKey,
            trackNo: track.trackNo,
            status: statusForConfidence(record.confidence),
            videoStartSec,
            confidence: record.confidence,
            method: record.method,
            reason: "matched",
          });
        }
      }

      const alignment: Alignment = {
        version: 2,
        video: { fileName: input.fileName, filePath: videoPath, durationSec },
        tracks: accepted,
        generatedAt: this.now().toISOString(),
        alignerVersion: this.alignerVersion,
      };
      await writeAlignment(videoSha, this.alignerVersion, alignment, this.cacheDir);
      report("Done", 1);
      return { alignment, matchReport: { videoPath, results }, cachedTracks };
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
}
