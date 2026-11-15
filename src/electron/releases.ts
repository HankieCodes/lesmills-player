import * as fs from "fs";
import * as path from "path";
import type { ReleaseFolder, ReleaseIdentity, ReleaseTrack } from "../shared/types";

const TRACK_EXTENSIONS = new Set(["mp3", "mp3"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "mkv", "webm", "avi"]);

export function parseReleaseFromFolderName(folderName: string): ReleaseIdentity {
  const upper = folderName.trim().toUpperCase();
  const trailing = /(?:^|[^A-Z0-9])([A-Z0-9]+)[^0-9]*?([0-9]{2,4})[^A-Z0-9]*$/.exec(upper);
  if (trailing) {
    const program = (trailing[1] ?? "").trim();
    const release = trailing[2];
    if (program.length > 0) {
      return { program, release };
    }
  }
  const fallback = /^([A-Z0-9]+)[_-]?([0-9]{2,4})$/i.exec(folderName.trim());
  if (fallback) {
    return { program: fallback[1].toUpperCase(), release: fallback[2] };
  }
  return { program: "UNKNOWN", release: "0" };
}

async function listFiles(dir: string, exts: Set<string>): Promise<string[]> {
  const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of dirents) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) continue;
    const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
    if (exts.has(ext)) files.push(full);
  }
  return files;
}

async function findMasterclassVideo(
  dir: string,
  program: string,
  release: string,
): Promise<string | null> {
  const videos = await listFiles(dir, VIDEO_EXTENSIONS);
  if (videos.length === 0) return null;
  const needle = `${program}${release}`.toUpperCase();
  const masterclass = videos.find((v) => v.toUpperCase().includes(needle)) ?? videos.find((v) => /masterclass|instruction/i.test(v));
  return masterclass ?? (videos.length === 1 ? videos[0] : null);
}

async function scanDir(
  sourceFolder: string,
  depth: number,
  found: ReleaseFolder[],
): Promise<void> {
  if (depth > 4) return;
  let dirents;
  try {
    dirents = await fs.promises.readdir(sourceFolder, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of dirents) {
    if (!entry.isDirectory()) continue;
    const child = path.join(sourceFolder, entry.name);
    const childFiles = await listFiles(child, TRACK_EXTENSIONS);
    const lrcs = await listFiles(child, new Set(["lrc"]));
    const hasPair = childFiles.some((mp3) => {
      const base = path.basename(mp3, ".mp3");
      return lrcs.some((lrc) => path.basename(lrc) === `${base}.lrc`);
    });
    if (hasPair && lrcs.length > 0) {
      const identity = parseReleaseFromFolderName(entry.name);
      const mp3s = childFiles.map((mp3) => {
        const base = path.basename(mp3, path.extname(mp3));
        const trackNo = Number(/^(\d+)/.exec(base)?.[1] ?? "0");
        return {
          trackNo,
          mp3Path: mp3,
          lrcPath: path.join(path.dirname(mp3), `${base}.lrc`),
        } satisfies ReleaseTrack;
      });
      mp3s.sort((a, b) => a.trackNo - b.trackNo);
      found.push({
        folderPath: child,
        program: identity.program,
        release: identity.release,
        tracks: mp3s,
        masterclassVideoPath: await findMasterclassVideo(child, identity.program, identity.release),
      });
    }
    await scanDir(child, depth + 1, found);
  }
}

export async function scanReleaseFolders(sourceFolders: string[]): Promise<ReleaseFolder[]> {
  const releases: ReleaseFolder[] = [];
  for (const folder of sourceFolders) {
    const absolute = path.resolve(folder);
    await scanDir(absolute, 0, releases);
  }
  return releases;
}
