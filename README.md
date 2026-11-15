# LM Sync

Aligns Les Mills release MP3s to recordings of a class being taught (and to masterclass videos) with local audio fingerprinting, then plays the videos and the LRC choreography in sync. Electron desktop app; spec in [PLAN.md](PLAN.md).

## Using it

1. **Add release folder…** – pick a folder that contains release folders (`NN - name.mp3` with a same-named `NN - name.lrc`; e.g. `BODYPUMP 131/`). Folders are only read.
2. Select the release in the sidebar.
3. Choose whether the video is a *self-teaching recording* or a *masterclass*, then drop the video on the window or use **Open video…**. Matching runs one video at a time (progress shows in the new tile); results are cached by the video's SHA-256.
4. The first video is the reference: the master clock runs on its timeline and every other video is mapped to it track by track through the MP3 timeline. Click a choreography line to seek all videos, use **Loop block** to repeat the current LRC block, ±5 s, previous/next track, and 0.5–1.25× speed. Each video shows a sync-confidence badge for the current track; tracks that could not be matched are left out, never guessed.

The loaded release and videos are restored on the next launch.

## How alignment works

`ffmpeg` decodes the video and each MP3 to 11.025 kHz mono WAV; `fpcalc -raw` gives the Chromaprint fingerprint series (one 32-bit item per ~0.124 s). Four probe windows from each track are slid over the whole video; probes that agree on the implied track start vote for it, and confidence comes from the bit-error rate and probe agreement. A normalized envelope cross-correlation is the fallback. Offsets must increase from track to track and lie inside the video.

Confidence thresholds (`src/analyzer/status.ts`: ≥ 0.6 ok, 0.3–0.6 low, below 0.3 omitted) are **not yet tuned on real classes**; the end-to-end test only covers synthetic audio.

## Development

```bash
pnpm install
pnpm dev          # build + run Electron (needs ffmpeg and fpcalc on PATH on Linux/macOS)
pnpm test         # unit tests
pnpm lint
pnpm typecheck

# end-to-end alignment test on synthetic audio (needs real binaries)
LMSYNC_FFMPEG=/path/to/ffmpeg LMSYNC_FPCALC=/path/to/fpcalc pnpm test
```

## Windows build

```bash
pnpm dist:win     # downloads ffmpeg.exe + fpcalc.exe into resources/win, builds, writes dist/LM-Sync-<version>-win-x64.zip
```

The zip is unpacked-and-run (`LM Sync.exe`); ffmpeg and fpcalc ship inside it. It is unsigned, so SmartScreen will warn. An NSIS installer needs Wine when cross-building on Linux, so only the zip is produced here.

## Layout

```
src/shared/    types shared by main, preload and renderer (alignment JSON contract)
src/analyzer/  LRC parser, fingerprint/correlation matching, Analyzer job (ffmpeg + fpcalc)
src/cache/     SHA-256-keyed alignment and parsed-LRC cache in the Electron userData dir
src/sync/      master-clock mapping and drift correction (pure, tested)
src/electron/  main process, preload bridge, release folder scanner
src/renderer/  React UI
```
