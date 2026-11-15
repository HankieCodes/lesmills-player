import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "resources", "win");
const FPCALC_URL =
  "https://github.com/acoustid/chromaprint/releases/download/v1.5.1/chromaprint-fpcalc-1.5.1-windows-x86_64.zip";
const FFMPEG_URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip";

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

if (existsSync(path.join(outDir, "ffmpeg.exe")) && existsSync(path.join(outDir, "fpcalc.exe"))) {
  console.log("Windows binaries already present in resources/win");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), "lmplayer-bin-"));
try {
  await download(FPCALC_URL, path.join(tmp, "fpcalc.zip"));
  execFileSync("unzip", ["-o", "-q", path.join(tmp, "fpcalc.zip"), "-d", tmp]);
  copyFileSync(
    path.join(tmp, "chromaprint-fpcalc-1.5.1-windows-x86_64", "fpcalc.exe"),
    path.join(outDir, "fpcalc.exe"),
  );

  await download(FFMPEG_URL, path.join(tmp, "ffmpeg.zip"));
  execFileSync("unzip", ["-o", "-q", path.join(tmp, "ffmpeg.zip"), "*/bin/ffmpeg.exe", "-d", tmp]);
  copyFileSync(path.join(tmp, "ffmpeg-master-latest-win64-lgpl", "bin", "ffmpeg.exe"), path.join(outDir, "ffmpeg.exe"));
  console.log("Fetched fpcalc.exe and ffmpeg.exe into resources/win");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
