import { describe, expect, it } from "vitest";
import { elementTimeForTrack, masterTimeForTrack, planSync } from "./clock";
import type { TrackAlignment } from "../shared/types";

function track(overrides: Partial<TrackAlignment> = {}): TrackAlignment {
  return {
    trackNo: 1,
    mp3Path: "/tmp/01 - Warmup.mp3",
    lrcPath: "/tmp/01 - Warmup.lrc",
    videoStartSec: 62.31,
    mp3StartSec: 0,
    confidence: 0.93,
    method: "chromaprint",
    ...overrides,
  };
}

describe("elementTimeForTrack / masterTimeForTrack", () => {
  it("maps master time to element time", () => {
    const t = track({ mp3StartSec: 62.31 });
    expect(elementTimeForTrack(t, 100)).toBeCloseTo(100);
  });

  it("round-trips", () => {
    const t = track({ mp3StartSec: 62.31 });
    const element = elementTimeForTrack(t, 200);
    expect(masterTimeForTrack(t, element)).toBeCloseTo(200);
  });
});

describe("planSync", () => {
  it("does nothing within the nudge tolerance", () => {
    expect(planSync(10.0, 10.05).action).toBe("none");
  });

  it("nudges playback rate within hard tolerance", () => {
    const plan = planSync(10.2, 10.0);
    expect(plan.action).toBe("nudge");
    expect(plan.rate).toBe(0.95);
  });

  it("hard-seeks beyond the hard tolerance", () => {
    const plan = planSync(11.0, 10.0);
    expect(plan.action).toBe("hard-seek");
    expect(plan.targetSec).toBe(10);
  });
});
