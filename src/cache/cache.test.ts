import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { cachedSha256, readMatch, sha256File, writeMatch } from "./cache";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lmsync-cache-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

describe("cache", () => {
  it("round-trips a match record using Windows-safe file names", async () => {
    const dir = tmp();
    await writeMatch(SHA_A, SHA_B, "0.3.0", { startSec: 12.5, confidence: 0.9, method: "chromaprint", reason: "matched" }, dir);
    expect((await readMatch(SHA_A, SHA_B, "0.3.0", dir))?.startSec).toBe(12.5);
    expect(await readMatch(SHA_B, SHA_A, "0.3.0", dir)).toBeNull();
    for (const name of fs.readdirSync(path.join(dir, "cache", "matches"))) expect(name).not.toMatch(/[:<>"|?*]/);
  });

  it("rejects keys that are not digests", () => {
    expect(() => readMatch("../x", SHA_B, "0.3.0", tmp())).toThrow(/Unsafe/);
  });

  it("hashes a file once and reuses the remembered digest until it changes", async () => {
    const dir = tmp();
    const file = path.join(dir, "v.bin");
    fs.writeFileSync(file, "hello");
    const first = await cachedSha256(file, dir);
    expect(first).toBe(await sha256File(file));
    expect(await cachedSha256(file, dir)).toBe(first);
    fs.writeFileSync(file, "hello world");
    expect(await cachedSha256(file, dir)).not.toBe(first);
  });
});
