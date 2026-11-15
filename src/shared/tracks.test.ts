import { describe, expect, it } from "vitest";
import {
  addPaths,
  parseWorkspace,
  removeManualAlignment,
  removePath,
  setManualAlignment,
  setVideoSource,
} from "./workspace";
import { buildTracks } from "./tracks";
import { emptyWorkspace } from "./workspace";

describe("buildTracks", () => {
  it("pairs an MP3 and an LRC with the same stem, case-insensitively, across folders", () => {
    const tracks = buildTracks(["C:\\a\\05 - Squats.mp3"], ["D:\\b\\05 - SQUATS.lrc"]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ trackNo: 5, mp3Path: "C:\\a\\05 - Squats.mp3", lrcPath: "D:\\b\\05 - SQUATS.lrc" });
  });

  it("creates a track from either file alone", () => {
    const tracks = buildTracks(["/m/01 - A.mp3"], ["/m/02 - B.lrc"]);
    expect(tracks.map((t) => [t.trackNo, !!t.mp3Path, !!t.lrcPath])).toEqual([
      [1, true, false],
      [2, false, true],
    ]);
  });

  it("numbers files without a leading number after the highest, in the order added, and sorts by number", () => {
    const tracks = buildTracks(["/m/Warmup.mp3", "/m/03 - Legs.mp3", "/m/Cooldown.mp3", "/m/01 - Hi.mp3"], []);
    expect(tracks.map((t) => [t.trackNo, t.label])).toEqual([
      [1, "01 - Hi"],
      [3, "03 - Legs"],
      [4, "Warmup"],
      [5, "Cooldown"],
    ]);
  });
});

describe("workspace", () => {
  it("sorts dropped files by type, ignores duplicates and reports unsupported files", () => {
    const first = addPaths(emptyWorkspace(), ["/v/class.M4V", "/m/01.mp3", "/m/01.lrc", "/x/readme.txt"]);
    expect(first.workspace.videos).toEqual([{ path: "/v/class.M4V", source: "self" }]);
    expect(first.workspace.mp3s).toEqual(["/m/01.mp3"]);
    expect(first.workspace.lrcs).toEqual(["/m/01.lrc"]);
    expect(first.rejected).toEqual(["/x/readme.txt"]);
    const again = addPaths(first.workspace, ["/m/01.mp3"]);
    expect(again.duplicates).toEqual(["/m/01.mp3"]);
    expect(again.added).toBe(0);
  });

  it("removes files and toggles a video's type", () => {
    const { workspace } = addPaths(emptyWorkspace(), ["/v/a.mov", "/m/01.mp3"]);
    expect(setVideoSource(workspace, "/v/a.mov", "masterclass").videos[0].source).toBe("masterclass");
    expect(removePath(workspace, "/m/01.mp3").mp3s).toEqual([]);
  });

  it("parses a saved workspace and rejects other JSON", () => {
    const parsed = parseWorkspace({ version: 2, videos: [{ path: "/v/a.mp4", source: "masterclass" }, { nope: 1 }], mp3s: ["/m/1.mp3", 3], lrcs: [] });
    expect(parsed).toEqual({
      version: 2,
      videos: [{ path: "/v/a.mp4", source: "masterclass" }],
      mp3s: ["/m/1.mp3"],
      lrcs: [],
      manualAlignments: [],
    });
    expect(parseWorkspace({ version: 1 })).toBeNull();
    expect(parseWorkspace("x")).toBeNull();
  });

  it("keeps manual alignments in the workspace, replaces them per video+track and removes them with the MP3", () => {
    const { workspace } = addPaths(emptyWorkspace(), ["/v/a.mov", "/m/01 - Warmup.mp3"]);
    const withManual = setManualAlignment(workspace, {
      videoPath: "/v/a.mov",
      trackKey: "01 - warmup",
      startSec: 62.5,
      method: "manual",
      confidence: null,
    });
    expect(withManual.manualAlignments).toHaveLength(1);

    const replaced = setManualAlignment(withManual, {
      videoPath: "/v/a.mov",
      trackKey: "01 - warmup",
      startSec: 64,
      method: "chromaprint",
      confidence: 0.8,
    });
    expect(replaced.manualAlignments).toEqual([
      { videoPath: "/v/a.mov", trackKey: "01 - warmup", startSec: 64, method: "chromaprint", confidence: 0.8 },
    ]);

    expect(removeManualAlignment(replaced, "/v/a.mov", "01 - warmup").manualAlignments).toEqual([]);
    expect(removePath(replaced, "/m/01 - Warmup.mp3").manualAlignments).toEqual([]);
  });

  it("validates manual alignments read from a workspace file", () => {
    const parsed = parseWorkspace({
      version: 2,
      videos: [{ path: "/v/a.mp4", source: "self" }],
      mp3s: ["/m/01.mp3"],
      lrcs: [],
      manualAlignments: [
        { videoPath: "/v/a.mp4", trackKey: "01", startSec: 12.5, method: "chromaprint", confidence: 0.9 },
        { videoPath: "/v/a.mp4", trackKey: "01", startSec: 99 },
        { videoPath: "/v/a.mp4", trackKey: "bad", startSec: -1 },
        { trackKey: "no-video", startSec: 3 },
      ],
    });
    expect(parsed?.manualAlignments).toEqual([
      { videoPath: "/v/a.mp4", trackKey: "01", startSec: 12.5, method: "chromaprint", confidence: 0.9 },
    ]);
  });
});
