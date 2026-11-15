import type { MatchStatus } from "../shared/types";

/** Tracks below MIN are omitted; below GOOD they are flagged "low". Untuned: see README. */

export const MIN_CONFIDENCE = 0.3;
export const GOOD_CONFIDENCE = 0.6;
export const CROSSFADE_TOLERANCE_SEC = 10;

export function statusForConfidence(confidence: number): MatchStatus {
  if (confidence >= GOOD_CONFIDENCE) return "ok";
  if (confidence >= MIN_CONFIDENCE) return "low";
  return "unmatched";
}
