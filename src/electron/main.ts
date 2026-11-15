import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import { createReadStream, promises as fs } from "fs";
import * as path from "path";
import { Readable } from "stream";
import { Analyzer, type AnalyzeInput } from "../analyzer/analyzer";
import { clearCache, getCacheDir, readJson, writeJson } from "../cache/cache";
import { AUDIO_EXTENSIONS, LRC_EXTENSIONS, VIDEO_EXTENSIONS } from "../shared/files";
import { parseWorkspace } from "../shared/workspace";
import type { WorkspaceFile } from "../shared/types";
import { log, logPath } from "./log";
import { contentTypeFor, type ByteRange, parseByteRange } from "./media";

const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);
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

let analyzer: Analyzer | null = null;
function getAnalyzer(): Analyzer {
  analyzer ??= new Analyzer({
    ffmpegPath: binaryPath("ffmpeg"),
    fpcalcPath: binaryPath("fpcalc"),
    cacheDir: getCacheDir(app.getPath("userData")),
    onProgress: (progress) => mainWindow?.webContents.send("lmsync:analyze-progress", progress),
  });
  return analyzer;
}

const workingWorkspacePath = () => path.join(app.getPath("userData"), "workspace.json");

const dotless = (extensions: string[]) => extensions.map((e) => e.slice(1));
const WORKSPACE_FILTER = { name: "LM Sync workspace", extensions: ["json"] };

/** A file body as a web stream, optionally just one byte range. */
function fileBody(filePath: string, range?: ByteRange): ReadableStream<Uint8Array> {
  const stream = createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined);
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

function registerMediaProtocol(): void {
  protocol.handle("lmsync", async (request) => {
    const url = new URL(request.url);
    let filePath: string;
    try {
      filePath = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (url.host !== "local" || !MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      return new Response("Forbidden", { status: 403 });
    }

    // <video> only learns it can seek when the response advertises byte ranges, and
    // net.fetch on file:// does not forward Range (electron/electron#38749), so ranges
    // are resolved here: 206 with Content-Range for a seek, 200 with the full size otherwise.
    let size: number;
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return new Response("Not found", { status: 404 });
      size = stat.size;
    } catch {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "no-store",
    });
    const range = parseByteRange(request.headers.get("range"), size);

    if (range.kind === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    if (request.method === "HEAD") {
      headers.set("Content-Length", String(size));
      return new Response(null, { status: 200, headers });
    }
    if (range.kind === "partial") {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
      return new Response(fileBody(filePath, range), { status: 206, headers });
    }
    headers.set("Content-Length", String(size));
    return new Response(fileBody(filePath), { status: 200, headers });
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
  const dialogFor = <T>(show: (parent: BrowserWindow | undefined) => Promise<T>) => show(mainWindow ?? undefined);

  ipcMain.handle("lmsync:pickFiles", async () => {
    const result = await dialogFor((parent) => {
      const options: Electron.OpenDialogOptions = {
        title: "Add videos, MP3s and LRC files",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "All supported files", extensions: dotless([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...LRC_EXTENSIONS]) },
          { name: "Videos", extensions: dotless(VIDEO_EXTENSIONS) },
          { name: "MP3 audio", extensions: dotless(AUDIO_EXTENSIONS) },
          { name: "LRC choreography", extensions: dotless(LRC_EXTENSIONS) },
          { name: "All files", extensions: ["*"] },
        ],
      };
      return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("lmsync:exists", async (_event, paths: string[]) => {
    const entries = await Promise.all(
      paths.map(async (p) => [p, await fs.access(p).then(() => true, () => false)] as const),
    );
    return Object.fromEntries(entries);
  });

  ipcMain.handle("lmsync:lrc", (_event, lrcPath: string) => getAnalyzer().loadLrc(lrcPath));

  // One alignment job at a time (see PLAN §10).
  ipcMain.handle("lmsync:analyze", (_event, input: AnalyzeInput) => {
    log("info", `analyze ${input.videoPath} against ${input.tracks.length} track(s)`);
    const job = analysisQueue.then(() => getAnalyzer().analyzeVideo(input));
    analysisQueue = job.catch((error: unknown) => log("error", "analysis failed", error));
    return job;
  });

  ipcMain.handle("lmsync:workspace:load", async () => parseWorkspace(await readJson<unknown>(workingWorkspacePath())));
  ipcMain.handle("lmsync:workspace:save", (_event, workspace: WorkspaceFile) => writeJson(workingWorkspacePath(), workspace));

  ipcMain.handle("lmsync:workspace:open", async () => {
    const options: Electron.OpenDialogOptions = { title: "Open workspace", properties: ["openFile"], filters: [WORKSPACE_FILTER] };
    const result = await dialogFor((parent) => (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)));
    if (result.canceled || result.filePaths.length === 0) return null;
    const workspace = parseWorkspace(await readJson<unknown>(result.filePaths[0]));
    if (workspace === null) throw new Error(`${path.basename(result.filePaths[0])} is not an LM Sync workspace file.`);
    return { path: result.filePaths[0], workspace };
  });

  ipcMain.handle("lmsync:workspace:saveAs", async (_event, workspace: WorkspaceFile) => {
    const options: Electron.SaveDialogOptions = {
      title: "Save a copy of the workspace",
      defaultPath: "class.lmsync.json",
      filters: [WORKSPACE_FILTER],
    };
    const result = await dialogFor((parent) => (parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)));
    if (result.canceled || !result.filePath) return null;
    await writeJson(result.filePath, workspace);
    return result.filePath;
  });

  ipcMain.handle("lmsync:cache:clear", () => clearCache(getCacheDir(app.getPath("userData"))));
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
