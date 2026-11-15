import { createHash } from "crypto";
import { createReadStream, promises as fs } from "fs";
import * as path from "path";
import type { Alignment, AlignmentMethod, ParsedLrc } from "../shared/types";

/** The cache lives in the Electron userData dir; LMSYNC_CACHE_DIR overrides it (tests, scripts). */
export function getCacheDir(userDataDir: string): string {
  const fromEnv = process.env.LMSYNC_CACHE_DIR;
  return fromEnv && fromEnv.length > 0 ? fromEnv : userDataDir;
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Write via a temp file so a crash never leaves half a JSON file behind. */
export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value), "utf8");
  await fs.rename(tmp, filePath);
}

const HEX = /^[0-9a-f]{64}$/;

/** Cache entries are named from hex digests and version strings only, which are safe on every OS. */
function entryPath(cacheDir: string, folder: string, ...parts: string[]): string {
  for (const part of parts) {
    if (!HEX.test(part) && !/^\d+\.\d+\.\d+$/.test(part)) throw new Error(`Unsafe cache key: ${part}`);
  }
  return path.join(cacheDir, "cache", folder, `${parts.join("__")}.json`);
}

/** SHA-256 of a file, remembered by path + size + mtime so large videos are hashed once. */
export async function cachedSha256(filePath: string, cacheDir: string): Promise<string> {
  const stat = await fs.stat(filePath);
  const key = `${path.resolve(filePath)}|${stat.size}|${Math.round(stat.mtimeMs)}`;
  const indexPath = path.join(cacheDir, "cache", "hashes.json");
  const index = (await readJson<Record<string, string>>(indexPath)) ?? {};
  if (HEX.test(index[key] ?? "")) return index[key];
  const digest = await sha256File(filePath);
  const latest = (await readJson<Record<string, string>>(indexPath)) ?? {};
  latest[key] = digest;
  await writeJson(indexPath, latest);
  return digest;
}

/** Fingerprint series + energy envelope of one audio source (a video's soundtrack or an MP3). */
export interface AudioFeatures {
  durationSec: number;
  fingerprint: number[];
  envelope: number[];
  envelopeFrameSec: number;
}

export function readFeatures(sha: string, version: string, cacheDir: string): Promise<AudioFeatures | null> {
  return readJson<AudioFeatures>(entryPath(cacheDir, "features", sha, version));
}

export function writeFeatures(sha: string, version: string, features: AudioFeatures, cacheDir: string): Promise<void> {
  return writeJson(entryPath(cacheDir, "features", sha, version), features);
}

/** Result of matching one MP3 against one video. Cached even when nothing matched. */
export interface TrackMatchRecord {
  startSec: number | null;
  confidence: number;
  method: AlignmentMethod | null;
  reason: string;
}

export function readMatch(
  videoSha: string,
  mp3Sha: string,
  version: string,
  cacheDir: string,
): Promise<TrackMatchRecord | null> {
  return readJson<TrackMatchRecord>(entryPath(cacheDir, "matches", videoSha, mp3Sha, version));
}

export function writeMatch(
  videoSha: string,
  mp3Sha: string,
  version: string,
  record: TrackMatchRecord,
  cacheDir: string,
): Promise<void> {
  return writeJson(entryPath(cacheDir, "matches", videoSha, mp3Sha, version), record);
}

/** The assembled alignment JSON (PLAN §4.1) for a video; informational, rebuilt on every analysis. */
export function writeAlignment(videoSha: string, version: string, alignment: Alignment, cacheDir: string): Promise<void> {
  return writeJson(entryPath(cacheDir, "alignments", videoSha, version), alignment);
}

export function readParsedLrc(lrcSha: string, cacheDir: string): Promise<ParsedLrc | null> {
  return readJson<ParsedLrc>(entryPath(cacheDir, "lrcs", lrcSha));
}

export function writeParsedLrc(lrcSha: string, lrc: ParsedLrc, cacheDir: string): Promise<void> {
  return writeJson(entryPath(cacheDir, "lrcs", lrcSha), lrc);
}

export async function clearCache(cacheDir: string): Promise<void> {
  await fs.rm(path.join(cacheDir, "cache"), { recursive: true, force: true });
}
