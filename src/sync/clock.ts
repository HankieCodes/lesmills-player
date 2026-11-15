import type { Alignment, TrackAlignment } from "../shared/types";

export interface SyncPlan {
  action: "none" | "hard-seek" | "nudge";
  targetSec: number;
  /** playbackRate to apply for a nudge (0.95/1.05 clamped range). */
  rate: number;
}

export const HARD_SEEK_TOLERANCE_SEC = 0.3;
export const NUDGE_TOLERANCE_SEC = 0.08;

/**
 * Virtual master clock: the MP3 timeline is canonical for a session, so the
 * element (video) time for a track is derived from the master time.
 */
export function elementTimeForTrack(track: TrackAlignment, masterTimeSec: number): number {
  return track.videoStartSec + (masterTimeSec - track.mp3StartSec);
}

export function masterTimeForTrack(track: TrackAlignment, elementTimeSec: number): number {
  return track.mp3StartSec + (elementTimeSec - track.videoStartSec);
}

/**
 * Decide how to converge a media element onto its master-clock target:
 * > 0.30 s off → hard seek; 0.08–0.30 s off → nudge playbackRate; within
 * 0.08 s → leave alone.
 */
export function planSync(
  currentTimeSec: number,
  targetSec: number,
  options: { hardToleranceSec?: number; nudgeToleranceSec?: number } = {},
): SyncPlan {
  const hard = options.hardToleranceSec ?? HARD_SEEK_TOLERANCE_SEC;
  const nudge = options.nudgeToleranceSec ?? NUDGE_TOLERANCE_SEC;
  const diff = currentTimeSec - targetSec;
  const magnitude = Math.abs(diff);
  if (magnitude <= nudge) {
    return { action: "none", targetSec, rate: 1 };
  }
  if (magnitude <= hard) {
    // Behind → speed up; ahead → slow down.
    const rate = diff < 0 ? 1.05 : 0.95;
    return { action: "nudge", targetSec, rate };
  }
  return { action: "hard-seek", targetSec, rate: 1 };
}

/** Track whose span contains the master time (latest start at or before it). */
export function findCurrentTrack(alignment: Alignment, masterTimeSec: number): TrackAlignment | null {
  const tracks = [...alignment.tracks].sort((a, b) => a.trackNo - b.trackNo);
  let current: TrackAlignment | null = null;
  for (const track of tracks) {
    if (masterTimeSec >= track.videoStartSec) current = track;
  }
  return current;
}
