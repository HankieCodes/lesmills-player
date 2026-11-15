import { describe, expect, it } from "vitest";
import { alignmentCacheKey, lrcCacheKey, sha256String } from "./cache";

describe("cache keys", () => {
  it("hashes strings deterministically", async () => {
    expect(await sha256String("abc")).toBe(await sha256String("abc"));
    expect(await sha256String("abc")).not.toBe(await sha256String("abd"));
  });

  it("builds alignment cache keys from media hash + release + aligner version", () => {
    const key = alignmentCacheKey("abc123", { program: "BODYPUMP", release: "131" }, "0.1.0");
    expect(key).toBe("abc123__BODYPUMP::131__0.1.0");
  });

  it("builds lrc cache keys", () => {
    expect(lrcCacheKey("deadbeef")).toBe("lrc__deadbeef");
  });
});
