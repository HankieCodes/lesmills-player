import type { LrcCue, ParsedLrc } from "../shared/types";

const CUE_PATTERN = /^\[(\d{1,3}):(\d{1,2})(?:[.,](\d{1,3}))?\]/;

/**
 * Parse the standard LRC cue format emitted by LM Lyrics into flat cues:
 * `[mm:ss.cc] lyric text` — one cue per line (rep counts + move name + lyric
 * fragment in parentheses). Metadata lines (`ti:`, `ar:`, `[ti:...]`, etc.) and
 * blank lines are skipped.
 */
export function parseLrc(source: string, path: string): ParsedLrc {
  const cues: LrcCue[] = [];
  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = CUE_PATTERN.exec(line);
    if (match === null) continue;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const centiseconds = match[3] === undefined ? 0 : Number(match[3]) / 100;
    const timeSec = minutes * 60 + seconds + centiseconds;
    const text = line.slice(match[0].length).trim();
    if (text.length === 0) continue;
    cues.push({ timeSec, text });
  }
  const lastCueSec = cues.length > 0 ? cues[cues.length - 1].timeSec : 0;
  return { path, cues, durationSec: lastCueSec };
}

/** Cue list sorted by ascending time, with strictly increasing times. */
export function sortCues(cues: LrcCue[]): LrcCue[] {
  return [...cues].sort((a, b) => a.timeSec - b.timeSec);
}

/** Index cues by track-relative time; returns the cue at or before `timeSec`. */
export function cueAt(cues: LrcCue[], timeSec: number): LrcCue | null {
  let active: LrcCue | null = null;
  for (const cue of cues) {
    if (cue.timeSec <= timeSec) active = cue;
    else break;
  }
  return active;
}
