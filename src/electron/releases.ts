import * as fs from "fs";
import * as path from "path";
import type { ReleaseFolder, ReleaseIdentity, ReleaseTrack } from "../shared/types";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"]);
const MAX_DEPTH = 4;

/** "Les Mills BodyPump 131", "BODYPUMP_131", "BP-131" → program + release number. */
export function parseReleaseFromFolderName(folderName: string): ReleaseIdentity {
  const cleaned = folderName
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  const match = /^(.*?)\s*(\d{2,3})(?!\d)[^\d]*$/.exec(cleaned);
  if (match === null) return { program: "UNKNOWN", release: "0" };
  const program = match[1]
    .replace(/^les mills\s*/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
  return { program: program.length > 0 ? program : "UNKNOWN", release: match[2] };
}

async function listDir(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function trackNumber(baseName: string): number | null {
  const m = /^\s*(\d+)/.exec(baseName);
  return m === null ? null : Number(m[1]);
}

async function inspectDir(dir: string): Promise<ReleaseFolder | null> {
  const entries = await listDir(dir);
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const lrcByBase = new Map<string, string>();
  for (const name of files) {
    if (path.extname(name).toLowerCase() === ".lrc") lrcByBase.set(path.basename(name, path.extname(name)), name);
  }
  const tracks: ReleaseTrack[] = [];
  for (const name of files) {
    if (path.extname(name).toLowerCase() !== ".mp3") continue;
    const base = path.basename(name, path.extname(name));
    const lrc = lrcByBase.get(base);
    const trackNo = trackNumber(base);
    if (lrc === undefined || trackNo === null) continue;
    tracks.push({ trackNo, mp3Path: path.join(dir, name), lrcPath: path.join(dir, lrc) });
  }
  if (tracks.length === 0) return null;
  tracks.sort((a, b) => a.trackNo - b.trackNo);

  const videos = files.filter((f) => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()));
  const identity = parseReleaseFromFolderName(path.basename(dir));
  const masterclass = videos.find((v) => /master/i.test(v)) ?? (videos.length === 1 ? videos[0] : undefined);
  return {
    folderPath: dir,
    program: identity.program,
    release: identity.release,
    tracks,
    masterclassVideoPath: masterclass === undefined ? null : path.join(dir, masterclass),
  };
}

async function walk(dir: string, depth: number, found: ReleaseFolder[]): Promise<void> {
  const release = await inspectDir(dir);
  if (release !== null) found.push(release);
  if (depth >= MAX_DEPTH) return;
  for (const entry of await listDir(dir)) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) await walk(path.join(dir, entry.name), depth + 1, found);
  }
}

/** Find release folders (MP3s with same-named LRCs) in and below the given folders. Read-only. */
export async function scanReleaseFolders(sourceFolders: string[]): Promise<ReleaseFolder[]> {
  const found: ReleaseFolder[] = [];
  for (const folder of sourceFolders) await walk(path.resolve(folder), 0, found);
  return found.sort((a, b) => a.folderPath.localeCompare(b.folderPath));
}
