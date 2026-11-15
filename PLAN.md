# Les Mills Player — Build Plan

**For:** OpenCode agent (Hank builds with OpenCode; this plan is the spec)
**Prepared:** Nov 8, 2026, from live inventories of Hank's Dockhand instance and lmlyrics.brekke-peer.com
**One-liner:** Align Les Mills release MP3s to recordings of Hank teaching (and to masterclass videos) via audio fingerprinting, then play masterclass video + self video + LRC choreography in sync on one screen.

---

## 1. What exists already (do not rebuild)

| Piece | State |
|---|---|
| Choreography → timed lines | **LM Lyrics** (lmlyrics.brekke-peer.com) already converts choreography PDFs into one `.lrc` per track. Converts are ephemeral (deleted after download / 15 min) and it has no public API. **This project consumes its output files; it does not integrate with the service.** Note: lmlyrics does NOT run on the homelab host (no container) — it's hosted elsewhere. |
| Track MP3s | Local files (Les Mills Connect rips), added individually by the user — no folder or library structure is assumed. |
| LRC files | Local files downloaded from LM Lyrics, added individually. They are paired with MP3s **by file name** (§4.2); they do not need to live in the same folder. |
| Masterclass videos | Local video files, added individually. |
| Self-teaching videos | Local library / user-selected local files (previously in Immich — phone uploads). |
| LRC format emitted by LM Lyrics | Standard `[mm:ss.cc]` timestamps, **relative to the track MP3's own timeline**, one cue per line (rep counts + move name + lyric fragment in parentheses). No metadata tags were visible in public examples — verify against a real file in Phase 0. |

**v1 source model:** all content is **local files** — choreography `.lrc`, track MP3s, masterclass/self videos — added by the user in the desktop app via drag-and-drop onto the window or a native multi-select file picker. There are no release folders and no sidebar: any supported file can be added at any time, in any order. Remote connectors (e.g. Jellyfin) are future-phase only.

## 2. Verified environment (Dockhand, Nov 8, 2026)

Historical context from the Nov 8, 2026 verification — the v1 build is now an **Electron desktop app** and no longer runs in this Docker stack (see §3); kept for reference while planning the future remote-connector phase.

- Host: Docker 28.2.2, Linux x64, **8 cores, 4.9 GB RAM total, 131.6 GB disk**. RAM is the binding constraint — Immich + its ML container + Jellyfin + n8n already live here. Every new container gets a memory limit; the aligner processes one file at a time.
- Stacks are Dockhand-managed (environment "Homelab"), one compose project per stack. **Superseded:** this project is now an **Electron desktop app** instead of a Docker stack (see §3) — no `lmplayer` compose project is planned.
- **Electron desktop app:** replaces the planned web app + Docker stack. Runs on the user's desktop PC (Windows/macOS/Linux); no server, Traefik or Cloudflare Access layer for v1. Media remains reachable via local paths (e.g. NAS mounts such as `/mnt/hdrive/...`).
- Reverse proxy: **Traefik v3.7** on the shared **`internal`** docker network (172.18.0.0/16). Services join `internal` and get Traefik labels; hostnames follow the `<name>-l.brekke-peer.com` pattern, gated by Cloudflare Access. Suggested hostname: `lmplayer-l.brekke-peer.com` (confirm it's free; note Jellyfin's is `jellyfin-lp`, not `-l`).
- **Immich** (v3, `immich-server`): on `internal` + `database` networks, port 2283, hostname `immich-l.brekke-peer.com`. Library on the host at:
  `/mnt/hdrive/docker/volumes/immich_data/_data/library` (its `/data/library`).
- **Jellyfin** (`jellyfin/jellyfin:latest`): on `internal`, port 8096, hostname `jellyfin-lp.brekke-peer.com`. Media on the host at:
  `/mnt/hdrive/docker/volumes/jellyfin_data/_data/media` (its `/media`). Has `/dev/dri` (hardware transcoding) — this project does not need it.

## 3. Architecture

Desktop **Electron app** (main process + React renderer) + analyzer module + on-disk cache. All media access is **read-only**; the app never writes into the media/library folders.

```
lmplayer (Electron app, desktop)
├── app      Electron main process (Node/TypeScript) — window, native file pickers, drag-and-drop, IPC to analyzer, playback protocol, cache; React renderer bundled in
├── analyzer Analyzer module — ffmpeg + fpcalc (Chromaprint); runs in the Electron main process (or as a subprocess); interface kept stable so it can later move to a NodeJS server in the cloud
└── cache    Electron user data dir (Linux: `~/.config/lmplayer`, macOS: `~/Library/Application Support/lmplayer`, Windows: `%APPDATA%\lmplayer`) — analyzed-content cache + alignment JSONs + SQLite index
```

- v1 media sources: **local files** the user adds — choreography `.lrc`, track MP3s, masterclass/self videos — by dropping them anywhere on the window or via **Add files…** (native picker; accepts MP4, M4V, MOV, MKV, WebM, AVI, WMV, MPG, TS, 3GP, FLV, MP3, LRC). Accessed read-only through Electron `fs`.
- Immich (self-videos): reachable via the Immich API (`http://immich:2283/api`, header `x-api-key`) or local library path, read-only, from inside the desktop app.
- No Docker/Traefik/Cloudflare Access layer for v1: the desktop app authenticates via the OS user session. The planned `lmplayer` Dockhand stack, Traefik labels and Access policy are superseded.

**Analyzer/UI separation:** the analyzer is a standalone module behind a stable interface — given a video file + a list of MP3 tracks, produce the alignment JSON (§4.1) + match report. The Electron UI talks to it over IPC today; if the analyzer later moves to a NodeJS server in the cloud, only the transport behind that interface changes. C++ libraries via Node C bindings (N-API) may be used for native audio processing later; fpcalc/Chromaprint stays the local v1 path.

## 4. Core idea / data model

Everything hangs off one fact: **LRC timestamps are relative to the track MP3**. If we know, for a given video, the offset at which each track's MP3 starts inside the video's audio, then:

- choreography line at MP3-time `t` appears at video-time `trackStart + t`
- the same LRC drives the masterclass video, the self video, and the bare MP3 identically

### 4.1 Alignment output (the contract everything else consumes)

One JSON per video, rebuilt on every analysis and stored in the cache dir's `cache/alignments/` folder. It lists only the tracks that matched; its contents depend on which MP3s were available when it was built.

```json
{
  "version": 2,
  "video": {
    "fileName": "2026-11-05_bodypump.mp4",
    "filePath": "C:\\Users\\…\\2026-11-05_bodypump.mp4",
    "durationSec": 3721.4
  },
  "tracks": [
    {
      "trackKey": "01 - warmup",
      "trackNo": 1,
      "mp3Path": "C:\\…\\01 - Warmup.mp3",
      "videoStartSec": 62.31,
      "mp3StartSec": 0.0,
      "confidence": 0.93,
      "method": "chromaprint",
      "manual": false
    },
    {
      "trackKey": "02 - squats",
      "trackNo": 2,
      "mp3Path": "C:\\…\\02 - Squats.mp3",
      "videoStartSec": 402.5,
      "mp3StartSec": 0.0,
      "confidence": 0,
      "method": "manual",
      "manual": true
    }
  ],
  "generatedAt": "2026-11-08T…",
  "alignerVersion": "0.4.0"
}
```

`trackKey` is the normalized file-name stem and is the identity that joins an MP3, its LRC and every video's alignment. Whether a video is a *self* recording or a *masterclass* is a label stored in the workspace (§6.1), not in the alignment. Unmatched tracks are **omitted and reported**, never guessed. Tracks with a manual correction are always included, with `"manual": true`; `confidence` is the guided match's confidence, or 0 when the user's exact setting was used.

### 4.2 Tracks, pairing and the workspace file

- A **track** is identified by its file-name stem (case-insensitive, whitespace-normalized). `05 - Squats.mp3` and `05 - Squats.lrc` are the same track wherever they live on disk.
- The **track number** is the leading digits of the stem; files without one get the next free number in the order added. Tracks sort by number.
- A track exists as soon as **either** file is present. MP3 only: it aligns the videos but shows no choreography text. LRC only: it shows text but cannot be aligned yet.
- The **workspace** is a JSON file listing only what the user added; everything else is derived. `manualAlignments` are the user's alignment-editor corrections (§6.3), stored so they survive **Clear cache** and travel with **Save copy…**:

```json
{
  "version": 2,
  "videos": [{ "path": "…", "source": "self" | "masterclass" }],
  "mp3s": ["…"],
  "lrcs": ["…"],
  "manualAlignments": [
    { "videoPath": "…", "trackKey": "02 - squats", "startSec": 402.5, "method": "manual", "confidence": null }
  ]
}
```

A correction is keyed by `videoPath` + `trackKey`; re-saving replaces it. An absent entry means the track is aligned automatically. Files that disappear from the workspace drop their corrections too.

### 4.3 Analyzed-content cache (v1)

Everything derived lives under `cache/` in the Electron user data dir (Linux `~/.config/lmplayer`, macOS `~/Library/Application Support/lmplayer`, Windows `%APPDATA%\\lmplayer`). Entries are named only from SHA-256 digests and the aligner version, so names are valid on every OS.

- `hashes.json` — file SHA-256 remembered by path + size + mtime, so a large video is hashed once.
- `features/<sha>__<ver>.json` — fingerprint series + energy envelope of a video soundtrack or an MP3.
- `matches/<videoSha>__<mp3Sha>__<ver>.json` — the result of matching one MP3 against one video, **including "no match"**.
- Alignment-editor corrections are **not** cached here: they live in the workspace (`manualAlignments`, §4.2), so **Clear cache** keeps them, and a guided save never overwrites the automatic per-(video, MP3) match.
- `alignments/<videoSha>__<ver>.json` — the assembled alignment JSON (§4.1).
- `lrcs/<lrcSha>.json` — parsed LRC.

Because matches are cached per (video, MP3), adding one MP3 to a workspace only costs that MP3; renamed or moved files hit the cache by content hash. Bumping the aligner version invalidates everything. The workspace itself auto-saves to `workspace.json` in the user data dir.

---

## 5. Alignment algorithm (analyzer module)

Runs inside the Electron main process for v1 (or as a subprocess of it); the module boundary is what allows it to later move to a NodeJS server in the cloud. C++ libraries via Node C bindings (N-API) may be used for native audio processing later; fpcalc/Chromaprint stays the local v1 path.

Per video, for each MP3 track in the workspace:

1. Decode the video's audio and the MP3 to 11.025 kHz mono WAV with `ffmpeg` (once each; cached as *features*).
2. `fpcalc -json -raw -length 0` gives the Chromaprint raw fingerprint **series** (one 32-bit item ≈ every 0.124 s) for the whole video and for the MP3. Do **not** use the AcoustID web service; this is fully local.
3. Take four probe windows (~20 s) spread across the MP3 and slide each over the whole video, minimizing bit-error rate. Probes that agree on the implied track start vote for it; the winning start is scored over the whole overlap. `confidence` combines the best probe's bit-error rate with probe agreement.
4. **Fallback:** Pearson-normalized cross-correlation of the 4 Hz energy envelopes, accepted only at a higher confidence.
5. Sanity checks when assembling the alignment: tracks (in track-number order) must have strictly increasing starts, and each start must lie inside the video (≤ ~10 s before 0 is clamped). Violations are omitted with a reason.
6. **Manual corrections** win over the automatic result. When the alignment editor (§6.3) saves a lane, only that one track is reanalyzed: the video fingerprint and envelope are sliced from `selectedStart − 10 s` through `selectedStart + MP3 length + 5 s`. A confident match is accepted only if its implied start lands within `−10 s` to `+5 s` of the user's selection (one fingerprint item of slack at the bounds); otherwise the user's exact start is used with method `manual`. **A correction is never probed with the MP3 when the MP3's own automatic match already lies inside that window:** re-finding it there would snap the track back to the spot the user is moving away from, so the selected start is kept exactly. **When the MP3 is skipped, or finds no confident match**, the search retries with each other video's aligned audio for the same track as the probe: that video's fingerprint and envelope are sliced from its known start through the MP3's length and matched inside the edited video's window. The best accepted result from those references is used the same way and stored as `referenceVideoPath` in the guided result. Corrections are stored in the workspace (§4.2), not in the per-(video, MP3) match cache, so they are applied by every later analysis and are exempt from the increasing-order check (they never suppress another track's automatic match). Removing the MP3 or video removes its corrections.

Confidence bands (`src/analyzer/status.ts`): ≥ 0.6 ok, 0.3–0.6 low (shown as a warning), < 0.3 unmatched. **Not yet tuned on real classes** (Phase 1 acceptance).

Known wrinkles, by design:

- **Per-track offsets, never one global offset** — Hank pauses/restarts between tracks when teaching; the model must absorb that.
- **Masterclass audio edits** may differ slightly from release MP3s (trimmed intros, mixed transitions). Per-track matching localizes the damage to that track; low confidence is surfaced in the UI, not hidden.
- Voice-over (Hank cueing) and room reverb: Chromaprint is robust to both; the PoC exists to prove it on Hank's real recordings.
- Clock drift within a single ≤6-min track is negligible; no drift term in v1.

## 6. The player (Electron app)

Desktop app (Electron main process + React renderer); one *session* = the current workspace: its videos, with their alignment JSONs, plus the pooled MP3/LRC tracks.

- **Transport model:** a virtual master clock running on the **reference video's** timeline (the first video in the workspace). For any other video the target time is found through the MP3 timeline: reference time → track + MP3 time (`t = refTime − ref.videoStartSec`) → `video.videoStartSec + t`. LRC cues are native to the MP3 timeline. A video with no alignment (or any video when the reference has none) is **not synchronized**: it plays on the master clock from its own 0:00 and is flagged "not synced". When the reference has no alignment the choreography tile previews a chosen track against the video's time, labelled "not synced".
- **Sync loop:** `requestAnimationFrame`; if a playing video is > 0.30 s off target, hard-seek; if 0.08–0.30 s off, nudge `playbackRate` (0.95/1.05) until it converges. Pause/play/seek applies to all panes together.
- **Layout:** one strict grid of tiles — a tile per video plus the choreography tile — with no sidebar. The choreography tile lists the current track's LRC lines (active line highlighted, auto-scrolling; lines are **clickable → seek all panes** to that cue) and, below, the pooled track list: per track the MP3 / LRC present or missing, a remove button for each file, and each video's match status.
- **Coaching controls:** track quick-jump (prev/next), loop current LRC block (between this line's timestamp and the next), ±5 s skip, playback speed (0.5/0.75/1/1.25), a per-track confidence badge (from alignment JSON) so Hank knows which syncs to distrust.
- **Alignment editor:** a track name in the choreography tile's track table is a link. Clicking a track other than the active one jumps the master clock to that track's start; clicking the active track opens the editor (§6.3) so a wrong or missing match can be corrected by hand. A track with no start yet opens the editor directly, since there is nowhere to jump.
- **Media serving:** the app plays user-selected local files directly (Electron `<video>` playback; use a custom `lmplayer://` asset protocol in the main process when serving Immich originals through the API instead of local paths). **Codec caveat:** phone videos may be HEVC — Safari plays it, Chrome largely doesn't. If Phase 0 confirms HEVC self-videos, the analyzer pre-generates 720p H.264 proxies into the cache dir (proxies only for self-videos, ~a few hundred MB each, with a config cap) and the player prefers the proxy for the self pane.

- **Adding files (v1):** drop any supported file anywhere on the window, or use **Add files…** (native multi-select dialog, filters for all supported / videos / MP3 / LRC / all files). Dropped paths are resolved with `webUtils.getPathForFile` in the preload. Videos accept MP4, M4V, MOV, MKV, WebM, AVI, WMV, MPG/MPEG, TS, 3GP and FLV (playback still depends on Chromium codecs; alignment only needs the audio to decode).
- **Cache:** analyzed content is saved to the cache folder, keyed by SHA-256 (§4.3), and reused when the same files are added again.

### 6.1 Workspace & tiles (v1)

- A *workspace* is the JSON file described in §4.2: the videos (each labelled *self* or *masterclass*, default *self*, toggled by clicking the badge on its tile), MP3 paths, LRC paths and the user's alignment-editor corrections. It is saved automatically on every change to `workspace.json` in the user data dir and reopened on launch. **New** clears it, **Open…** loads a workspace file, **Save copy…** writes one anywhere. Files that have gone missing stay listed and are flagged; they are never analyzed.
- Tile types: **video tiles** (one per video) and one **choreography tile** holding the pooled MP3/LRC tracks, in a strict grid.
- Any file can be added at any time. Videos are playable immediately; with no MP3s they play unsynchronized from 0:00.
- **Analysis is automatic and incremental:** whenever the set of MP3s changes (or a video is added), every video whose alignment was built for a different MP3 set is re-analyzed. Jobs run one at a time; a progress bar and message show at the bottom of the video tile being analyzed. Because results are cached per (video, MP3) (§4.3), only new MP3s cost real work. MP3/LRC-only changes never need user action.

### 6.2 Transport controls (v1)

- Per-tile video controls on video tiles; all controls drive the same virtual master clock (§ transport model above).
- **Master play/pause control:** bottom center, below all tiles; global transport control.

### 6.3 Alignment editor (manual correction)

Opened by clicking the **active** track's name in the track table (only for tracks with a present MP3); clicking another track jumps the player to its start first. It pauses session playback.

- **Start-frame previews:** above the timeline, one `<video>` per video in the workspace, each seeked to that video's current start for this song. Playing one starts them **all** from their start frames, with every other preview muted; pausing any of them stops them all and returns each to its start frame.
- **Stacked timeline:** one lane per video on a **shared time axis** (0 → the longest video), so the same class moment lines up vertically. A rounded-rectangle ring marks the span from the chosen start through the MP3's length (clipped at the video's end and flagged if the song overruns it). Drag the ring (or click anywhere on a lane) to move the start; arrow keys nudge the selected lane by 0.1 s, Shift+arrow by 1 s, wherever focus sits in the modal. Next to the lane's time, a `+3.45 s` / `−1.20 s` indicator shows its change from the start it opened with.
- **Save:** only lanes the user actually changed are reanalyzed, one track at a time, with the narrow-window search in §5 step 6. A confident match may nudge the start, but a correction small enough that the automatic MP3 match lies inside the search window is never pulled back to it: the MP3 is not probed then, and only another video's aligned audio may nudge the selection. If the MP3 itself does not match, the other videos' aligned audio for the track is tried as a fallback probe and a match is reported as coming via that video. Otherwise the user's setting is stored directly. **Reset** on a lane removes its correction and returns that video to automatic analysis. Results are written to `manualAlignments` in the workspace (§4.2), then the normal analysis pass re-assembles the video's alignment; the track table and tiles show a **manual** badge.

## 7. Electron IPC sketch (v1)

No HTTP API in v1 — the Electron main process exposes an internal IPC surface between renderer and main/analyzer.

- `lmplayer:analyze` `{videoPath, fileName, tracks: [{trackKey, trackNo, mp3Path}], manualStarts: [{trackKey, startSec, method, confidence}]}` — run the alignment job (main → analyzer module, serialized); returns alignment JSON + match report; progress is pushed on `lmplayer:analyze-progress`
- `lmplayer:alignTrack` `{videoPath, mp3Path, startSec, fallbackVideos: [{videoPath, startSec}]}` — guided reanalysis for the alignment editor (§5 step 6); `fallbackVideos` are other videos already aligned for the same track. Returns `{startSec, matched, method, confidence, searchedFromSec, searchedToSec, referenceVideoPath, reason}`; `referenceVideoPath` is set when another video's audio produced the match. Shares the analyzer's one-job-at-a-time queue.
- `lmplayer:lrc` `path` — parsed LRC `{cues: [{timeSec, text}]}`
- `lmplayer:pickFiles` — native multi-select dialog; `lmplayer:exists` — which paths still exist
- `lmplayer:workspace:load` / `:save` — the auto-saved working workspace; `:open` / `:saveAs` — workspace files chosen by the user
- `lmplayer:cache:clear`
- Media: user-added local files are played through a `lmplayer://` protocol handler that supports Range requests (needed for seeking).

Auth: none in-app — the desktop app authenticates via the OS user session. No public routes.

## 8. Phases

**Phase 0 — Verify assumptions (no code beyond scripts)**
- [ ] Capture one real `.lrc` and a set of real MP3 file names as fixtures (naming, metadata tags, track numbering) to confirm the pairing rules in §4.2.
- [ ] Confirm masterclass video formats/codecs.
- [ ] Identify one recorded self-teaching video + its release; confirm the local source (user-picked file / Immich library path) is usable in the Electron app.
- [ ] Check self-video codec (`ffprobe`): H.264 vs HEVC → decides the proxy question in §6.
- [ ] Decide distribution: which OS should the Phase 5 Electron build ship first? (see §9 Q4)

**Phase 1 — Alignment proof of concept (analyzer module)**
- [x] Analyzer module: given (video file, MP3 tracks) → alignment JSON per §4.1 + a match report (verified on synthetic audio through AAC with noise; real classes still to do).
- [ ] **Acceptance:** on Hank's sample class, ≥ 90 % of tracks align at high confidence, and spot-checked offsets (3 tracks × start/middle cue) land within ±0.5 s of the LRC cue heard in the video. If Chromaprint underperforms, evaluate the cross-correlation fallback as primary *before* proceeding — do not build the UI on an unproven aligner.

**Phase 2 — Indexer + job runner**
- [x] Alignment jobs queue + run one-at-a-time; re-runs are idempotent and incremental (per-(video, MP3) cache keyed by content hashes + aligner version, §4.3). A SQLite index is no longer needed in v1.

**Phase 3 — Analyzer module interface + Electron IPC** per §7, with fixture tests for the LRC parser (real file from Phase 0), track pairing and the workspace file.

**Phase 4 — Player** per §6. Acceptance: a full class session plays with both videos + choreography staying in sync end-to-end (drift check at final track: active LRC line matches audio within ~0.5 s), click-to-seek and block-loop work. Workspace auto-save/reopen and Open / Save copy work (§6.1). The alignment editor (§6.3) can correct a wrong or missing track and the correction survives a restart and Clear cache.

**Phase 5 — Package the Electron desktop app**
- [ ] Electron main process + React renderer; bundle via electron-builder; installers for Windows (first target), macOS, Linux.
- [ ] Smoke test: align one new class end-to-end through the desktop app.

## 9. Open questions for Hank

1. ~~Where do the `.lrc` files live / how are masterclass videos organized?~~ Superseded: files are added individually; pairing is by file name (§4.2).
2. Self-video identification: videos start as *self*; click the badge to mark one *masterclass*. (Superseded the earlier "candidate list + manual release pick" idea.)
3. Do your real MP3 and LRC file names pair by identical stem? If LM Lyrics names its LRCs differently from the MP3s, the pairing rule needs adjusting.
4. Desktop packaging: Windows zip first (an NSIS installer needs Wine to cross-build on Linux); macOS/Linux builds later.

---

## 10. Risks & non-goals

- **Host RAM (4.9 GB)** is the top operational risk; no in-memory media processing, no extra always-on services, analyzer strictly serial.
- Masterclass edits that differ from release MP3s may leave individual tracks unalignable — acceptable; UI shows it honestly. The alignment editor (§6.3) lets Hank correct any wrong or missing match, and the correction is persisted in the workspace.
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
