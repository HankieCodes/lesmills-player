import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AnalyzeInput, AnalyzeOutput, AnalyzeProgress } from "../analyzer/analyzer";
import type { ReleaseFolder } from "../shared/types";

const api = {
  releases: {
    list: (folders: string[]): Promise<ReleaseFolder[]> => ipcRenderer.invoke("lmsync:releases", folders),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke("lmsync:pickFolder"),
  },
  analyze: (input: AnalyzeInput): Promise<AnalyzeOutput> => ipcRenderer.invoke("lmsync:analyze", input),
  cache: {
    clear: (): Promise<void> => ipcRenderer.invoke("lmsync:cache:clear"),
  },
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
