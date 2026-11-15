import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Analyzer } from "./analyzer";
import type { AnalyzeTrackInput } from "../shared/types";

/**
 * End-to-end alignment test on synthetic audio. Needs real ffmpeg + fpcalc:
 *   LMSYNC_FFMPEG=/path/ffmpeg LMSYNC_FPCALC=/path/fpcalc pnpm test
 * Skipped otherwise.
 */
const ffmpeg = process.env.LMSYNC_FFMPEG;
const fpcalc = process.env.LMSYNC_FPCALC;
const RATE = 22050;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic "song": random notes with harmonics and a beat, distinct per seed. */
function synthTrack(seconds: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * RATE));
  const scale = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15];
  const base = 110 * 2 ** (rand() * 0.5);
  let i = 0;
  while (i < out.length) {
    const noteLen = Math.round((0.12 + rand() * 0.3) * RATE);
    const freq = base * 2 ** (scale[Math.floor(rand() * scale.length)] / 12) * (rand() < 0.3 ? 2 : 1);
    for (let n = 0; n < noteLen && i + n < out.length; n++) {
      const t = n / RATE;
      const env = Math.exp(-3 * t);
      out[i + n] +=
        env * (0.5 * Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(4 * Math.PI * freq * t) + 0.1 * Math.sin(6 * Math.PI * freq * t));
    }
    i += noteLen;
  }
  return out;
}

function noise(seconds: number, level: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * RATE));
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    lp = lp * 0.9 + (rand() - 0.5) * 0.1;
    out[i] = (lp * 6 + (rand() - 0.5) * 0.3) * level;
  }
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = Float32Array.from(a);
  for (let i = 0; i < out.length; i++) out[i] += b[i] ?? 0;
  return out;
}

function writeWav(file: string, samples: Float32Array): void {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * 0.6)) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

describe.skipIf(!ffmpeg || !fpcalc)("Analyzer end-to-end (synthetic audio)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmsync-e2e-"));
  const cacheDir = path.join(dir, "cache");
  const releaseDir = path.join(dir, "tracks");
  const videoPath = path.join(dir, "class.mp4");
  const TRACK_SEC = 40;
  // Where each track starts in the video (seconds), by construction.
  const starts = { 1: 12.4, 2: 70.9, 4: 140.2 };
  let trackInputs: AnalyzeTrackInput[];

  beforeAll(() => {
    fs.mkdirSync(releaseDir, { recursive: true });
    const tracks = [1, 2, 3, 4].map((n) => synthTrack(TRACK_SEC, 1000 + n));
    trackInputs = tracks.map((samples, i) => {
      const mp3Path = path.join(releaseDir, `0${i + 1} - Track.wav`);
      writeWav(mp3Path, samples);
      return { trackKey: `0${i + 1} - track`, trackNo: i + 1, mp3Path };
    });

    // Class recording: talking noise, tracks 1, 2 and 4 (3 is skipped), room noise + "voice-over" over everything.
    const parts: Float32Array[] = [];
    let cursor = 0;
    for (const [n, start] of Object.entries(starts)) {
      parts.push(noise(start - cursor, 0.8, 50 + Number(n)));
      parts.push(tracks[Number(n) - 1]);
      cursor = start + TRACK_SEC;
    }
    parts.push(noise(10, 0.8, 99));
    const dry = concat(parts);
    const voice = noise(dry.length / RATE, 0.6, 7);
    for (let i = 0; i < voice.length; i++) voice[i] *= 0.5 + 0.5 * Math.sin(i / 2000);
    const wet = mix(dry, voice);
    const wav = path.join(dir, "class.wav");
    writeWav(wav, wet);
    execFileSync(ffmpeg!, [
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=black:s=64x64:r=5",
      "-i", wav, "-shortest", "-c:v", "mpeg4", "-c:a", "aac", videoPath,
    ]);
  }, 120_000);

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("aligns present tracks within ±0.5 s, omits the skipped one, and only analyzes new MP3s on re-run", async () => {
    const analyzer = new Analyzer({ ffmpegPath: ffmpeg, fpcalcPath: fpcalc, cacheDir });
    const base = { videoPath, fileName: "class.mp4" };

    // Only tracks 1 and 3 are known at first (3 is not in the video).
    const first = await analyzer.analyzeVideo({ ...base, tracks: [trackInputs[0], trackInputs[2]] });
    expect(first.alignment.tracks.map((t) => t.trackNo)).toEqual([1]);
    expect(first.cachedTracks).toBe(0);

    // More MP3s arrive: the two already-known tracks come from the cache.
    const second = await analyzer.analyzeVideo({ ...base, tracks: trackInputs });
    expect(second.cachedTracks).toBe(2);
    console.log(JSON.stringify(second.matchReport.results, null, 1));
    const byNo = new Map(second.alignment.tracks.map((t) => [t.trackNo, t]));
    for (const [n, start] of Object.entries(starts)) {
      const track = byNo.get(Number(n));
      expect(track, `track ${n} matched`).toBeDefined();
      expect(Math.abs(track!.videoStartSec - start)).toBeLessThan(0.5);
    }
    expect(byNo.has(3)).toBe(false);
    expect(second.matchReport.results.find((r) => r.trackNo === 3)?.status).toBe("unmatched");

    const third = await analyzer.analyzeVideo({ ...base, tracks: trackInputs });
    expect(third.cachedTracks).toBe(4);
  }, 240_000);
});
