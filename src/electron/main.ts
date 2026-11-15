import { app, BrowserWindow, dialog, ipcMain, protocol, webUtils } from "electron";
import { promises as fs } from "fs";
import * as path from "path";
import { Analyzer, type AnalyzeInput } from "../analyzer/analyzer";
import { clearCache, getCacheDir } from "../cache/cache";
import { scanReleaseFolders } from "./releases";
let analyzer: Analyzer | null = null;
let mainWindow: BrowserWindow | null = null;

function getAnalyzer(): Analyzer {
  if (analyzer === null) {
    analyzer = new Analyzer({ cacheDir: getCacheDir() });
  }
  return analyzer;
}

protocol.registerSchemesAsPrivileged([
  { scheme: "lmsync", privileges: { secure: true, standard: true, supportFetchAPI: true } },
]);

protocol.handle("lmsync", async (request) => {
  try {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const data = await fs.readFile(filePath);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    title: "LM Sync",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("lmsync:releases", async (_event, sourceFolders: string[]) => {
    return scanReleaseFolders(sourceFolders);
  });

  ipcMain.handle("lmsync:analyze", async (_event, input: AnalyzeInput) => {
    mainWindow?.webContents.send("lmsync:analyze-progress", { phase: "started", videoPath: input.videoPath });
    const result = await getAnalyzer().analyzeVideo(input);
    mainWindow?.webContents.send("lmsync:analyze-progress", { phase: "complete", cached: result.cached });
    return result;
  });

  ipcMain.handle("lmsync:alignment", async (_event, key: string) => {
    return getAnalyzer().getAlignment(key);
  });

  ipcMain.handle("lmsync:lrc", async (_event, key: string) => {
    return getAnalyzer().getParsedLrcBySha256(key);
  });

  ipcMain.handle("lmsync:cache:clear", async () => {
    await clearCache(getCacheDir());
    return { cleared: true };
  });

  ipcMain.handle("lmsync:getPathForFile", async (_event, file: File) => {
    if (!mainWindow) throw new Error("no window");
    return webUtils.getPathForFile(file);
  });

  ipcMain.handle("lmsync:pickVideo", async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win ?? undefined, {
      properties: ["openFile"],
      filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi"] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, filePath: null };
    }
    return { canceled: false, filePath: result.filePaths[0] };
  });

  ipcMain.on("lmsync:analyze-progress", (_event, progress: unknown) => {
    if (mainWindow) {
      mainWindow.webContents.send("lmsync:analyze-progress", progress);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
