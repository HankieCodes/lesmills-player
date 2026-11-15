import { describe, expect, it } from "vitest";
import { cueAt, parseLrc, sortCues } from "./lrc";

describe("parseLrc", () => {
  it("parses mm:ss.cc cues into timeSec + text", () => {
    const parsed = parseLrc("[00:12.34] 10 reps of The Box (The Box)\n[00:20.00] 8 reps of the press (Press)", "track.lrc");
    expect(parsed.cues).toHaveLength(2);
    expect(parsed.cues[0]).toEqual({ timeSec: 12.34, text: "10 reps of The Box (The Box)" });
    expect(parsed.cues[1].timeSec).toBeCloseTo(20, 5);
    expect(parsed.cues[1].text).toBe("8 reps of the press (Press)");
  });

  it("parses cues without centiseconds", () => {
    const parsed = parseLrc("[01:05] hello");
    expect(parsed.cues).toHaveLength(1);
    expect(parsed.cues[0].timeSec).toBe(65);
  });

  it("skips metadata lines", () => {
    const parsed = parseLrc("[ti:BodyPump]\n[ar:Hank]\n[00:01.00] go hard", "track.lrc");
    expect(parsed.cues).toHaveLength(1);
    expect(parsed.cues[0].text).toBe("go hard");
  });
});

describe("sortCues", () => {
  it("sorts cues by ascending time", () => {
    const sorted = sortCues([
      { timeSec: 30, text: "b" },
      { timeSec: 10, text: "a" },
      { timeSec: 20, text: "c" },
    ]);
    expect(sorted.map((c) => c.text)).toEqual(["a", "c", "b"]);
  });
});

describe("cueAt", () => {
  it("returns the last cue at or before the time", () => {
    const cues = [
      { timeSec: 10, text: "a" },
      { timeSec: 20, text: "b" },
      { timeSec: 30, text: "c" },
    ];
    expect(cueAt(cues, 15)?.text).toBe("a");
    expect(cueAt(cues, 20)?.text).toBe("b");
    expect(cueAt(cues, 5)).toBeNull();
  });
});
