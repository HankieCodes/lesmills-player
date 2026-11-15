export type VideoSource = "self" | "masterclass";

export type AlignmentMethod = "chromaprint" | "cross-correlation" | "manual";

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
  /** True when the start came from the alignment editor rather than plain analysis. */
  manual?: boolean;
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
  /** True when the start was set in the alignment editor. */
  manual?: boolean;
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

/**
 * A user-set start for one track in one video, stored in the workspace so it survives
 * cache clears and travels with a saved workspace. `startSec` is the final start used
 * (the guided reanalysis' nudge, or the user's setting when it found no match).
 */
export interface ManualAlignment {
  videoPath: string;
  trackKey: string;
  startSec: number;
  method: AlignmentMethod;
  /** Confidence of the guided match; null when the user's setting was used as-is. */
  confidence: number | null;
}

/** One video's manual starts, as sent to the analyzer. */
export interface TrackStartOverride {
  trackKey: string;
  startSec: number;
  method: AlignmentMethod;
  confidence: number | null;
}

/** Reanalyze one track only around a user-selected start. */
export interface GuidedAlignInput {
  videoPath: string;
  mp3Path: string;
  /** Video time the user dragged the track's start to. */
  startSec: number;
  /** Other videos whose aligned audio can stand in for the MP3 when it does not match. */
  fallbackVideos?: GuidedVideoReference[];
}

/** Another video's known start for a track; its audio from there is the fallback reference. */
export interface GuidedVideoReference {
  videoPath: string;
  startSec: number;
}

/** Result of the guided reanalysis behind the alignment editor's Save. */
export interface GuidedAlignmentResult {
  /** The nudged match, or the user's setting when no confident match was found. */
  startSec: number;
  matched: boolean;
  method: AlignmentMethod;
  confidence: number | null;
  /** Search window inside the video's timeline. */
  searchedFromSec: number;
  searchedToSec: number;
  /** Another video whose aligned audio produced the match; null when the MP3 did. */
  referenceVideoPath: string | null;
  reason: string;
}

/** The workspace JSON file: just the files the user added. Everything else is derived. */
export interface WorkspaceFile {
  version: 2;
  videos: Array<{ path: string; source: VideoSource }>;
  mp3s: string[];
  lrcs: string[];
  /** Corrections from the alignment editor; reapplied on every analysis. */
  manualAlignments: ManualAlignment[];
}
