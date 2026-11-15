import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { parseReleaseFromFolderName, scanReleaseFolders } from "./releases";

describe("parseReleaseFromFolderName", () => {
  it.each([
    ["BODYPUMP 131", "BODYPUMP", "131"],
    ["Les Mills BodyPump 131", "BODYPUMP", "131"],
    ["BodyPump_131", "BODYPUMP", "131"],
    ["BP-131 (2026)", "BP", "131"],
    ["GRIT Strength 52", "GRITSTRENGTH", "52"],
  ])("%s", (name, program, release) => {
    expect(parseReleaseFromFolderName(name)).toEqual({ program, release });
  });

  it("falls back to UNKNOWN", () => {
    expect(parseReleaseFromFolderName("random stuff")).toEqual({ program: "UNKNOWN", release: "0" });
  });
});

describe("scanReleaseFolders", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("finds a release in the selected folder itself and in subfolders", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lmsync-scan-"));
    dirs.push(root);
    const rel = path.join(root, "BODYPUMP 131");
    fs.mkdirSync(rel);
    for (const n of ["01 - Warmup", "02 - Squats"]) {
      fs.writeFileSync(path.join(rel, `${n}.mp3`), "");
      fs.writeFileSync(path.join(rel, `${n}.lrc`), "[00:01.00] go");
    }
    fs.writeFileSync(path.join(rel, "03 - NoLrc.mp3"), "");
    fs.writeFileSync(path.join(rel, "BODYPUMP 131 masterclass.mp4"), "");

    for (const source of [root, rel]) {
      const releases = await scanReleaseFolders([source]);
      expect(releases).toHaveLength(1);
      expect(releases[0].program).toBe("BODYPUMP");
      expect(releases[0].release).toBe("131");
      expect(releases[0].tracks.map((t) => t.trackNo)).toEqual([1, 2]);
      expect(releases[0].masterclassVideoPath).toMatch(/masterclass\.mp4$/);
    }
  });
});
