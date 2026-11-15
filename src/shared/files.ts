export const VIDEO_EXTENSIONS = [".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".mpg", ".mpeg", ".ts", ".3gp", ".flv"];
export const AUDIO_EXTENSIONS = [".mp3"];
export const LRC_EXTENSIONS = [".lrc"];

export type FileKind = "video" | "mp3" | "lrc";

export function extensionOf(filePath: string): string {
  const name = fileNameOf(filePath);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** File name of a Windows or POSIX path. */
export function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

export function stemOf(filePath: string): string {
  const name = fileNameOf(filePath);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

export function classifyFile(filePath: string): FileKind | null {
  const ext = extensionOf(filePath);
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (AUDIO_EXTENSIONS.includes(ext)) return "mp3";
  if (LRC_EXTENSIONS.includes(ext)) return "lrc";
  return null;
}
