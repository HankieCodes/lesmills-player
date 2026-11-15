import { execFileSync } from "child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FPCALC_VERSION = "1.6.2";
const FFMPEG_STATIC_TAG = "b6.1.1";

const CHROMAPRINT_URL = `https://github.com/acoustid/chromaprint/releases/download/v${FPCALC_VERSION}`;
const FFMPEG_STATIC_URL = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_STATIC_TAG}`;
const FFMPEG_WIN_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip";

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function fetchWindows(outDir, tmp) {
  const fpcalcDir = `chromaprint-fpcalc-${FPCALC_VERSION}-windows-x86_64`;
  await download(`${CHROMAPRINT_URL}/${fpcalcDir}.zip`, path.join(tmp, "fpcalc.zip"));
  execFileSync("unzip", ["-o", "-q", path.join(tmp, "fpcalc.zip"), "-d", tmp]);
  copyFileSync(path.join(tmp, fpcalcDir, "fpcalc.exe"), path.join(outDir, "fpcalc.exe"));

  await download(FFMPEG_WIN_URL, path.join(tmp, "ffmpeg.zip"));
  execFileSync("unzip", ["-o", "-q", path.join(tmp, "ffmpeg.zip"), "*/bin/ffmpeg.exe", "-d", tmp]);
  copyFileSync(path.join(tmp, "ffmpeg-master-latest-win64-lgpl", "bin", "ffmpeg.exe"), path.join(outDir, "ffmpeg.exe"));
}

async function fetchMac(outDir, tmp, arch) {
  const fpcalcArch = arch === "x64" ? "x86_64" : "arm64";
  const fpcalcDir = `chromaprint-fpcalc-${FPCALC_VERSION}-macos-${fpcalcArch}`;
  await download(`${CHROMAPRINT_URL}/${fpcalcDir}.tar.gz`, path.join(tmp, `${fpcalcDir}.tar.gz`));
  execFileSync("tar", ["-xzf", path.join(tmp, `${fpcalcDir}.tar.gz`), "-C", tmp]);
  copyFileSync(path.join(tmp, fpcalcDir, "fpcalc"), path.join(outDir, "fpcalc"));

  await download(`${FFMPEG_STATIC_URL}/ffmpeg-darwin-${arch}`, path.join(outDir, "ffmpeg"));
  chmodSync(path.join(outDir, "ffmpeg"), 0o755);
  chmodSync(path.join(outDir, "fpcalc"), 0o755);
}

const TARGETS = {
  win: { dir: "win", files: ["ffmpeg.exe", "fpcalc.exe"], fetch: fetchWindows },
  "mac-x64": { dir: "mac-x64", files: ["ffmpeg", "fpcalc"], fetch: (out, tmp) => fetchMac(out, tmp, "x64") },
  "mac-arm64": { dir: "mac-arm64", files: ["ffmpeg", "fpcalc"], fetch: (out, tmp) => fetchMac(out, tmp, "arm64") },
};
const GROUPS = { win: ["win"], mac: ["mac-x64", "mac-arm64"] };

const group = process.argv[2];
if (!GROUPS[group]) {
  console.error(`Usage: fetch-binaries.mjs <${Object.keys(GROUPS).join("|")}>`);
  process.exit(1);
}

for (const name of GROUPS[group]) {
  const target = TARGETS[name];
  const outDir = path.join(root, "resources", target.dir);
  if (target.files.every((file) => existsSync(path.join(outDir, file)))) {
    console.log(`Binaries already present in resources/${target.dir}`);
    continue;
  }
  mkdirSync(outDir, { recursive: true });
  const tmp = mkdtempSync(path.join(tmpdir(), "lmplayer-bin-"));
  try {
    await target.fetch(outDir, tmp);
    console.log(`Fetched ${target.files.join(" and ")} into resources/${target.dir}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
