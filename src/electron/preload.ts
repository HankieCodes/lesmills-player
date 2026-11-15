import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AnalyzeInput, AnalyzeOutput, AnalyzeProgress } from "../analyzer/analyzer";
import type { GuidedAlignInput, GuidedAlignmentResult, ParsedLrc, WorkspaceFile } from "../shared/types";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api = {
  analyze: (input: AnalyzeInput) => invoke<AnalyzeOutput>("lmsync:analyze", input),
  /** Reanalyze one track only around a start picked in the alignment editor. */
  alignTrack: (input: GuidedAlignInput) => invoke<GuidedAlignmentResult>("lmsync:alignTrack", input),
  loadLrc: (lrcPath: string) => invoke<ParsedLrc | null>("lmsync:lrc", lrcPath),
  /** Native multi-select file dialog (videos, MP3, LRC). */
  pickFiles: () => invoke<string[]>("lmsync:pickFiles"),
  exists: (paths: string[]) => invoke<Record<string, boolean>>("lmsync:exists", paths),
  workspace: {
    load: () => invoke<WorkspaceFile | null>("lmsync:workspace:load"),
    save: (workspace: WorkspaceFile) => invoke<void>("lmsync:workspace:save", workspace),
    open: () => invoke<{ path: string; workspace: WorkspaceFile } | null>("lmsync:workspace:open"),
    saveAs: (workspace: WorkspaceFile) => invoke<string | null>("lmsync:workspace:saveAs", workspace),
  },
  clearCache: () => invoke<void>("lmsync:cache:clear"),
  /** Must run in the preload: File objects cannot cross IPC. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  onProgress: (listener: (progress: AnalyzeProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: AnalyzeProgress) => listener(progress);
    ipcRenderer.on("lmsync:analyze-progress", handler);
    return () => {
      ipcRenderer.off("lmsync:analyze-progress", handler);
    };
  },
};

contextBridge.exposeInMainWorld("lmsync", api);

export type LmsyncApi = typeof api;
