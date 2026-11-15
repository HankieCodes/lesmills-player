import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AnalyzeInput, AnalyzeOutput, AnalyzeProgress } from "../analyzer/analyzer";
import type { GuidedAlignInput, GuidedAlignmentResult, ParsedLrc, WorkspaceFile } from "../shared/types";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api = {
  analyze: (input: AnalyzeInput) => invoke<AnalyzeOutput>("lmplayer:analyze", input),
  /** Reanalyze one track only around a start picked in the alignment editor. */
  alignTrack: (input: GuidedAlignInput) => invoke<GuidedAlignmentResult>("lmplayer:alignTrack", input),
  loadLrc: (lrcPath: string) => invoke<ParsedLrc | null>("lmplayer:lrc", lrcPath),
  /** Native multi-select file dialog (videos, MP3, LRC). */
  pickFiles: () => invoke<string[]>("lmplayer:pickFiles"),
  exists: (paths: string[]) => invoke<Record<string, boolean>>("lmplayer:exists", paths),
  workspace: {
    load: () => invoke<WorkspaceFile | null>("lmplayer:workspace:load"),
    save: (workspace: WorkspaceFile) => invoke<void>("lmplayer:workspace:save", workspace),
    open: () => invoke<{ path: string; workspace: WorkspaceFile } | null>("lmplayer:workspace:open"),
    saveAs: (workspace: WorkspaceFile) => invoke<string | null>("lmplayer:workspace:saveAs", workspace),
  },
  clearCache: () => invoke<void>("lmplayer:cache:clear"),
  /** Must run in the preload: File objects cannot cross IPC. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  onProgress: (listener: (progress: AnalyzeProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: AnalyzeProgress) => listener(progress);
    ipcRenderer.on("lmplayer:analyze-progress", handler);
    return () => {
      ipcRenderer.off("lmplayer:analyze-progress", handler);
    };
  },
};

contextBridge.exposeInMainWorld("lmplayer", api);

export type LmplayerApi = typeof api;
