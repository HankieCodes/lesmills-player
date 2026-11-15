import type { AudioFeatures } from "../cache/cache";
import type { GuidedAlignmentResult } from "../shared/types";
import { crossCorrelation, FP_ITEM_SEC, matchFingerprintSeries } from "./align";
import { GOOD_CONFIDENCE, MIN_CONFIDENCE } from "./status";

/** The alignment editor searches this far before the selected start… */
export const MANUAL_SEARCH_BEFORE_SEC = 10;
/** …and lets a confident match nudge this far after it. */
export const MANUAL_SEARCH_AFTER_SEC = 5;

/** Fingerprints advance in fixed steps, so allow one item of slack at each window bound. */
const BOUNDS_SLACK_SEC = FP_ITEM_SEC;

export interface GuidedMatchOptions {
  beforeSec?: number;
  afterSec?: number;
  /**
   * Set false to keep the selected start without probing with the MP3. Used when the MP3's
   * automatic match is already in the window and would pull a small correction back to it.
   */
  useTrack?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Whether the MP3's automatic match lies in the guided search window around the selected
 * start. The window spans only 15 s (10 s before to 5 s after), so a small correction would be
 * undone by re-finding that same match. An unmatched track has nothing to snap back to.
 */
export function automaticMatchInWindow(autoStartSec: number | null, hintStartSec: number): boolean {
  if (autoStartSec === null) return false;
  return (
    autoStartSec >= hintStartSec - MANUAL_SEARCH_BEFORE_SEC - BOUNDS_SLACK_SEC &&
    autoStartSec <= hintStartSec + MANUAL_SEARCH_AFTER_SEC + BOUNDS_SLACK_SEC
  );
}

/**
 * Re-find one track inside a short window of a video, anchored at the start the user chose.
 * Only the audio between `startSec - 10` and `startSec + track length + 5` is examined, and a
 * match is accepted only when its start lands within -10 s to +5 s of the selection. With no
 * confident match the selected start is used verbatim. Pass `useTrack: false` to skip the MP3
 * probe entirely.
 */
export function matchTrackInWindow(
  video: AudioFeatures,
  track: AudioFeatures,
  hintStartSec: number,
  options: GuidedMatchOptions = {},
): GuidedAlignmentResult {
  const before = options.beforeSec ?? MANUAL_SEARCH_BEFORE_SEC;
  const after = options.afterSec ?? MANUAL_SEARCH_AFTER_SEC;
  const hint = clamp(hintStartSec, 0, video.durationSec);
  const fromSec = Math.max(0, hint - before);
  const toSec = Math.min(video.durationSec, hint + track.durationSec + after);
  const low = hint - before - BOUNDS_SLACK_SEC;
  const high = hint + after + BOUNDS_SLACK_SEC;

  const manual: GuidedAlignmentResult = {
    startSec: hint,
    matched: false,
    method: "manual",
    confidence: null,
    searchedFromSec: fromSec,
    searchedToSec: toSec,
    referenceVideoPath: null,
    reason:
      options.useTrack === false
        ? "automatic MP3 match inside the search window; keeping the selected start"
        : "no confident match in the search window; using the selected start",
  };
  if (options.useTrack === false || toSec - fromSec < 1 || track.fingerprint.length < 16) return manual;

  const accepted = (startSec: number, confidence: number, method: "chromaprint" | "cross-correlation"): GuidedAlignmentResult | null =>
    startSec >= low && startSec <= high && startSec >= 0 && startSec <= video.durationSec
      ? {
          startSec,
          matched: true,
          method,
          confidence,
          searchedFromSec: fromSec,
          searchedToSec: toSec,
          referenceVideoPath: null,
          reason: `matched ${startSec.toFixed(2)} s (searched ${fromSec.toFixed(1)}–${toSec.toFixed(1)} s)`,
        }
      : null;

  // Chromaprint over just the window.
  const fpFrom = Math.max(0, Math.floor(fromSec / FP_ITEM_SEC));
  const fpTo = Math.min(video.fingerprint.length, Math.ceil(toSec / FP_ITEM_SEC));
  if (fpTo - fpFrom >= Math.min(160, track.fingerprint.length)) {
    const match = matchFingerprintSeries(video.fingerprint.slice(fpFrom, fpTo), track.fingerprint);
    if (match !== null && match.confidence >= MIN_CONFIDENCE) {
      const hit = accepted(fpFrom * FP_ITEM_SEC + match.offsetSec, match.confidence, "chromaprint");
      if (hit !== null) return hit;
    }
  }

  // Envelope cross-correlation over the same window.
  const frameSec = video.envelopeFrameSec;
  if (frameSec > 0) {
    const envFrom = Math.max(0, Math.floor(fromSec / frameSec));
    const envTo = Math.min(video.envelope.length, Math.ceil(toSec / frameSec));
    const match = crossCorrelation(video.envelope.slice(envFrom, envTo), track.envelope, frameSec);
    if (match !== null && match.confidence >= GOOD_CONFIDENCE) {
      const hit = accepted(envFrom * frameSec + match.offsetSec, match.confidence, "cross-correlation");
      if (hit !== null) return hit;
    }
  }

  return manual;
}

/**
 * The MP3 probe for the alignment editor. A correction small enough that the MP3's own
 * automatic match sits in the search window is kept exactly, because re-finding that match
 * there would snap the track back to the spot the user is moving away from. Only another
 * video's aligned audio may nudge such a correction (`matchTrackAgainstReferences`).
 */
export function matchGuided(
  video: AudioFeatures,
  track: AudioFeatures,
  hintStartSec: number,
  automaticStartSec: number | null,
): GuidedAlignmentResult {
  return matchTrackInWindow(video, track, hintStartSec, {
    useTrack: !automaticMatchInWindow(automaticStartSec, hintStartSec),
  });
}

/**
 * Take the features of one span of an already analyzed video. Used when the MP3 does not
 * match the edited video: another video's aligned track audio becomes the probe instead.
 */
export function sliceFeatures(features: AudioFeatures, startSec: number, lengthSec: number): AudioFeatures | null {
  const start = clamp(startSec, 0, features.durationSec);
  const length = Math.min(Math.max(0, lengthSec), Math.max(0, features.durationSec - start));
  if (length < 0.5) return null;

  const fpFrom = Math.max(0, Math.floor(start / FP_ITEM_SEC));
  const fpTo = Math.min(features.fingerprint.length, Math.ceil((start + length) / FP_ITEM_SEC));
  if (fpTo - fpFrom < 16) return null;

  const frameSec = features.envelopeFrameSec;
  let envelope: number[] = [];
  if (frameSec > 0) {
    const envFrom = Math.max(0, Math.floor(start / frameSec));
    const envTo = Math.min(features.envelope.length, Math.ceil((start + length) / frameSec));
    if (envTo - envFrom >= 8) envelope = features.envelope.slice(envFrom, envTo);
  }

  return {
    durationSec: length,
    fingerprint: features.fingerprint.slice(fpFrom, fpTo),
    envelope,
    envelopeFrameSec: frameSec,
  };
}

/** Another video's already loaded audio, positioned at its known start for the track. */
export interface VideoAudioReference {
  videoPath: string;
  startSec: number;
  features: AudioFeatures;
}

/**
 * Try other videos' aligned audio for the track inside the edited video's search window.
 * The highest-confidence accepted match wins; null when none of the references match.
 */
export function matchTrackAgainstReferences(
  video: AudioFeatures,
  trackLengthSec: number,
  hintStartSec: number,
  references: VideoAudioReference[],
): GuidedAlignmentResult | null {
  let best: GuidedAlignmentResult | null = null;
  for (const reference of references) {
    const slice = sliceFeatures(reference.features, reference.startSec, trackLengthSec);
    if (slice === null) continue;
    const match = matchTrackInWindow(video, slice, hintStartSec);
    if (!match.matched) continue;
    const candidate: GuidedAlignmentResult = {
      ...match,
      referenceVideoPath: reference.videoPath,
      reason: `${match.reason} using ${reference.videoPath} as the audio reference`,
    };
    if (best === null || (candidate.confidence ?? 0) > (best.confidence ?? 0)) best = candidate;
  }
  return best;
}
