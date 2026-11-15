import { describe, expect, it } from "vitest";
import { buildEnvelope, crossCorrelation, hammingDistance, matchFingerprints } from "./align";

function hash(byte: number): number[] {
  return [byte, byte ^ 0x55];
}

describe("hammingDistance", () => {
  it("returns 0 for identical fingerprints", () => {
    expect(hammingDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it("counts differing bits", () => {
    // 1 ^ 2 = 3 -> two bits differ
    expect(hammingDistance([1], [2])).toBe(2);
  });
});

describe("matchFingerprints", () => {
  it("finds a zero offset for identical audio", () => {
    const video = [
      { timeSec: 60, hash: hash(7) },
      { timeSec: 70, hash: hash(8) },
      { timeSec: 80, hash: hash(9) },
    ];
    const track = [
      { timeSec: 0, hash: hash(7) },
      { timeSec: 10, hash: hash(8) },
      { timeSec: 20, hash: hash(9) },
    ];
    const match = matchFingerprints(video, track);
    expect(match).not.toBeNull();
    expect(match?.offsetSec).toBe(60);
    expect(match?.confidence).toBeCloseTo(1, 5);
    expect(match?.method).toBe("chromaprint");
  });

  it("returns null when nothing matches", () => {
    const video = [{ timeSec: 0, hash: [10, 20] }];
    const track = [{ timeSec: 0, hash: [200, 210] }];
    expect(matchFingerprints(video, track)).toBeNull();
  });
});

describe("crossCorrelation", () => {
  it("finds a zero offset for identical envelopes", () => {
    const env = [0, 1, 2, 1, 0, 0, 0, 0];
    const result = crossCorrelation(env, env, 0.25);
    expect(result).not.toBeNull();
    expect(result?.offsetSec).toBe(0);
    expect(result?.confidence).toBeGreaterThan(0.9);
  });

  it("finds a shifted offset", () => {
    const env = [0, 1, 2, 1, 0, 0, 0, 0];
    const shifted = [0, 0, 0, 0, 0, 1, 2, 1];
    const result = crossCorrelation(env, shifted, 0.25);
    expect(result).not.toBeNull();
    // The signal starts at index 5 of `shifted`, which is index 1 of the original.
    expect(Math.abs(result!.offsetSec - 1)).toBeLessThan(0.5);
  });
});

describe("buildEnvelope", () => {
  it("produces frames of mean absolute amplitude", () => {
    const env = buildEnvelope([0.5, 0.5, 0.5, 0.5], 4, 4);
    expect(env.length).toBeGreaterThan(0);
    expect(env[0]).toBeCloseTo(0.5, 5);
  });
});
