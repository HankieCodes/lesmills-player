import { describe, expect, it } from "vitest";
import { crossCorrelation, FP_ITEM_SEC, hammingDistance, matchFingerprintSeries, popcount32 } from "./align";

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

function randomSeries(length: number, seed: number): number[] {
  const next = rng(seed);
  return Array.from({ length }, () => next());
}

function addNoise(series: number[], flipProbability: number, seed: number): number[] {
  const next = rng(seed);
  return series.map((value) => {
    let out = value;
    for (let bit = 0; bit < 32; bit++) {
      if (next() / 0xffffffff < flipProbability) out ^= 1 << bit;
    }
    return out >>> 0;
  });
}

describe("popcount32 / hammingDistance", () => {
  it("counts set bits", () => {
    expect(popcount32(0)).toBe(0);
    expect(popcount32(0xffffffff)).toBe(32);
    expect(popcount32(0b1011)).toBe(3);
  });

  it("returns 0 for identical fingerprints and counts differing bits", () => {
    expect(hammingDistance([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(hammingDistance([1], [2])).toBe(2);
  });
});

describe("matchFingerprintSeries", () => {
  const video = randomSeries(3000, 1);

  it("finds the exact offset of a clean track excerpt", () => {
    const track = video.slice(1200, 1200 + 600);
    const match = matchFingerprintSeries(video, track);
    expect(match).not.toBeNull();
    expect(match!.offsetSec).toBeCloseTo(1200 * FP_ITEM_SEC, 5);
    expect(match!.confidence).toBeGreaterThan(0.9);
    expect(match!.bitErrorRate).toBeLessThan(0.01);
  });

  it("still finds the offset when 25% of the bits are flipped (voice-over / reverb)", () => {
    const track = addNoise(video.slice(500, 500 + 500), 0.25, 99);
    const match = matchFingerprintSeries(video, track);
    expect(match).not.toBeNull();
    expect(match!.offsetSec).toBeCloseTo(500 * FP_ITEM_SEC, 5);
    expect(match!.confidence).toBeGreaterThan(0.3);
    expect(match!.bitErrorRate).toBeLessThan(0.35);
  });

  it("does not report a confident match for unrelated audio", () => {
    const track = randomSeries(500, 12345);
    const match = matchFingerprintSeries(video, track);
    expect(match === null || match.confidence < 0.3).toBe(true);
  });
});

describe("crossCorrelation", () => {
  it("finds the lag of a track envelope inside a longer video envelope", () => {
    const next = rng(5);
    const video = Array.from({ length: 400 }, () => next() / 0xffffffff);
    const track = video.slice(120, 200);
    const result = crossCorrelation(video, track, 0.25);
    expect(result).not.toBeNull();
    expect(result!.offsetSec).toBeCloseTo(120 * 0.25, 5);
    expect(result!.confidence).toBeGreaterThan(0.99);
  });
});
