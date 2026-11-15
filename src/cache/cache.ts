import { createHash } from "crypto";
import { createReadStream, promises as fs } from "fs";
import * as path from "path";
import type { Alignment, ParsedLrc, ReleaseIdentity } from "../shared/types";

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

export async function sha256String(value: string): Promise<string> {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function alignmentCacheKey(
  videoSha256: string,
  release: ReleaseIdentity,
  alignerVersion: string,
): string {
  const identity = `${release.program}::${release.release}`;
  return `${videoSha256}__${identity}__${alignerVersion}`;
}

export function lrcCacheKey(lrcSha256: string): string {
  return `lrc__${lrcSha256}`;
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function readAlignment(key: string, cacheDir: string): Promise<Alignment | null> {
  return readJson<Alignment>(path.join(cacheDir, "alignments", `${key}.json`));
}

export async function writeAlignment(
  key: string,
  alignment: Alignment,
  cacheDir: string,
): Promise<void> {
  await writeJson(path.join(cacheDir, "alignments", `${key}.json`), alignment);
}

export async function readParsedLrc(lrcSha256: string, cacheDir: string): Promise<ParsedLrc | null> {
  return readJson<ParsedLrc>(path.join(cacheDir, "lrcs", `${lrcCacheKey(lrcSha256)}.json`));
}

export async function writeParsedLrc(
  lrcSha256: string,
  lrc: ParsedLrc,
  cacheDir: string,
): Promise<void> {
  await writeJson(path.join(cacheDir, "lrcs", `${lrcCacheKey(lrcSha256)}.json`), lrc);
}

export async function clearCache(cacheDir: string): Promise<void> {
  await Promise.all([
    fs.rm(path.join(cacheDir, "alignments"), { recursive: true, force: true }),
    fs.rm(path.join(cacheDir, "lrcs"), { recursive: true, force: true }),
  ]);
}
