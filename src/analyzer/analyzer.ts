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
import { buildEnvelope, crossCorrelation, matchFingerprints, type Fingerprint } from "./align";
import { parseLrc } from "./lrc";
import type {
  Alignment,
  AlignmentMethod,
  ConfidenceSummary,
  MatchReport,
  MatchStatus,
  ParsedLrc,
  ReleaseFolder,
  ReleaseIdentity,
  TrackAlignment,
  TrackMatchResult,
  VideoSource,
} from "../shared/types";

export const CROSSFADE_TOLERANCE_SEC = 10;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const ACCEPTED_CONFIDENCE_THRESHOLD = 0.7;
const HAMMING_MAX_DISTANCE = 32;
const DEFAULT_CHUNK_SEC = 2;
const FALLBACK_FRAME_DURATION_SEC = 0.25;
const SAMPLE_RATE = 44100;

export interface AnalyzeInput {
  videoPath: string;
  source: VideoSource;
  fileName: string;
  release: ReleaseIdentity;
  releaseFolder: ReleaseFolder;
}

export interface AnalyzeOutput {
  alignment: Alignment;
  matchReport: MatchReport;
  cached: boolean;
  lrc: ParsedLrc | null;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      resolve({ code: null, stdout, stderr });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    });
  });
}

async function extractMonoRaw(
  videoPath: string,
  ffmpegPath: string,
  rawPath: string,
): Promise<number[] | null> {
  const result = await runProcess(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-f",
    "s16le",
    rawPath,
  ]);
  if (result.code !== 0) return null;
  const buffer = await fs.promises.readFile(rawPath);
  const samples: number[] = [];
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    samples.push(view.getInt16(i, true) / 32768);
  }
  return samples;
}

interface FpcalcChunk {
  timestamp: number;
  duration: number;
  fingerprint: number[] | string;
}

function parseHexFingerprint(hex: string): number[] {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const values: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    values.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return values;
}

async function runFpcalc(filePath: string, fpcalcPath: string, chunkSec: number): Promise<Fingerprint[]> {
  const result = await runProcess(fpcalcPath, [
    "-json",
    "-raw",
    "-length",
    "86400",
    "-chunk",
    String(chunkSec),
    filePath,
  ]);
  const fingerprints: Fingerprint[] = [];
  if (result.code !== 0) return fingerprints;
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: FpcalcChunk;
    try {
      parsed = JSON.parse(trimmed) as FpcalcChunk;
    } catch {
      continue;
    }
    const hash = Array.isArray(parsed.fingerprint)
      ? parsed.fingerprint.map((v) => Number(v))
      : typeof parsed.fingerprint === "string"
        ? parseHexFingerprint(parsed.fingerprint)
        : [];
    if (hash.length > 0) {
      fingerprints.push({ timeSec: parsed.timestamp, hash });
    }
  }
  return fingerprints;
}

function buildMatchResult(
  trackNo: number,
  status: MatchStatus,
  videoStartSec: number | null,
  confidence: number | null,
  method: AlignmentMethod | null,
  reason: string,
): TrackMatchResult {
  return { trackNo, status, videoStartSec, confidence, method, reason };
}

function buildMatchReportFromAlignment(alignment: Alignment): MatchReport {
  const results = alignment.tracks.map((t) => {
    const status: MatchStatus = t.confidence >= ACCEPTED_CONFIDENCE_THRESHOLD ? "ok" : "low";
    return buildMatchResult(
      t.trackNo,
      status,
      t.videoStartSec,
      t.confidence,
      t.method,
      status === "ok" ? "ok" : "low confidence",
    );
  });
  return {
    videoPath: alignment.video.filePath,
    release: alignment.release,
    results,
  };
}

export class Analyzer {
  private readonly ffmpegPath: string;
  private readonly fpcalcPath: string;
  private readonly cacheDir: string;
  private readonly alignerVersion: string;
  private readonly now: () => Date;

  constructor(options: {
    ffmpegPath?: string;
    fpcalcPath?: string;
    cacheDir?: string;
    alignerVersion?: string;
    now?: () => Date;
  } = {}) {
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.fpcalcPath = options.fpcalcPath ?? "fpcalc";
    this.cacheDir = options.cacheDir ?? "";
    this.alignerVersion = options.alignerVersion ?? "0.1.0";
    this.now = options.now ?? (() => new Date());
  }

  async analyzeVideo(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const videoSha256 = await sha256File(input.videoPath);
    const key = alignmentCacheKey(videoSha256, input.release, this.alignerVersion);
    const cached = await readAlignment(key, this.cacheDir);
    if (cached !== null) {
      const lrcPath = input.releaseFolder.tracks[0]?.lrcPath ?? "";
      const lrc = lrcPath.length > 0 ? await this.loadLrc(lrcPath) : null;
      return {
        alignment: cached,
        matchReport: buildMatchReportFromAlignment(cached),
        cached: true,
        lrc,
      };
    }

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lmsync-"));
    const rawPath = path.join(tempDir, "mono.raw");
    try {
      const videoSamples = await extractMonoRaw(input.videoPath, this.ffmpegPath, rawPath);
      const videoDurationSec = videoSamples === null ? 0 : videoSamples.length / SAMPLE_RATE;
      const videoEnv = videoSamples === null ? [] : buildEnvelope(videoSamples, SAMPLE_RATE);
      const videoFps: Fingerprint[] = videoSamples
        ? await runFpcalc(input.videoPath, this.fpcalcPath, DEFAULT_CHUNK_SEC)
        : [];

      const accepted: TrackAlignment[] = [];
      const matchResults: TrackMatchResult[] = [];
      const ordered = [...input.releaseFolder.tracks].sort((a, b) => a.trackNo - b.trackNo);
      let previousStart: number | null = null;
      let firstLrcPath: string | null = null;

      for (const track of ordered) {
        const lrc = await this.loadLrc(track.lrcPath);
        if (lrc !== null && firstLrcPath === null) firstLrcPath = track.lrcPath;
        if (lrc === null) {
          matchResults.push(buildMatchResult(track.trackNo, "unmatched", null, null, null, "missing LRC file"));
          continue;
        }
        const trackSamples = await extractMonoRaw(track.mp3Path, this.ffmpegPath, rawPath);
        const trackFps = trackSamples
          ? await runFpcalc(track.mp3Path, this.fpcalcPath, DEFAULT_CHUNK_SEC)
          : [];
        const trackEnv = trackSamples === null ? [] : buildEnvelope(trackSamples, SAMPLE_RATE);

        let videoStartSec: number | null = null;
        let confidence = 0;
        let method: AlignmentMethod = "chromaprint";
        let reason = "no match";

        const best =
          trackFps.length > 0 && videoFps.length > 0
            ? matchFingerprints(videoFps, trackFps, { maxDistance: HAMMING_MAX_DISTANCE })
            : null;
        if (best !== null && best.confidence >= LOW_CONFIDENCE_THRESHOLD) {
          videoStartSec = best.offsetSec;
          confidence = best.confidence;
          method = "chromaprint";
          reason = "ok";
        } else {
          const cross =
            videoEnv.length > 0 && trackEnv.length > 0
              ? crossCorrelation(videoEnv, trackEnv, FALLBACK_FRAME_DURATION_SEC)
              : null;
          if (cross !== null && cross.confidence >= LOW_CONFIDENCE_THRESHOLD) {
            videoStartSec = cross.offsetSec;
            confidence = cross.confidence;
            method = "cross-correlation";
            reason = "ok";
          }
        }

        if (videoStartSec === null) {
          matchResults.push(buildMatchResult(track.trackNo, "unmatched", null, null, null, reason));
          continue;
        }
        if (videoStartSec < -CROSSFADE_TOLERANCE_SEC || videoStartSec > videoDurationSec + CROSSFADE_TOLERANCE_SEC) {
          matchResults.push(
            buildMatchResult(track.trackNo, "unmatched", null, null, null, "offset outside video duration"),
          );
          continue;
        }
        if (previousStart !== null && videoStartSec <= previousStart) {
          matchResults.push(
            buildMatchResult(track.trackNo, "unmatched", null, null, null, "offset not strictly increasing"),
          );
          continue;
        }

        accepted.push({
          trackNo: track.trackNo,
          mp3Path: track.mp3Path,
          lrcPath: track.lrcPath,
          videoStartSec,
          mp3StartSec: 0,
          confidence,
          method,
        });
        previousStart = videoStartSec;
      }

      const alignment = this.buildAlignment(input, videoSamples, accepted);
      await writeAlignment(key, alignment, this.cacheDir);
      const matchReport: MatchReport = {
        videoPath: input.videoPath,
        release: input.release,
        results: matchResults,
      };
      const lrc = firstLrcPath === null ? null : await this.loadLrc(firstLrcPath);
      return { alignment, matchReport, cached: false, lrc };
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }

  async loadLrc(lrcPath: string): Promise<ParsedLrc | null> {
    if (lrcPath.length === 0) return null;
    const digest = await sha256File(lrcPath);
    const cached = await readParsedLrc(digest, this.cacheDir);
    if (cached !== null) return cached;
    const text = await fs.promises.readFile(lrcPath, "utf8");
    const parsed = parseLrc(text, lrcPath);
    await writeParsedLrc(digest, parsed, this.cacheDir);
    return parsed;
  }

  async getAlignment(key: string): Promise<Alignment | null> {
    return readAlignment(key, this.cacheDir);
  }

  async getParsedLrcBySha256(lrcSha256: string): Promise<ParsedLrc | null> {
    return readParsedLrc(lrcSha256, this.cacheDir);
  }

  private buildAlignment(
    input: AnalyzeInput,
    videoSamples: number[] | null,
    accepted: TrackAlignment[],
  ): Alignment {
    const tracks: TrackAlignment[] = accepted.map((t, index) => ({
      ...t,
      mp3StartSec: index === 0 ? 0 : accepted[index - 1].videoStartSec,
    }));
    return {
      version: 1,
      video: {
        source: input.source,
        fileName: input.fileName,
        filePath: input.videoPath,
        durationSec: videoSamples === null ? 0 : videoSamples.length / SAMPLE_RATE,
      },
      release: input.release,
      tracks,
      generatedAt: this.now().toISOString(),
      alignerVersion: this.alignerVersion,
    };
  }

  getConfidenceSummary(input: AnalyzeInput, alignment: Alignment): ConfidenceSummary {
    const results = buildMatchReportFromAlignment(alignment);
    const confidences = alignment.tracks.map((t) => t.confidence);
    const okCount = results.results.filter((r) => r.status === "ok").length;
    const lowCount = results.results.filter((r) => r.status === "low").length;
    const avg = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
    return {
      release: input.release,
      videoSource: input.source,
      videoFileName: input.fileName,
      videoPath: input.videoPath,
      trackCount: alignment.tracks.length,
      matchedCount: okCount + lowCount,
      lowConfidenceCount: lowCount,
      unmatchedCount: Math.max(0, results.results.length - okCount - lowCount),
      averageConfidence: avg,
    };
  }
}
