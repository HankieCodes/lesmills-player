export type VideoSource = "self" | "masterclass";

export type AlignmentMethod = "chromaprint" | "cross-correlation";

export type MatchStatus = "ok" | "low" | "unmatched";

/** A choreography track assembled from a user-supplied MP3 and/or LRC (paired by file name). */
export interface Track {
  /** Normalized file name stem; identity of the track across videos and workspaces. */
  key: string;
  /** From the leading digits of the file name, else the next free number in the order added. */
  trackNo: number;
  /** Stem as first seen, for display. */
  label: string;
  mp3Path: string | null;
  lrcPath: string | null;
}

export interface AlignmentTrack {
  trackKey: string;
  trackNo: number;
  mp3Path: string;
  /** Video time (sec) at which this track's audio begins. */
  videoStartSec: number;
  /** Offset into the MP3 at which the match begins; 0 = the MP3's own start. */
  mp3StartSec: number;
  /** 0..1 confidence of the alignment. */
  confidence: number;
  method: AlignmentMethod;
}

export interface Alignment {
  version: 2;
  video: {
    fileName: string;
    filePath: string;
    durationSec: number;
  };
  tracks: AlignmentTrack[];
  generatedAt: string;
  alignerVersion: string;
}

export interface TrackMatchResult {
  trackKey: string;
  trackNo: number;
  status: MatchStatus;
  videoStartSec: number | null;
  confidence: number | null;
  method: AlignmentMethod | null;
  reason: string;
}

export interface MatchReport {
  videoPath: string;
  results: TrackMatchResult[];
}

export interface LrcCue {
  timeSec: number;
  text: string;
}

export interface ParsedLrc {
  path: string;
  cues: LrcCue[];
  /** Time of the last cue. */
  durationSec: number;
}

/** What the analyzer needs to know about a track: only the MP3 takes part in alignment. */
export interface AnalyzeTrackInput {
  trackKey: string;
  trackNo: number;
  mp3Path: string;
}

/** The workspace JSON file: just the files the user added. Everything else is derived. */
export interface WorkspaceFile {
  version: 2;
  videos: Array<{ path: string; source: VideoSource }>;
  mp3s: string[];
  lrcs: string[];
}
