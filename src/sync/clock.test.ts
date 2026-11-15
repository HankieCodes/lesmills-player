import { describe, expect, it } from "vitest";
import { elementTimeForTrack, findCurrentTrack, mp3TimeForTrack, planSync, targetForTile } from "./clock";
import type { Alignment, TrackAlignment } from "../shared/types";

function track(trackNo: number, videoStartSec: number): TrackAlignment {
  return {
    trackNo,
    mp3Path: `/m/${trackNo}.mp3`,
    lrcPath: `/m/${trackNo}.lrc`,
    videoStartSec,
    mp3StartSec: 0,
    confidence: 0.9,
    method: "chromaprint",
  };
}

function alignment(source: "self" | "masterclass", tracks: TrackAlignment[]): Alignment {
  return {
    version: 1,
    video: { source, fileName: "v.mp4", filePath: "/v.mp4", durationSec: 4000 },
    release: { program: "BODYPUMP", release: "131" },
    tracks,
    generatedAt: "2026-11-15T00:00:00.000Z",
    alignerVersion: "0.2.0",
  };
}

describe("element / mp3 time mapping", () => {
  it("round-trips", () => {
    const t = track(1, 62.31);
    expect(elementTimeForTrack(t, 10)).toBeCloseTo(72.31);
    expect(mp3TimeForTrack(t, 72.31)).toBeCloseTo(10);
  });
});

describe("findCurrentTrack", () => {
  const a = alignment("self", [track(1, 60), track(2, 400), track(3, 800)]);
  it("returns null before the first track and the latest started track after", () => {
    expect(findCurrentTrack(a, 10)).toBeNull();
    expect(findCurrentTrack(a, 60)?.trackNo).toBe(1);
    expect(findCurrentTrack(a, 799)?.trackNo).toBe(2);
    expect(findCurrentTrack(a, 5000)?.trackNo).toBe(3);
  });
});

describe("targetForTile", () => {
  const self = alignment("self", [track(1, 60), track(2, 400)]);
  const master = alignment("masterclass", [track(1, 5), track(2, 300)]);

  it("is the identity for the reference video", () => {
    expect(targetForTile(self, self, 100).targetSec).toBe(100);
  });

  it("maps another video through the track's MP3 timeline", () => {
    // self t=100 → track 1, mp3 time 40 → masterclass 5 + 40
    const target = targetForTile(self, master, 100);
    expect(target.trackNo).toBe(1);
    expect(target.mp3TimeSec).toBeCloseTo(40);
    expect(target.targetSec).toBeCloseTo(45);
  });

  it("switches track together", () => {
    expect(targetForTile(self, master, 410).targetSec).toBeCloseTo(310);
  });

  it("returns null when the other video lacks the track", () => {
    const partial = alignment("masterclass", [track(1, 5)]);
    expect(targetForTile(self, partial, 410).targetSec).toBeNull();
  });
});

describe("planSync", () => {
  it("does nothing within the nudge tolerance", () => {
    expect(planSync(10.0, 10.05).action).toBe("none");
  });

  it("nudges playback rate within hard tolerance", () => {
    expect(planSync(10.2, 10.0).rate).toBeCloseTo(0.95);
    expect(planSync(9.8, 10.0).rate).toBeCloseTo(1.05);
    expect(planSync(10.2, 10.0, { baseRate: 0.5 }).rate).toBeCloseTo(0.475);
  });

  it("hard-seeks beyond the hard tolerance", () => {
    const plan = planSync(11.0, 10.0);
    expect(plan.action).toBe("hard-seek");
    expect(plan.targetSec).toBe(10);
  });
});
