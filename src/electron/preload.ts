import { contextBridge, ipcRenderer } from "electron";
import type { AnalyzeInput } from "../analyzer/analyzer";
import type { Alignment, ParsedLrc, ReleaseFolder } from "../shared/types";

export interface LmsyncApi {
  releases: {
    list: (sourceFolders: string[]) => Promise<ReleaseFolder[]>;
  };
  analyze: {
    run: (input: AnalyzeInput) => Promise<unknown>;
  };
  alignment: {
    get: (key: string) => Promise<Alignment | null>;
  };
  lrc: {
    get: (key: string) => Promise<ParsedLrc | null>;
  };
  cache: {
    clear: () => Promise<void>;
  };
  file: {
    getPathForFile: (file: File) => Promise<string>;
  };
  pick: {
    video: () => Promise<{ canceled: boolean; filePath: string | null }>;
  };
  progress: {
    on: (listener: (progress: unknown) => void) => () => void;
  };
}

const api: LmsyncApi = {
  releases: {
    list: (sourceFolders: string[]) => ipcRenderer.invoke("lmsync:releases", sourceFolders),
  },
  analyze: {
    run: (input: AnalyzeInput) => ipcRenderer.invoke("lmsync:analyze", input),
  },
  alignment: {
    get: (key: string) => ipcRenderer.invoke("lmsync:alignment", key),
  },
  lrc: {
    get: (key: string) => ipcRenderer.invoke("lmsync:lrc", key),
  },
  cache: {
    clear: () => ipcRenderer.invoke("lmsync:cache:clear"),
  },
  file: {
    getPathForFile: (file: File) => ipcRenderer.invoke("lmsync:getPathForFile", file),
  },
  pick: {
    video: () => ipcRenderer.invoke("lmsync:pickVideo"),
  },
  progress: {
    on: (listener: (progress: unknown) => void) => {
      const handler = (_event: unknown, progress: unknown) => listener(progress);
      ipcRenderer.on("lmsync:analyze-progress", handler);
      return () => ipcRenderer.off("lmsync:analyze-progress", handler);
    },
  },
};

contextBridge.exposeInMainWorld("lmsync", api);

export type LmsyncApiBridge = typeof api;
