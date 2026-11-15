import { describe, expect, it } from "vitest";
import { elementTimeForTrack, findCurrentTrack, mp3TimeForTrack, planSync, targetForTile } from "./clock";
import type { Alignment, AlignmentTrack } from "../shared/types";

function track(trackNo: number, videoStartSec: number): AlignmentTrack {
  return {
    trackKey: `t${trackNo}`,
    trackNo,
    mp3Path: `/m/${trackNo}.mp3`,
    videoStartSec,
    mp3StartSec: 0,
    confidence: 0.9,
    method: "chromaprint",
  };
}

function alignment(tracks: AlignmentTrack[]): Alignment {
  return {
    version: 2,
    video: { fileName: "v.mp4", filePath: "/v.mp4", durationSec: 4000 },
    tracks,
    generatedAt: "2026-11-15T00:00:00.000Z",
    alignerVersion: "0.3.0",
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
  const a = alignment([track(1, 60), track(2, 400), track(3, 800)]);
  it("returns null before the first track and the latest started track after", () => {
    expect(findCurrentTrack(a, 10)).toBeNull();
    expect(findCurrentTrack(a, 60)?.trackNo).toBe(1);
    expect(findCurrentTrack(a, 799)?.trackNo).toBe(2);
    expect(findCurrentTrack(a, 5000)?.trackNo).toBe(3);
  });
});

describe("targetForTile", () => {
  const self = alignment([track(1, 60), track(2, 400)]);
  const master = alignment([track(1, 5), track(2, 300)]);

  it("is the identity for the reference video", () => {
    const t = targetForTile(self, self, 100, true);
    expect(t.targetSec).toBe(100);
    expect(t.trackKey).toBe("t1");
    expect(t.synced).toBe(true);
  });

  it("maps another video through the track's MP3 timeline", () => {
    const target = targetForTile(self, master, 100, false);
    expect(target.trackKey).toBe("t1");
    expect(target.mp3TimeSec).toBeCloseTo(40);
    expect(target.targetSec).toBeCloseTo(45);
    expect(targetForTile(self, master, 410, false).targetSec).toBeCloseTo(310);
  });

  it("returns null when the other video lacks the track", () => {
    expect(targetForTile(self, alignment([track(1, 5)]), 410, false).targetSec).toBeNull();
  });

  it("plays unaligned videos from 0:00 on the master clock, flagged as not synced", () => {
    const none = alignment([]);
    expect(targetForTile(self, none, 100, false)).toMatchObject({ targetSec: 100, synced: false });
    expect(targetForTile(none, master, 100, false)).toMatchObject({ targetSec: 100, synced: false });
    expect(targetForTile(null, null, 7, true)).toMatchObject({ targetSec: 7, synced: false, trackKey: null });
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
