# LM Sync — Build Plan

**For:** OpenCode agent (Hank builds with OpenCode; this plan is the spec)
**Prepared:** Nov 8, 2026, from live inventories of Hank's Dockhand instance and lmlyrics.brekke-peer.com
**One-liner:** Align Les Mills release MP3s to recordings of Hank teaching (and to masterclass videos) via audio fingerprinting, then play masterclass video + self video + LRC choreography in sync on one screen.

---

## 1. What exists already (do not rebuild)

| Piece | State |
|---|---|
| Choreography → timed lines | **LM Lyrics** (lmlyrics.brekke-peer.com) already converts choreography PDFs into one `.lrc` per track. Converts are ephemeral (deleted after download / 15 min) and it has no public API. **This project consumes its output files; it does not integrate with the service.** Note: lmlyrics does NOT run on the homelab host (no container) — it's hosted elsewhere. |
| Track MP3s | Local files (Les Mills Connect rips; previously in Jellyfin — now user-selected local files). |
| LRC files | **Assumption to verify in Phase 0:** the downloaded `.lrc` files live beside the MP3s in the source media folder (same basename), which is how they were consumed alongside the track MP3s — the consumption pattern LM Lyrics advertises. |
| Masterclass videos | Local video files (previously in Jellyfin — now user-selected local files). |
| Self-teaching videos | Local library / user-selected local files (previously in Immich — phone uploads). |
| LRC format emitted by LM Lyrics | Standard `[mm:ss.cc]` timestamps, **relative to the track MP3's own timeline**, one cue per line (rep counts + move name + lyric fragment in parentheses). No metadata tags were visible in public examples — verify against a real file in Phase 0. |

**v1 source model (updated post-web-app pivot):** all content is **local files** — choreography `.lrc`, track MP3s, masterclass/self videos — selected by the user in the desktop app via drag-and-drop / native file pickers. Remote connectors (e.g. Jellyfin) are future-phase only.

## 2. Verified environment (Dockhand, Nov 8, 2026)

Historical context from the Nov 8, 2026 verification — the v1 build is now an **Electron desktop app** and no longer runs in this Docker stack (see §3); kept for reference while planning the future remote-connector phase.

- Host: Docker 28.2.2, Linux x64, **8 cores, 4.9 GB RAM total, 131.6 GB disk**. RAM is the binding constraint — Immich + its ML container + Jellyfin + n8n already live here. Every new container gets a memory limit; the aligner processes one file at a time.
- Stacks are Dockhand-managed (environment "Homelab"), one compose project per stack. **Superseded:** this project is now an **Electron desktop app** instead of a Docker stack (see §3) — no `lmsync` compose project is planned.
- **Electron desktop app:** replaces the planned web app + Docker stack. Runs on the user's desktop PC (Windows/macOS/Linux); no server, Traefik or Cloudflare Access layer for v1. Media remains reachable via local paths (e.g. NAS mounts such as `/mnt/hdrive/...`).
- Reverse proxy: **Traefik v3.7** on the shared **`internal`** docker network (172.18.0.0/16). Services join `internal` and get Traefik labels; hostnames follow the `<name>-l.brekke-peer.com` pattern, gated by Cloudflare Access. Suggested hostname: `lmsync-l.brekke-peer.com` (confirm it's free; note Jellyfin's is `jellyfin-lp`, not `-l`).
- **Immich** (v3, `immich-server`): on `internal` + `database` networks, port 2283, hostname `immich-l.brekke-peer.com`. Library on the host at:
  `/mnt/hdrive/docker/volumes/immich_data/_data/library` (its `/data/library`).
- **Jellyfin** (`jellyfin/jellyfin:latest`): on `internal`, port 8096, hostname `jellyfin-lp.brekke-peer.com`. Media on the host at:
  `/mnt/hdrive/docker/volumes/jellyfin_data/_data/media` (its `/media`). Has `/dev/dri` (hardware transcoding) — this project does not need it.

## 3. Architecture

Desktop **Electron app** (main process + React renderer) + analyzer module + on-disk cache. All media access is **read-only**; the app never writes into the media/library folders.

```
lmsync (Electron app, desktop)
├── app      Electron main process (Node/TypeScript) — window, native file pickers, drag-and-drop, IPC to analyzer, playback protocol, cache; React renderer bundled in
├── analyzer Analyzer module — ffmpeg + fpcalc (Chromaprint); runs in the Electron main process (or as a subprocess); interface kept stable so it can later move to a NodeJS server in the cloud
└── cache    Electron user data dir (Linux: `~/.config/lmsync`, macOS: `~/Library/Application Support/lmsync`, Windows: `%APPDATA%\lmsync`) — analyzed-content cache + alignment JSONs + SQLite index
```

- v1 media sources: **local files** the user selects — choreography `.lrc`, track MP3s, masterclass/self videos — via drag-and-drop drop zones or native file pickers. Accessed read-only through Electron `fs`.
- Immich (self-videos): reachable via the Immich API (`http://immich:2283/api`, header `x-api-key`) or local library path, read-only, from inside the desktop app.
- No Docker/Traefik/Cloudflare Access layer for v1: the desktop app authenticates via the OS user session. The planned `lmsync` Dockhand stack, Traefik labels and Access policy are superseded.

**Analyzer/UI separation:** the analyzer is a standalone module behind a stable interface — given a video file + release folder, produce the alignment JSON (§4.1) + match report. The Electron UI talks to it over IPC today; if the analyzer later moves to a NodeJS server in the cloud, only the transport behind that interface changes. C++ libraries via Node C bindings (N-API) may be used for native audio processing later; fpcalc/Chromaprint stays the local v1 path.

## 4. Core idea / data model

Everything hangs off one fact: **LRC timestamps are relative to the track MP3**. If we know, for a given video, the offset at which each track's MP3 starts inside the video's audio, then:

- choreography line at MP3-time `t` appears at video-time `trackStart + t`
- the same LRC drives the masterclass video, the self video, and the bare MP3 identically

### 4.1 Alignment output (the contract everything else consumes)

One JSON per (video, release), stored in the cache dir's `alignments/` folder:

```json
{
  "version": 1,
  "video": {
    "source": "self" | "masterclass",
    "fileName": "2026-11-05_bodypump.mp4",
    "filePath": "/home/hank/Videos/…",
    "durationSec": 3721.4
  },
  "release": { "program": "BODYPUMP", "release": "131" },
  "tracks": [
    {
      "trackNo": 1,
      "mp3Path": "/…/01 - Warmup.mp3",
      "lrcPath": "/…/01 - Warmup.lrc",
      "videoStartSec": 62.31,
      "mp3StartSec": 0.0,
      "confidence": 0.93,
      "method": "chromaprint"
    }
  ],
  "generatedAt": "2026-11-08T…",
  "alignerVersion": "0.1.0"
}
```

Masterclass alignments are the same shape with `"source": "masterclass"` and a local file path instead of an asset ID. Unmatched tracks are **omitted and logged**, never guessed.

### 4.2 Library conventions (verify/adjust in Phase 0)

- A *release folder* in the source media folder(s) contains: one MP3 per track, one same-named `.lrc` per track, and optionally one masterclass video file.
- Track number comes from filename ordering (leading digits). Program/release parsed from folder name; keep a manual override map in the cache dir's `config.json` for folders that don't parse.

### 4.3 Analyzed-content cache (v1)

- Analyzed content (alignment JSONs + parsed LRCs + indexer state) is saved in the **cache folder** = the Electron user data dir for the app (Linux: `~/.config/lmsync`, macOS: `~/Library/Application Support/lmsync`, Windows: `%APPDATA%\lmsync`).
- Cache key: **SHA-256** hash of the analyzed media file's contents (plus release identity). Re-selecting the same file (by hash) → cache hit → reuse the cached alignment/LRC; no re-analysis.
- Alignment runs remain idempotent (keyed by file hash + aligner version).

## 5. Alignment algorithm (analyzer module)

Runs inside the Electron main process for v1 (or as a subprocess of it); the module boundary is what allows it to later move to a NodeJS server in the cloud. C++ libraries via Node C bindings (N-API) may be used for native audio processing later; fpcalc/Chromaprint stays the local v1 path.

Per video, per release:

1. Extract video audio: `ffmpeg -vn -ac 1 -ar 44100` to a temp WAV (mono is fine for fpcalc).
2. For each track MP3 in the release: `fpcalc -json` on the MP3 and on the video audio; run a sliding fingerprint match (Chromaprint raw fingerprints, hamming-distance alignment — e.g. adapt the approach used by `fpcalc`-based aligners / `chromaprint` Python bindings; do **not** use the AcoustID web service, this is fully local).
3. Record the best offset per track with its match score → `confidence`. Accept ≥ a threshold tuned in Phase 1 (start at the PoC's observed separation between true and false matches); below threshold, try the fallback; still below, omit + log.
4. **Fallback:** FFT cross-correlation of downsampled mono envelopes (numpy/scipy) for any track Chromaprint misses.
5. Sanity checks before writing JSON: track offsets strictly increasing; no two tracks claim overlapping spans (beyond crossfade tolerance ~10 s); each offset within video duration.

Known wrinkles, by design:

- **Per-track offsets, never one global offset** — Hank pauses/restarts between tracks when teaching; the model must absorb that.
- **Masterclass audio edits** may differ slightly from release MP3s (trimmed intros, mixed transitions). Per-track matching localizes the damage to that track; low confidence is surfaced in the UI, not hidden.
- Voice-over (Hank cueing) and room reverb: Chromaprint is robust to both; the PoC exists to prove it on Hank's real recordings.
- Clock drift within a single ≤6-min track is negligible; no drift term in v1.

## 6. The player (Electron app)

Desktop app (Electron main process + React renderer); one *session* = (release, self video, masterclass video) with their alignment JSONs + the release's LRC set.

- **Transport model:** a virtual master clock. Each media element's target time = its current track's `videoStartSec + (masterTime − trackMp3Start)`. The MP3 timeline is the canonical timeline for a session (LRC is native to it).
- **Sync loop:** `requestAnimationFrame`; if a playing video is > 0.30 s off target, hard-seek; if 0.08–0.30 s off, nudge `playbackRate` (0.95/1.05) until it converges. Pause/play/seek applies to all panes together.
- **Layout:** masterclass video and self video side by side (stacked on narrow screens), choreography pane listing the current track's LRC lines with the active line highlighted and auto-scrolling; lines are **clickable → seek all panes** to that cue.
- **Coaching controls:** track quick-jump (prev/next), loop current LRC block (between this line's timestamp and the next), ±5 s skip, playback speed (0.5/0.75/1/1.25), a per-track confidence badge (from alignment JSON) so Hank knows which syncs to distrust.
- **Media serving:** the app plays user-selected local files directly (Electron `<video>` playback; use a custom `lmsync://` asset protocol in the main process when serving Immich originals through the API instead of local paths). **Codec caveat:** phone videos may be HEVC — Safari plays it, Chrome largely doesn't. If Phase 0 confirms HEVC self-videos, the analyzer pre-generates 720p H.264 proxies into the cache dir (proxies only for self-videos, ~a few hundred MB each, with a config cap) and the player prefers the proxy for the self pane.

- **Source selection (v1):** content comes from local files via drag-and-drop onto drop zones or native file pickers — video drop zone (MOV/MP4) with an in-zone **Open…** button → `dialog.showOpenDialog` filtered to video; LRC drop zone with **Open…** → filtered to LRC; MP3 drop zone with **Open…** → filtered to MP3. Dropped paths are resolved via `webUtils.getPathForFile` (contextBridge) → IPC to main/analyzer.
- **Cache:** analyzed content is saved to the cache folder, keyed by SHA-256 (§4.3), and reused when the same file is selected again.
- **Session picker:** list indexed releases; for each, which self/masterclass alignments exist and their per-track confidence summary.

### 6.1 Workspace & tiles (v1)

- A *workspace* = the saved tile arrangement + which files are loaded. Saved automatically with any change; on launch the app reopens the last workspace or starts a new empty one.
- Tile types: **video tiles** (one per MOV — masterclass/self) placed in a **strict grid**; plus one **LRC scroller tile** holding the pooled MP3/LRC choreography content.
- Adding content: dragging a MOV in tiles it as a video tile; dragging/adding MP3/LRC content pools it into the single LRC scroller tile. Typical sessions: self + masterclass MOVs + LRC scroller, or just self MOV + LRC scroller.
- Layout: strict grid (tiles snap to grid; rearrange = reorder/resize within grid).
- Analysis: when a MOV is dropped into a workspace that has the LRC/MP3 set, analysis auto-runs against the pooled LRC set; progress bar at the bottom of the video tile being analyzed. MP3/LRC-only input needs no analysis.

### 6.2 Transport controls (v1)

- Per-tile video controls on video tiles; all controls drive the same virtual master clock (§ transport model above).
- **Master play/pause control:** bottom center, below all tiles; global transport control.

## 7. Electron IPC sketch (v1)

No HTTP API in v1 — the Electron main process exposes an internal IPC surface between renderer and main/analyzer.

- `lmsync:releases` — scan source media folder(s) for releases with tracks + LRCs (+ optional masterclass video)
- `lmsync:analyze` `{videoPath, releaseFolder}` — run alignment job (main → analyzer module); returns alignment JSON + match report
- `lmsync:alignment` / `lmsync:lrc` — get cached alignment JSON / parsed LRC lines `[{timeSec, text}]`
- Media: user-picked local files played directly; Immich originals via API/local path as before.

Auth: none in-app — the desktop app authenticates via the OS user session. No public routes.

## 8. Phases

**Phase 0 — Verify assumptions (no code beyond scripts)**
- [ ] Confirm `.lrc` files exist beside MP3s in the source media folder(s); capture one real `.lrc` and one release folder listing as fixtures (naming, metadata tags, track ordering).
- [ ] Confirm masterclass video location/format in the source media folder(s).
- [ ] Identify one recorded self-teaching video + its release; confirm the local source (user-picked file / Immich library path) is usable in the Electron app.
- [ ] Check self-video codec (`ffprobe`): H.264 vs HEVC → decides the proxy question in §6.
- [ ] Decide distribution: which OS should the Phase 5 Electron build ship first? (see §9 Q4)

**Phase 1 — Alignment proof of concept (analyzer module)**
- [ ] Analyzer module: given (video file, release folder) → alignment JSON per §4.1 + a match report.
- [ ] **Acceptance:** on Hank's sample class, ≥ 90 % of tracks align at high confidence, and spot-checked offsets (3 tracks × start/middle cue) land within ±0.5 s of the LRC cue heard in the video. If Chromaprint underperforms, evaluate the cross-correlation fallback as primary *before* proceeding — do not build the UI on an unproven aligner.

**Phase 2 — Indexer + job runner**
- [ ] Index source media folders + selected videos into the cache-dir SQLite; alignment jobs queue + run one-at-a-time with memory limits; re-run is idempotent (keyed by file hash + aligner version).

**Phase 3 — Analyzer module interface + Electron IPC** per §7, with fixture tests for the LRC parser (real file from Phase 0) and the alignment-JSON schema.

**Phase 4 — Player** per §6. Acceptance: a full class session plays with both videos + choreography staying in sync end-to-end (drift check at final track: active LRC line matches audio within ~0.5 s), click-to-seek and block-loop work. Workspace save/reopen (tiles + files) works (§6.1).

**Phase 5 — Package the Electron desktop app**
- [ ] Electron main process + React renderer; bundle via electron-builder; installers for Windows (first target), macOS, Linux.
- [ ] Smoke test: align one new class end-to-end through the desktop app.

## 9. Open questions for Hank

1. Where do the downloaded `.lrc` files actually live today — beside the MP3s in the source media folder, or somewhere else? (Phase 0 answers this if they're in the source folder; if not, where?)
2. How are masterclass videos organized in the source media folder(s) — same folder as the release's MP3s, or a separate folder?
3. Self-video identification: will you tag/album teaching videos in the local library, or should the selector treat "long videos not in a release" as candidates for manual release assignment in the UI? (Plan assumes: candidate list + manual release pick at align time.)
4. Desktop packaging: which OS should the Phase 5 Electron build ship first (Windows suggested)?

## 10. Risks & non-goals

- **Host RAM (4.9 GB)** is the top operational risk; no in-memory media processing, no extra always-on services, analyzer strictly serial.
- Masterclass edits that differ from release MP3s may leave individual tracks unalignable — acceptable; UI shows it honestly.
- A track Hank *skipped or restarted mid-track* while teaching will align to its first start; mid-track restarts are out of scope for v1 (note in UI when confidence is low).
- **Non-goals for v1:** no public/multi-user access, no accounts, no editing/re-export of videos, no changes to LM Lyrics, no writes to media/library folders, no mobile app. (Web-app deployment is retired; distribution is desktop Electron packaging.)
- **v2 spark (not in scope):** Whisper transcription of Hank's cueing track, diffed against LRC timestamps ("cued the combo 2 counts late") — noting the host's RAM makes on-host Whisper tight; would run elsewhere or on demand.

---

## Addendum — Proxmox layer (verified Nov 8, 2026, after the plan was written)

- The Docker host is **VM 101 `asus-flatcar-h1`** (Flatcar Container Linux, 10.0.0.12) on Proxmox VE 9.2.21, node `asus-proxmox` (Intel i3-1315U, 15.18 GiB host RAM).
- The VM is allocated **8 vCPU / 5 GiB RAM** and was running at ~101% of its RAM allocation during the check — the §2/§10 memory caution is not theoretical. Host RAM is fully committed across the three guests (Flatcar 5 GiB + dev-ubuntu1 VM 10 GiB + adguard-home LXC 0.15 GiB ≈ 15.15 of 15.18 GiB), so giving the Docker host more RAM means taking it from the dev VM.
- The VM's iGPU is passed through (that's Jellyfin's `/dev/dri`). Media storage (`/mnt/hdrive/...`) sits on the host's `hdrive1` ZFS pool (966 GB, ~51% used). VM 101 is backed up daily to Proxmox Backup Server.

---

## 11. Future phases (post-v1 backlog)

Planned while the initial Electron desktop build is being assembled; **not** part of the initial build:

- **Phase 6 — Remote content connectors (placeholder):** add source connectors (e.g. Jellyfin) alongside the local-file drop zones / native pickers, for loading remote content (track MP3s, masterclass videos, LRCs). The local-file path built in v1 must remain fully functional without any connector.
- **Phase 7 — Cloud analyzer server:** move the isolated analyzer module (§5) to a NodeJS server in the cloud (same interface); the Electron app becomes a thin client. C++ libraries via Node C bindings are already anticipated for native audio work.
