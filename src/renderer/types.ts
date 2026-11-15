import type { Alignment, MatchReport, ParsedLrc, ReleaseFolder, VideoSource } from "../shared/types";

export interface VideoTileState {
  id: string;
  source: VideoSource;
  path: string;
  fileName: string;
  release: ReleaseFolder;
  alignment: Alignment;
  matchReport: MatchReport;
  lrcs: Record<number, ParsedLrc>;
}

export interface PendingTileState {
  id: string;
  fileName: string;
  message: string;
  fraction: number;
  error: string | null;
}

/** A loop over one LRC block, expressed on the reference video's timeline. */
export interface LoopRange {
  startSec: number;
  endSec: number;
  trackNo: number;
  cueIndex: number;
}
