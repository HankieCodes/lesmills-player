import { classifyFile } from "./files";
import { trackKeyOf } from "./tracks";
import type { AlignmentMethod, ManualAlignment, VideoSource, WorkspaceFile } from "./types";

export function emptyWorkspace(): WorkspaceFile {
  return { version: 2, videos: [], mp3s: [], lrcs: [], manualAlignments: [] };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string"))] : [];
}

const METHODS: AlignmentMethod[] = ["chromaprint", "cross-correlation", "manual"];

/** Validate the optional manual alignments of an untrusted workspace file. */
function manualAlignments(value: unknown): ManualAlignment[] {
  if (!Array.isArray(value)) return [];
  const out: ManualAlignment[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const { videoPath, trackKey, startSec } = raw;
    if (typeof videoPath !== "string" || typeof trackKey !== "string") continue;
    if (typeof startSec !== "number" || !Number.isFinite(startSec) || startSec < 0) continue;
    const key = `${videoPath}\u0000${trackKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const method = METHODS.includes(raw.method as AlignmentMethod) ? (raw.method as AlignmentMethod) : "manual";
    const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : null;
    out.push({ videoPath, trackKey, startSec, method, confidence });
  }
  return out;
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
  return { version: 2, videos, mp3s: strings(raw.mp3s), lrcs: strings(raw.lrcs), manualAlignments: manualAlignments(raw.manualAlignments) };
}

export interface AddResult {
  workspace: WorkspaceFile;
  added: number;
  duplicates: string[];
  rejected: string[];
}

/** Sort paths into the workspace by extension; videos start as "self". Never mutates the input. */
export function addPaths(workspace: WorkspaceFile, paths: string[]): AddResult {
  const next: WorkspaceFile = {
    ...workspace,
    videos: [...workspace.videos],
    mp3s: [...workspace.mp3s],
    lrcs: [...workspace.lrcs],
    manualAlignments: [...workspace.manualAlignments],
  };
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

/** Remove a file, dropping manual alignments for it and for tracks whose MP3 is gone. */
export function removePath(workspace: WorkspaceFile, filePath: string): WorkspaceFile {
  const mp3s = workspace.mp3s.filter((p) => p !== filePath);
  const remainingTrackKeys = new Set(mp3s.map(trackKeyOf));
  return {
    ...workspace,
    videos: workspace.videos.filter((v) => v.path !== filePath),
    mp3s,
    lrcs: workspace.lrcs.filter((p) => p !== filePath),
    manualAlignments: workspace.manualAlignments.filter((m) => m.videoPath !== filePath && remainingTrackKeys.has(m.trackKey)),
  };
}

export function setVideoSource(workspace: WorkspaceFile, filePath: string, source: VideoSource): WorkspaceFile {
  return { ...workspace, videos: workspace.videos.map((v) => (v.path === filePath ? { ...v, source } : v)) };
}

/** Insert or replace the manual alignment for one (video, track). */
export function setManualAlignment(workspace: WorkspaceFile, alignment: ManualAlignment): WorkspaceFile {
  const rest = workspace.manualAlignments.filter((m) => m.videoPath !== alignment.videoPath || m.trackKey !== alignment.trackKey);
  return { ...workspace, manualAlignments: [...rest, alignment] };
}

/** Drop the manual alignment for one (video, track), returning it to automatic analysis. */
export function removeManualAlignment(workspace: WorkspaceFile, videoPath: string, trackKey: string): WorkspaceFile {
  return {
    ...workspace,
    manualAlignments: workspace.manualAlignments.filter((m) => m.videoPath !== videoPath || m.trackKey !== trackKey),
  };
}
