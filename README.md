# LM Sync

Aligns Les Mills release MP3s to recordings of a class being taught (and to masterclass videos) with local audio fingerprinting, then plays the videos and the LRC choreography in sync. Electron desktop app; spec in [PLAN.md](PLAN.md).

## Using it

Add any of these, in any order, by dropping them on the window or with **Add files…**:

- **Videos** (MP4, M4V, MOV, MKV, WebM, AVI, …) — play immediately. Until they can be aligned they play unsynchronized from 0:00 and are marked "not synced". Click a video's *Self* / *Masterclass* badge to change its type.
- **MP3s** — the class's track audio. Once there are MP3s, every video is aligned to them automatically (one video at a time, progress at the bottom of its tile). Adding more MP3s later re-aligns videos, but only the new MP3s cost real work.
- **LRC files** — the choreography text. An LRC is paired with the MP3 that has the same file name (`05 - Squats.lrc` ↔ `05 - Squats.mp3`), wherever the files live. Track numbers come from the leading digits of the name.

The first video is the reference: the master clock runs on its timeline and every other video is mapped to it track by track through the MP3 timeline. Click a choreography line to seek all videos; **Loop block** repeats the current LRC block; there are ±5 s, previous/next track and 0.5–1.25× speed controls. The choreography tile's track table shows which MP3/LRC files are present and how each video matched each track (tracks that could not be matched are left out, never guessed).

Click a track's name in that table to jump the master player to that track's start; click the name of the track that is already playing to open the **alignment editor** (a track with no start yet opens the editor directly). The editor stacks every video on one shared timeline, with a video preview showing the chosen start frame; playing one starts every preview, with the others muted, and pausing returns them all to their start frames. Drag the highlighted span (or click the timeline; arrow keys nudge the selected lane by 0.1 s) to move where the song starts — the lane shows the change from its previous start, such as `+3.45 s`. **Save & reanalyze** reanalyzes only the videos you changed, searching the video audio from 10 s before the chosen start to 5 s past the song's length; a confident match may nudge the start slightly, otherwise your setting is used exactly. If the song's automatic match is already within that window, a small correction is kept exactly rather than snapping back to it; only the other videos' audio can nudge it. If the MP3 does not match at all, the other videos' already-aligned audio for that song is used as a fallback probe, and the result notes which video it matched through. **Reset** returns a video to automatic analysis. Corrections are stored in the workspace and survive Clear cache, Save copy and restart.

The workspace (just the list of files you added) auto-saves and reopens on the next launch. **New** clears it, **Open…** loads a workspace file and **Save copy…** writes one. Files are only ever read.

## How alignment works

`ffmpeg` decodes the video and each MP3 to 11.025 kHz mono WAV; `fpcalc -raw` gives the Chromaprint fingerprint series (one 32-bit item per ~0.124 s). Four probe windows from each track are slid over the whole video; probes that agree on the implied track start vote for it, and confidence comes from the bit-error rate and probe agreement. A normalized envelope cross-correlation is the fallback. Start times must increase from track to track and lie inside the video. Results are cached per (video, MP3) by content hash. A manual correction is applied on top and stored in the workspace instead of that cache.

Confidence thresholds (`src/analyzer/status.ts`: ≥ 0.6 ok, 0.3–0.6 low, below 0.3 omitted) are **not yet tuned on real classes**; the end-to-end test only covers synthetic audio.

## Troubleshooting

The app writes `%APPDATA%\lmsync\logs\main.log` (Linux: `~/.config/lmsync/logs/main.log`) with startup info, renderer console output and analysis errors. `F12` / `Ctrl+Shift+I` toggles DevTools; `--devtools` opens them at launch.

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
src/shared/    types, file classification, track pairing and workspace logic shared by main, preload and renderer
src/analyzer/  LRC parser, fingerprint/correlation matching, Analyzer job (ffmpeg + fpcalc)
src/cache/     content-hash-keyed feature, match, alignment and LRC cache in the Electron userData dir
src/sync/      master-clock mapping and drift correction (pure, tested)
src/electron/  main process, preload bridge, logging
src/renderer/  React UI
```
