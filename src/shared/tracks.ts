import { stemOf } from "./files";
import type { Track } from "./types";

export function trackKeyOf(filePath: string): string {
  return stemOf(filePath).normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function leadingNumber(stem: string): number | null {
  const match = /^\s*(\d{1,3})(?!\d)/.exec(stem);
  return match === null ? null : Number(match[1]);
}

/**
 * Pair MP3 and LRC files into tracks by identical file name stem (case-insensitive).
 * A track exists as soon as either file is present. Numbered files keep their number; the
 * rest get max+1 in the order added. Result is sorted by track number, then order added.
 */
export function buildTracks(mp3Paths: string[], lrcPaths: string[]): Track[] {
  const byKey = new Map<string, { label: string; mp3Path: string | null; lrcPath: string | null; order: number }>();
  const upsert = (filePath: string, field: "mp3Path" | "lrcPath") => {
    const key = trackKeyOf(filePath);
    const existing = byKey.get(key);
    if (existing) {
      existing[field] ??= filePath;
      return;
    }
    byKey.set(key, { label: stemOf(filePath), mp3Path: null, lrcPath: null, order: byKey.size, [field]: filePath });
  };
  mp3Paths.forEach((p) => upsert(p, "mp3Path"));
  lrcPaths.forEach((p) => upsert(p, "lrcPath"));

  const entries = [...byKey.entries()];
  let maxNumber = Math.max(0, ...entries.map(([, e]) => leadingNumber(e.label) ?? 0));
  const tracks: Track[] = entries.map(([key, e]) => {
    const own = leadingNumber(e.label);
    return { key, trackNo: own ?? ++maxNumber, label: e.label, mp3Path: e.mp3Path, lrcPath: e.lrcPath };
  });
  const order = new Map(entries.map(([key, e]) => [key, e.order]));
  return tracks.sort((a, b) => a.trackNo - b.trackNo || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
}
