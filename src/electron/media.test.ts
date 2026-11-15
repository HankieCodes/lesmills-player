import { describe, expect, it } from "vitest";
import { contentTypeFor, parseByteRange } from "./media";

const SIZE = 1000;

describe("parseByteRange", () => {
  it("serves the whole file when there is no Range header", () => {
    expect(parseByteRange(null, SIZE)).toEqual({ kind: "full" });
    expect(parseByteRange(undefined, SIZE)).toEqual({ kind: "full" });
    expect(parseByteRange("", SIZE)).toEqual({ kind: "full" });
  });

  it("parses an open-ended range", () => {
    expect(parseByteRange("bytes=0-", SIZE)).toEqual({ kind: "partial", start: 0, end: 999 });
    expect(parseByteRange("bytes=250-", SIZE)).toEqual({ kind: "partial", start: 250, end: 999 });
  });

  it("parses a closed range", () => {
    expect(parseByteRange("bytes=0-99", SIZE)).toEqual({ kind: "partial", start: 0, end: 99 });
    expect(parseByteRange("bytes=250-499", SIZE)).toEqual({ kind: "partial", start: 250, end: 499 });
  });

  it("parses a suffix range", () => {
    expect(parseByteRange("bytes=-500", SIZE)).toEqual({ kind: "partial", start: 500, end: 999 });
    expect(parseByteRange("bytes=-5000", SIZE)).toEqual({ kind: "partial", start: 0, end: 999 });
  });

  it("clamps an end past the file size", () => {
    expect(parseByteRange("bytes=900-2000", SIZE)).toEqual({ kind: "partial", start: 900, end: 999 });
  });

  it("rejects a range that starts past the end", () => {
    expect(parseByteRange("bytes=1000-", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=2000-3000", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });

  it("ignores malformed or unsupported range headers", () => {
    expect(parseByteRange("bytes=abc", SIZE)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=-", SIZE)).toEqual({ kind: "full" });
    expect(parseByteRange("items=0-99", SIZE)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=500-100", SIZE)).toEqual({ kind: "full" });
    // Multipart ranges are answered with the whole file rather than mis-parsed.
    expect(parseByteRange("bytes=0-99,200-299", SIZE)).toEqual({ kind: "full" });
  });

  it("is case-insensitive about the unit", () => {
    expect(parseByteRange("BYTES=0-9", SIZE)).toEqual({ kind: "partial", start: 0, end: 9 });
  });
});

describe("contentTypeFor", () => {
  it("maps video and audio extensions", () => {
    expect(contentTypeFor("/media/Class 12.mp4")).toBe("video/mp4");
    expect(contentTypeFor("C:\\media\\class.MOV")).toBe("video/quicktime");
    expect(contentTypeFor("/media/class.webm")).toBe("video/webm");
    expect(contentTypeFor("/media/class.mp3")).toBe("audio/mpeg");
  });

  it("falls back for unknown extensions", () => {
    expect(contentTypeFor("/media/class.xyz")).toBe("application/octet-stream");
    expect(contentTypeFor("/media/README")).toBe("application/octet-stream");
  });
});
