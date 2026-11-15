import { classifyFile } from "./files";
import type { VideoSource, WorkspaceFile } from "./types";

export function emptyWorkspace(): WorkspaceFile {
  return { version: 2, videos: [], mp3s: [], lrcs: [] };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string"))] : [];
}

/** Validate untrusted JSON (a workspace file from disk); null if it is not a workspace. */
export function parseWorkspace(value: unknown): WorkspaceFile | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 2) return null;
  const videos: WorkspaceFile["videos"] = [];
  if (Array.isArray(raw.videos)) {
    for (const v of raw.videos) {
      const entry = v as { path?: unknown; source?: unknown } | null;
      if (typeof entry?.path !== "string" || videos.some((x) => x.path === entry.path)) continue;
      videos.push({ path: entry.path, source: entry.source === "masterclass" ? "masterclass" : "self" });
    }
  }
  return { version: 2, videos, mp3s: strings(raw.mp3s), lrcs: strings(raw.lrcs) };
}

export interface AddResult {
  workspace: WorkspaceFile;
  added: number;
  duplicates: string[];
  rejected: string[];
}

/** Sort paths into the workspace by extension; videos start as "self". Never mutates the input. */
export function addPaths(workspace: WorkspaceFile, paths: string[]): AddResult {
  const next: WorkspaceFile = { ...workspace, videos: [...workspace.videos], mp3s: [...workspace.mp3s], lrcs: [...workspace.lrcs] };
  const duplicates: string[] = [];
  const rejected: string[] = [];
  let added = 0;
  for (const filePath of paths) {
    const kind = classifyFile(filePath);
    if (kind === null) {
      rejected.push(filePath);
    } else if (kind === "video") {
      if (next.videos.some((v) => v.path === filePath)) duplicates.push(filePath);
      else {
        next.videos.push({ path: filePath, source: "self" });
        added++;
      }
    } else {
      const list = kind === "mp3" ? next.mp3s : next.lrcs;
      if (list.includes(filePath)) duplicates.push(filePath);
      else {
        list.push(filePath);
        added++;
      }
    }
  }
  return { workspace: next, added, duplicates, rejected };
}

export function removePath(workspace: WorkspaceFile, filePath: string): WorkspaceFile {
  return {
    ...workspace,
    videos: workspace.videos.filter((v) => v.path !== filePath),
    mp3s: workspace.mp3s.filter((p) => p !== filePath),
    lrcs: workspace.lrcs.filter((p) => p !== filePath),
  };
}

export function setVideoSource(workspace: WorkspaceFile, filePath: string, source: VideoSource): WorkspaceFile {
  return { ...workspace, videos: workspace.videos.map((v) => (v.path === filePath ? { ...v, source } : v)) };
}
