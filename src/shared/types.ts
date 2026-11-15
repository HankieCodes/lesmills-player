export type VideoSource = "self" | "masterclass";

export type AlignmentMethod = "chromaprint" | "cross-correlation";

export interface AlignmentVideo {
  source: VideoSource;
  fileName: string;
  filePath: string;
  durationSec: number;
}

export interface ReleaseIdentity {
  program: string;
  release: string;
}

export interface TrackAlignment {
  trackNo: number;
  mp3Path: string;
  lrcPath: string;
  /** Video time (sec) at which this track's audio begins. */
  videoStartSec: number;
  /**
   * Master/session time (sec) at which this track's MP3 timeline begins.
   * The MP3 timeline is canonical for a session; track 1 typically starts at 0.
   */
  mp3StartSec: number;
  /** 0..1 confidence of the alignment. */
  confidence: number;
  method: AlignmentMethod;
}

export interface Alignment {
  version: 1;
  video: AlignmentVideo;
  release: ReleaseIdentity;
  tracks: TrackAlignment[];
  generatedAt: string;
  alignerVersion: string;
}

export type MatchStatus = "ok" | "low" | "unmatched";

export interface TrackMatchResult {
  trackNo: number;
  status: MatchStatus;
  videoStartSec: number | null;
  confidence: number | null;
  method: AlignmentMethod | null;
  reason: string;
}

export interface MatchReport {
  videoPath: string;
  release: ReleaseIdentity;
  results: TrackMatchResult[];
}

export interface LrcCue {
  timeSec: number;
  text: string;
}

export interface ParsedLrc {
  path: string;
  cues: LrcCue[];
  /** Approximate end of the timed sequence (last cue time). */
  durationSec: number;
}

export interface ReleaseTrack {
  trackNo: number;
  mp3Path: string;
  lrcPath: string;
}

export interface ReleaseFolder {
  folderPath: string;
  program: string;
  release: string;
  tracks: ReleaseTrack[];
  masterclassVideoPath: string | null;
}

export interface ConfidenceSummary {
  release: ReleaseIdentity;
  videoSource: VideoSource;
  videoFileName: string;
  videoPath: string;
  trackCount: number;
  matchedCount: number;
  lowConfidenceCount: number;
  unmatchedCount: number;
  averageConfidence: number | null;
}
