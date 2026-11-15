import type { Alignment, AlignmentTrack } from "../shared/types";

export interface SyncPlan {
  action: "none" | "hard-seek" | "nudge";
  targetSec: number;
  /** playbackRate to apply for a nudge. */
  rate: number;
}

export const HARD_SEEK_TOLERANCE_SEC = 0.3;
export const NUDGE_TOLERANCE_SEC = 0.08;

/** Time inside a video for a given time on the track's MP3 timeline. */
export function elementTimeForTrack(track: AlignmentTrack, mp3TimeSec: number): number {
  return track.videoStartSec + (mp3TimeSec - track.mp3StartSec);
}

/** Time on the track's MP3 timeline (where LRC cues live) for a given time inside a video. */
export function mp3TimeForTrack(track: AlignmentTrack, videoTimeSec: number): number {
  return track.mp3StartSec + (videoTimeSec - track.videoStartSec);
}

/**
 * Decide how to converge a media element onto its target:
 * > 0.30 s off → hard seek; 0.08–0.30 s off → nudge playbackRate; within 0.08 s → leave alone.
 */
export function planSync(
  currentTimeSec: number,
  targetSec: number,
  options: { hardToleranceSec?: number; nudgeToleranceSec?: number; baseRate?: number } = {},
): SyncPlan {
  const hard = options.hardToleranceSec ?? HARD_SEEK_TOLERANCE_SEC;
  const nudge = options.nudgeToleranceSec ?? NUDGE_TOLERANCE_SEC;
  const baseRate = options.baseRate ?? 1;
  const diff = currentTimeSec - targetSec;
  const magnitude = Math.abs(diff);
  if (magnitude <= nudge) return { action: "none", targetSec, rate: baseRate };
  if (magnitude <= hard) {
    // Behind → speed up; ahead → slow down.
    return { action: "nudge", targetSec, rate: baseRate * (diff < 0 ? 1.05 : 0.95) };
  }
  return { action: "hard-seek", targetSec, rate: baseRate };
}

/** Track whose span contains the given video time (latest start at or before it). */
export function findCurrentTrack(alignment: Alignment, videoTimeSec: number): AlignmentTrack | null {
  let current: AlignmentTrack | null = null;
  for (const track of alignment.tracks) {
    if (videoTimeSec >= track.videoStartSec && (current === null || track.videoStartSec >= current.videoStartSec)) {
      current = track;
    }
  }
  return current;
}

export interface TileTarget {
  /** Track the master clock is currently inside, per the reference video; null if unaligned. */
  trackKey: string | null;
  /** Position on that track's MP3 timeline (LRC time); null if unaligned. */
  mp3TimeSec: number | null;
  /** Target time in the tile's own video; null if this video has no match for the track. */
  targetSec: number | null;
  /** False when this video (or the reference) has no alignment, so it just plays from 0:00. */
  synced: boolean;
}

export function isAligned(alignment: Alignment | null | undefined): alignment is Alignment {
  return alignment != null && alignment.tracks.length > 0;
}

/**
 * The session's master clock runs on the reference video's timeline. For any other video,
 * translate through the track's MP3 timeline: reference time → MP3 time → this video's time.
 * A video without alignment is not synchronized: it plays on the master clock as-is.
 */
export function targetForTile(
  reference: Alignment | null,
  tile: Alignment | null,
  masterTimeSec: number,
  isReference: boolean,
): TileTarget {
  const unsynced: TileTarget = { trackKey: null, mp3TimeSec: null, targetSec: masterTimeSec, synced: false };
  if (!isAligned(reference)) return unsynced;
  const refTrack = findCurrentTrack(reference, masterTimeSec);
  if (isReference) {
    return refTrack
      ? { trackKey: refTrack.trackKey, mp3TimeSec: mp3TimeForTrack(refTrack, masterTimeSec), targetSec: masterTimeSec, synced: true }
      : { trackKey: null, mp3TimeSec: null, targetSec: masterTimeSec, synced: true };
  }
  if (!isAligned(tile)) return unsynced;
  if (refTrack === null) return { trackKey: null, mp3TimeSec: null, targetSec: null, synced: true };
  const mp3TimeSec = mp3TimeForTrack(refTrack, masterTimeSec);
  const tileTrack = tile.tracks.find((t) => t.trackKey === refTrack.trackKey);
  return {
    trackKey: refTrack.trackKey,
    mp3TimeSec,
    targetSec: tileTrack ? elementTimeForTrack(tileTrack, mp3TimeSec) : null,
    synced: true,
  };
}
