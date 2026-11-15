import { describe, expect, it } from "vitest";
import type { AudioFeatures } from "../cache/cache";
import { FP_ITEM_SEC } from "./align";
import {
  automaticMatchInWindow,
  matchGuided,
  matchTrackAgainstReferences,
  matchTrackInWindow,
  sliceFeatures,
} from "./guided";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function series(length: number, seed: number): number[] {
  const next = rng(seed);
  return Array.from({ length }, () => next());
}

function features(durationSec: number, fingerprint: number[], envelope: number[] = []): AudioFeatures {
  return { durationSec, fingerprint, envelope, envelopeFrameSec: 0.25 };
}

/** A 300 s video fingerprint with a 40 s track copied into it at `startSec`. */
function fixture(startSec: number) {
  const videoDurationSec = 300;
  const trackDurationSec = 40;
  const videoFingerprint = series(Math.ceil(videoDurationSec / FP_ITEM_SEC), 7);
  const startIndex = Math.round(startSec / FP_ITEM_SEC);
  const trackFingerprint = videoFingerprint.slice(startIndex, startIndex + Math.ceil(trackDurationSec / FP_ITEM_SEC));
  return {
    video: features(videoDurationSec, videoFingerprint, series(1200, 9)),
    track: features(trackDurationSec, trackFingerprint),
    actualStartSec: startIndex * FP_ITEM_SEC,
  };
}

describe("matchTrackInWindow", () => {
  it("finds the track and accepts a nudge inside the -10 s / +5 s window", () => {
    const { video, track, actualStartSec } = fixture(120.4);
    const result = matchTrackInWindow(video, track, 116);
    expect(result.matched).toBe(true);
    expect(result.method).toBe("chromaprint");
    expect(Math.abs(result.startSec - actualStartSec)).toBeLessThan(0.5);
    expect(result.searchedFromSec).toBe(106);
    expect(result.searchedToSec).toBe(161);
  });

  it("rejects a match beyond +5 s of the selected start and falls back to it", () => {
    const { video, track } = fixture(120.4);
    const result = matchTrackInWindow(video, track, 114);
    expect(result.matched).toBe(false);
    expect(result.method).toBe("manual");
    expect(result.startSec).toBe(114);
    expect(result.confidence).toBeNull();
  });

  it("falls back to the exact selected start when the window holds unrelated audio", () => {
    const { video } = fixture(120.4);
    const unrelated = features(40, series(Math.ceil(40 / FP_ITEM_SEC), 12345));
    const result = matchTrackInWindow(video, unrelated, 80);
    expect(result.matched).toBe(false);
    expect(result.startSec).toBe(80);
  });

  it("clamps the selected start into the video and searches from 0 at the beginning", () => {
    const { video, track, actualStartSec } = fixture(4);
    const result = matchTrackInWindow(video, track, 0);
    expect(result.matched).toBe(true);
    expect(Math.abs(result.startSec - actualStartSec)).toBeLessThan(0.5);
    expect(result.searchedFromSec).toBe(0);
  });

  it("keeps a small correction instead of snapping back to the automatic MP3 match", () => {
    const { video, track, actualStartSec } = fixture(120.4);
    const result = matchGuided(video, track, 124, actualStartSec);
    expect(result.matched).toBe(false);
    expect(result.method).toBe("manual");
    expect(result.startSec).toBe(124);
    expect(result.reason).toContain("automatic MP3 match");
  });

  it("probes with the MP3 when the automatic match is outside the search window", () => {
    const { video, track, actualStartSec } = fixture(120.4);
    const result = matchGuided(video, track, 126, 100);
    expect(result.matched).toBe(true);
    expect(Math.abs(result.startSec - actualStartSec)).toBeLessThan(0.5);
  });

  it("places the automatic match in the search window only within 10 s before to 5 s after", () => {
    expect(automaticMatchInWindow(null, 100)).toBe(false);
    expect(automaticMatchInWindow(100, 100)).toBe(true);
    expect(automaticMatchInWindow(92, 100)).toBe(true);
    expect(automaticMatchInWindow(104, 100)).toBe(true);
    expect(automaticMatchInWindow(85, 100)).toBe(false);
    expect(automaticMatchInWindow(110, 100)).toBe(false);
  });

  it("slices another video's aligned audio and matches it as a fallback probe", () => {
    const referenceFingerprint = series(Math.ceil(300 / FP_ITEM_SEC), 31);
    const referenceEnvelope = series(1200, 32);
    const referenceStartSec = 100.2;
    const referenceStartIndex = Math.round(referenceStartSec / FP_ITEM_SEC);
    const slice = sliceFeatures(
      features(300, referenceFingerprint, referenceEnvelope),
      referenceStartIndex * FP_ITEM_SEC,
      40,
    );
    expect(slice).not.toBeNull();
    expect(slice!.fingerprint.length).toBeGreaterThan(16);

    // The edited video holds the same audio at a different place among unrelated audio.
    const editedStartIndex = Math.round(180.3 / FP_ITEM_SEC);
    const editedFingerprint = series(Math.ceil(400 / FP_ITEM_SEC), 33);
    editedFingerprint.splice(editedStartIndex, slice!.fingerprint.length, ...slice!.fingerprint);
    const edited = features(400, editedFingerprint);

    const result = matchTrackInWindow(edited, slice!, 176);
    expect(result.matched).toBe(true);
    expect(result.method).toBe("chromaprint");
    expect(Math.abs(result.startSec - editedStartIndex * FP_ITEM_SEC)).toBeLessThan(0.5);
    expect(result.referenceVideoPath).toBeNull();
  });

  it("slices fingerprints and envelopes at the requested start and length", () => {
    const video = features(300, series(Math.ceil(300 / FP_ITEM_SEC), 7), series(1200, 9));
    const slice = sliceFeatures(video, 100, 40);
    expect(slice?.durationSec).toBe(40);
    expect(slice?.fingerprint).toEqual(video.fingerprint.slice(Math.floor(100 / FP_ITEM_SEC), Math.ceil(140 / FP_ITEM_SEC)));
    expect(slice?.envelope.length).toBe(Math.ceil(140 / 0.25) - Math.floor(100 / 0.25));
    expect(sliceFeatures(video, 280, 40)?.durationSec).toBe(20);
    expect(sliceFeatures(video, 299, 1)).toBeNull();
  });

  it("picks the best aligned audio from other videos as the fallback", () => {
    const editedStartIndex = Math.round(180.3 / FP_ITEM_SEC);
    const referenceStartIndex = Math.round(60.2 / FP_ITEM_SEC);
    const referenceFingerprint = series(Math.ceil(300 / FP_ITEM_SEC), 43);
    const referenceSlice = referenceFingerprint.slice(referenceStartIndex, referenceStartIndex + Math.ceil(40 / FP_ITEM_SEC));

    const editedFingerprint = series(Math.ceil(400 / FP_ITEM_SEC), 41);
    editedFingerprint.splice(editedStartIndex, referenceSlice.length, ...referenceSlice);
    const edited = features(400, editedFingerprint);
    const unrelated = { videoPath: "/v/unrelated.mp4", startSec: 20, features: features(300, series(Math.ceil(300 / FP_ITEM_SEC), 47)) };
    const reference = {
      videoPath: "/v/reference.mp4",
      startSec: referenceStartIndex * FP_ITEM_SEC,
      features: features(300, referenceFingerprint),
    };

    const result = matchTrackAgainstReferences(edited, 40, 176, [unrelated, reference]);
    expect(result).not.toBeNull();
    expect(result!.referenceVideoPath).toBe("/v/reference.mp4");
    expect(result!.matched).toBe(true);
    expect(Math.abs(result!.startSec - editedStartIndex * FP_ITEM_SEC)).toBeLessThan(0.5);
  });
});
