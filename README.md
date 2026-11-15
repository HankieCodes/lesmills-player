# LM Sync

**LM Sync** aligns Les Mills release MP3s to recordings of Hank teaching (and to masterclass videos) via local audio fingerprinting, then plays masterclass video + self video + LRC choreography in sync on one screen.

- **Repo:** `/home/hank/Developer/lmplayer`
- **Spec:** `/PLAN.md` (source of truth for scope, phases, and acceptance criteria)

## What it does

1. Scans source media folders for releases (folder → program/release, per-track MP3 + same-basename LRC, optional masterclass video).
2. For a selected video, extracts mono 44.1 kHz audio (`ffmpeg`) and fingerprints it plus each track MP3 (`fpcalc -json -raw -chunk`).
3. Runs a sliding Chromaprint fingerprint match (hamming-distance voting), with an FFT-free normalized cross-correlation fallback.
4. Writes an alignment JSON (`version`, video meta, release, per-track `videoStartSec`/`mp3StartSec`/`confidence`/`method`) into the Electron cache dir, keyed by SHA-256 of the media + release + aligner version.
5. Player uses a virtual master clock: MP3 timeline is canonical; element time = `videoStartSec + (masterTime − mp3StartSec)`; rAF loop hard-seeks past 0.30 s drift, nudges playback rate within 0.08–0.30 s.

## Prerequisites (Phase 0 host)

- `ffmpeg` + `fpcalc` (Chromaprint) on PATH — `sudo apt install ffmpeg chromaprint` (fpcalc ships with the chromaprint package).
- Source media folders (e.g. `/mnt/hdrive/docker/volumes/...`).

## Commands

```bash
pnpm install
pnpm dev        # esbuild watch + electron .
pnpm build      # tsc (main/preload/renderer) + esbuild bundle + copy index.html
pnpm test       # vitest
pnpm lint       # eslint
pnpm typecheck  # tsc across main/preload/renderer
```

## Layout

```
src/
├── shared/      # Alignment / LRC / release types (the IPC + player contract)
├── analyzer/    # LRC parser, fpcalc fingerprinting, alignment + fallback, Analyzer job
├── cache/       # user-data cache: SHA-256 keyed alignment JSONs + parsed LRCs
├── sync/        # virtual master clock + sync plan (pure, tested)
├── electron/    # main process (window, protocol, IPC, pickers, cache), preload bridge
└── renderer/    # React UI: releases, tiles, video, LRC scroller, transport
```

## Phases

See `PLAN.md` §8. Current implementation status: Phases 0–1 core logic landed (LRC parser, aligner, cache, clock, IPC surface, player sync loop, tiles/transport UI). Packaging (Phase 5) pending.
