import type { Alignment, MatchReport } from "../shared/types";

/** Alignment state of one video in the workspace. */
export interface VideoAnalysis {
  /** Signature of the MP3 set the alignment was computed for; null before the first run. */
  sig: string | null;
  alignment: Alignment | null;
  report: MatchReport | null;
  running: { message: string; fraction: number } | null;
  error: string | null;
}

export interface LoopRange {
  startSec: number;
  endSec: number;
  cueIndex: number;
  trackKey: string | null;
}
