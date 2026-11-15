import { app, BrowserWindow, dialog, ipcMain, net, protocol } from "electron";
import * as path from "path";
import { pathToFileURL } from "url";
import { Analyzer, type AnalyzeInput } from "../analyzer/analyzer";
import { clearCache, getCacheDir } from "../cache/cache";
import { log, logPath } from "./log";
import { scanReleaseFolders } from "./releases";

const MEDIA_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mp3"]);
const exe = process.platform === "win32" ? ".exe" : "";

let mainWindow: BrowserWindow | null = null;
let analysisQueue: Promise<unknown> = Promise.resolve();

protocol.registerSchemesAsPrivileged([
  { scheme: "lmsync", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function binaryPath(name: "ffmpeg" | "fpcalc"): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "bin", `${name}${exe}`);
  const bundled = path.join(app.getAppPath(), "resources", process.platform === "win32" ? "win" : process.platform);
  return process.platform === "win32" ? path.join(bundled, `${name}${exe}`) : name;
}

function createAnalyzer(): Analyzer {
  return new Analyzer({
    ffmpegPath: binaryPath("ffmpeg"),
    fpcalcPath: binaryPath("fpcalc"),
    cacheDir: getCacheDir(app.getPath("userData")),
    onProgress: (progress) => mainWindow?.webContents.send("lmsync:analyze-progress", progress),
  });
}

function registerMediaProtocol(): void {
  protocol.handle("lmsync", (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname.slice(1));
    if (!MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      return new Response("Forbidden", { status: 403 });
    }
    // net.fetch on a file:// URL honours Range requests, which <video> seeking needs.
    return net.fetch(pathToFileURL(filePath).toString(), {
      headers: request.headers,
      bypassCustomProtocolHandlers: true,
    });
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    title: "LM Sync",
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
  });

  const wc = win.webContents;
  const levels = ["verbose", "info", "warn", "error"] as const;
  wc.on("console-message", (_e, level, message, line, sourceId) =>
    log(level >= 2 ? (level === 2 ? "warn" : "error") : "info", `[renderer:${levels[level] ?? level}] ${message} (${sourceId}:${line})`),
  );
  wc.on("preload-error", (_e, preloadPath, error) => log("error", `preload failed: ${preloadPath}`, error));
  wc.on("did-fail-load", (_e, code, description, url) => log("error", `did-fail-load ${code} ${description} ${url}`));
  wc.on("did-finish-load", () => log("info", `did-finish-load ${wc.getURL()}`));
  wc.on("render-process-gone", (_e, details) => log("error", "render-process-gone", details));
  wc.on("unresponsive", () => log("warn", "window unresponsive"));

  // F12 / Ctrl+Shift+I toggles DevTools even though the menu bar is hidden.
  wc.on("before-input-event", (event, input) => {
    const toggle = input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i");
    if (input.type === "keyDown" && toggle) {
      wc.toggleDevTools();
      event.preventDefault();
    }
  });
  if (process.argv.includes("--devtools") || process.env.LMSYNC_DEVTOOLS === "1") {
    wc.once("did-finish-load", () => wc.openDevTools({ mode: "detach" }));
  }

  const indexHtml = path.join(__dirname, "..", "renderer", "index.html");
  log("info", `loading ${indexHtml}`);
  void win.loadFile(indexHtml).catch((error: unknown) => log("error", "loadFile failed", error));
}

function registerIpc(): void {
  ipcMain.handle("lmsync:releases", (_event, folders: string[]) => scanReleaseFolders(folders));

  ipcMain.handle("lmsync:pickFolder", async () => {
    const options: Electron.OpenDialogOptions = { properties: ["openDirectory"], title: "Choose a release folder" };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  // One alignment job at a time (see PLAN §10).
  ipcMain.handle("lmsync:analyze", (_event, input: AnalyzeInput) => {
    log("info", `analyze ${input.videoPath} against ${input.release.program} ${input.release.release}`);
    const job = analysisQueue.then(() => createAnalyzer().analyzeVideo(input));
    analysisQueue = job.catch((error: unknown) => log("error", "analysis failed", error));
    return job;
  });

  ipcMain.handle("lmsync:cache:clear", async () => {
    await clearCache(getCacheDir(app.getPath("userData")));
  });
}

process.on("uncaughtException", (error) => log("error", "uncaughtException", error));
process.on("unhandledRejection", (reason) => log("error", "unhandledRejection", reason));

void app.whenReady().then(() => {
  log("info", `LM Sync ${app.getVersion()} electron ${process.versions.electron} ${process.platform} ${process.arch}`);
  log("info", `packaged=${app.isPackaged} resources=${process.resourcesPath} log=${logPath()}`);
  registerMediaProtocol();
  registerIpc();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
