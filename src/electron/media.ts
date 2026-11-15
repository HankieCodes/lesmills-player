import { extensionOf } from "../shared/files";

/** A resolved, inclusive byte range of a file. */
export interface ByteRange {
  start: number;
  end: number;
}

export type RangeRequest =
  /** Serve the whole file (no usable Range header). */
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  /** The requested range starts past the end of the file. */
  | { kind: "unsatisfiable" };

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
  ".ts": "video/mp2t",
  ".3gp": "video/3gpp",
  ".flv": "video/x-flv",
  ".mp3": "audio/mpeg",
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extensionOf(filePath)] ?? "application/octet-stream";
}

/**
 * Resolve an HTTP Range header against a file size, so a custom protocol can answer
 * with 206/Content-Range. Chromium refuses to seek in <video> unless the response
 * advertises byte ranges, and `net.fetch` on a `file://` URL does not honour them
 * (electron/electron#38749), hence this is done by hand.
 *
 * Only a single range is supported; multipart ranges are rare from media elements and
 * are answered with the whole file instead.
 */
export function parseByteRange(header: string | null | undefined, size: number): RangeRequest {
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header ?? "");
  if (!match) return { kind: "full" };
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return { kind: "full" };

  if (size <= 0) return { kind: "unsatisfiable" };

  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: "full" };
    return { kind: "partial", start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start)) return { kind: "full" };
  if (start >= size) return { kind: "unsatisfiable" };

  if (rawEnd === "") return { kind: "partial", start, end: size - 1 };
  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < start) return { kind: "full" };
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}
