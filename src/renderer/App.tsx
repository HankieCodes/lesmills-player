import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  elementTimeForTrack,
  findCurrentTrack,
  mp3TimeForTrack,
  planSync,
  targetForTile,
} from "../sync/clock";
import type { LrcCue, ReleaseFolder, VideoSource } from "../shared/types";
import { LrcScroller } from "./components/LrcScroller";
import { TransportBar } from "./components/TransportBar";
import { VideoTile } from "./components/VideoTile";
import type { LoopRange, PendingTileState, VideoTileState } from "./types";

const FOLDERS_KEY = "lmsync.folders";
const WORKSPACE_KEY = "lmsync.workspace";
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"];
const UI_UPDATE_MS = 100;

interface SavedWorkspace {
  releaseFolderPath: string | null;
  videos: Array<{ path: string; source: VideoSource }>;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function isVideo(name: string): boolean {
  return VIDEO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

export function App() {
  const [folders, setFolders] = useState<string[]>(() => loadJson<string[]>(FOLDERS_KEY, []));
  const [releases, setReleases] = useState<ReleaseFolder[]>([]);
  const [releasesLoaded, setReleasesLoaded] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(
    () => loadJson<SavedWorkspace>(WORKSPACE_KEY, { releaseFolderPath: null, videos: [] }).releaseFolderPath,
  );
  const [source, setSource] = useState<VideoSource>("self");
  const [tiles, setTiles] = useState<VideoTileState[]>([]);
  const [pending, setPending] = useState<PendingTileState[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [loop, setLoop] = useState<LoopRange | null>(null);
  const [timeSec, setTimeSec] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const masterRef = useRef(0);
  const tilesRef = useRef<VideoTileState[]>([]);
  tilesRef.current = tiles;
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const loopRef = useRef<LoopRange | null>(null);
  loopRef.current = loop;
  const videoEls = useRef(new Map<string, HTMLVideoElement>());
  const idSeq = useRef(0);
  const restored = useRef(false);

  const selectedRelease = useMemo(
    () => releases.find((r) => r.folderPath === selectedPath) ?? null,
    [releases, selectedPath],
  );
  const reference = tiles[0] ?? null;
  const durationSec = reference?.alignment.video.durationSec ?? 0;

  const syncElements = useCallback((masterSec: number, forceSeek: boolean) => {
    const ref = tilesRef.current[0];
    if (!ref) return;
    for (const tile of tilesRef.current) {
      const el = videoEls.current.get(tile.id);
      if (!el) continue;
      const { targetSec } = targetForTile(ref.alignment, tile.alignment, masterSec);
      const outside = targetSec === null || targetSec < 0 || (el.duration > 0 && targetSec > el.duration);
      if (outside) {
        if (!el.paused) el.pause();
        continue;
      }
      if (forceSeek) el.currentTime = targetSec;
      if (!playingRef.current) continue;
      if (el.paused) void el.play().catch(() => undefined);
      const plan = planSync(el.currentTime, targetSec, { baseRate: speedRef.current });
      if (plan.action === "hard-seek") el.currentTime = plan.targetSec;
      if (el.playbackRate !== plan.rate) el.playbackRate = plan.rate;
    }
  }, []);

  const seek = useCallback(
    (sec: number) => {
      const max = tilesRef.current[0]?.alignment.video.durationSec ?? 0;
      const clamped = Math.min(Math.max(0, sec), max);
      masterRef.current = clamped;
      setTimeSec(clamped);
      syncElements(clamped, true);
    },
    [syncElements],
  );

  const pauseAll = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    for (const el of videoEls.current.values()) el.pause();
  }, []);

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      pauseAll();
      return;
    }
    if (tilesRef.current.length === 0) return;
    playingRef.current = true;
    setPlaying(true);
    syncElements(masterRef.current, true);
  }, [pauseAll, syncElements]);

  // Virtual master clock + sync loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    let lastUi = 0;
    const tick = (ts: number) => {
      const dt = last === null ? 0 : (ts - last) / 1000;
      last = ts;
      let forceSeek = false;
      masterRef.current += dt * speedRef.current;
      const range = loopRef.current;
      if (range && masterRef.current >= range.endSec) {
        masterRef.current = range.startSec;
        forceSeek = true;
      }
      const max = tilesRef.current[0]?.alignment.video.durationSec ?? 0;
      if (masterRef.current >= max) {
        masterRef.current = max;
        setTimeSec(max);
        pauseAll();
        return;
      }
      syncElements(masterRef.current, forceSeek);
      if (ts - lastUi >= UI_UPDATE_MS || forceSeek) {
        lastUi = ts;
        setTimeSec(masterRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, syncElements, pauseAll]);

  const setSpeed = useCallback((next: number) => {
    speedRef.current = next;
    setSpeedState(next);
    for (const el of videoEls.current.values()) el.playbackRate = next;
  }, []);

  const registerRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) videoEls.current.set(id, el);
    else videoEls.current.delete(id);
  }, []);

  // Folders / releases.
  useEffect(() => {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    let cancelled = false;
    setReleasesLoaded(false);
    void window.lmsync.releases.list(folders).then((found) => {
      if (cancelled) return;
      setReleases(found);
      setReleasesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [folders]);

  useEffect(() => {
    return window.lmsync.onProgress((progress) => {
      setPending((prev) =>
        prev.length === 0
          ? prev
          : prev.map((p, i) => (i === 0 ? { ...p, message: progress.message, fraction: progress.fraction } : p)),
      );
    });
  }, []);

  // Dropping a file anywhere must never navigate the window to it.
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const addVideo = useCallback(async (filePath: string, videoSource: VideoSource, release: ReleaseFolder | null) => {
    if (release === null) {
      setMessage("Pick a release in the sidebar first, then add the video.");
      return;
    }
    if (tilesRef.current.some((t) => t.path === filePath)) {
      setMessage(`${fileNameOf(filePath)} is already loaded.`);
      return;
    }
    const id = `video-${idSeq.current++}`;
    const fileName = fileNameOf(filePath);
    setMessage(null);
    setPending((prev) => [...prev, { id, fileName, message: "Queued…", fraction: 0, error: null }]);
    try {
      const result = await window.lmsync.analyze({
        videoPath: filePath,
        source: videoSource,
        fileName,
        release: { program: release.program, release: release.release },
        releaseFolder: release,
      });
      setPending((prev) => prev.filter((p) => p.id !== id));
      if (result.alignment.tracks.length === 0) {
        const reasons = result.matchReport.results.map((r) => `track ${r.trackNo}: ${r.reason}`).join("; ");
        setMessage(`No tracks of ${release.program} ${release.release} could be matched in ${fileName}. ${reasons}`);
        return;
      }
      const unmatched = result.matchReport.results.filter((r) => r.status === "unmatched");
      if (unmatched.length > 0) {
        setMessage(`${fileName}: ${unmatched.length} track(s) could not be matched and were left out.`);
      }
      setTiles((prev) => [
        ...prev,
        {
          id,
          source: videoSource,
          path: filePath,
          fileName,
          release,
          alignment: result.alignment,
          matchReport: result.matchReport,
          lrcs: result.lrcs,
        },
      ]);
    } catch (error) {
      setPending((prev) => prev.filter((p) => p.id !== id));
      setMessage(`Could not analyze ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const removeTile = useCallback(
    (id: string) => {
      pauseAll();
      setLoop(null);
      masterRef.current = 0;
      setTimeSec(0);
      setTiles((prev) => prev.filter((t) => t.id !== id));
    },
    [pauseAll],
  );

  // Workspace: restore once the release list is known, then save on every change.
  useEffect(() => {
    if (restored.current || !releasesLoaded) return;
    restored.current = true;
    const saved = loadJson<SavedWorkspace>(WORKSPACE_KEY, { releaseFolderPath: null, videos: [] });
    const release = releases.find((r) => r.folderPath === saved.releaseFolderPath) ?? null;
    if (release === null) return;
    for (const video of saved.videos) void addVideo(video.path, video.source, release);
  }, [releasesLoaded, releases, addVideo]);

  useEffect(() => {
    if (!restored.current) return;
    const workspace: SavedWorkspace = {
      releaseFolderPath: selectedPath,
      videos: tiles.map((t) => ({ path: t.path, source: t.source })),
    };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  }, [tiles, selectedPath]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      for (const file of Array.from(files)) {
        if (!isVideo(file.name)) {
          setMessage(`${file.name}: drop a video here. Releases (MP3 + LRC) are added as folders in the sidebar.`);
          continue;
        }
        void addVideo(window.lmsync.pathForFile(file), source, selectedRelease);
      }
    },
    [addVideo, selectedRelease, source],
  );

  const addFolder = useCallback(async () => {
    const folder = await window.lmsync.releases.pickFolder();
    if (folder !== null) setFolders((prev) => (prev.includes(folder) ? prev : [...prev, folder]));
  }, []);

  // Derived playback state.
  const refTrack = reference ? findCurrentTrack(reference.alignment, timeSec) : null;
  const mp3Time = refTrack ? mp3TimeForTrack(refTrack, timeSec) : null;
  const refTrackNo = refTrack?.trackNo ?? null;
  const cues = useMemo<LrcCue[]>(
    () => (reference && refTrackNo !== null ? (reference.lrcs[refTrackNo]?.cues ?? []) : []),
    [reference, refTrackNo],
  );
  let activeIndex = -1;
  if (mp3Time !== null) {
    cues.forEach((cue, i) => {
      if (cue.timeSec <= mp3Time) activeIndex = i;
    });
  }

  const onCueClick = useCallback(
    (cue: LrcCue) => {
      if (refTrack) seek(elementTimeForTrack(refTrack, cue.timeSec));
    },
    [refTrack, seek],
  );

  const toggleLoop = useCallback(() => {
    if (loopRef.current) {
      setLoop(null);
      return;
    }
    if (!refTrack || cues.length === 0) return;
    const index = Math.max(0, activeIndex);
    const start = cues[index].timeSec;
    const end = cues[index + 1]?.timeSec ?? start + 8;
    setLoop({
      startSec: elementTimeForTrack(refTrack, start),
      endSec: elementTimeForTrack(refTrack, end),
      trackNo: refTrack.trackNo,
      cueIndex: index,
    });
  }, [refTrack, cues, activeIndex]);

  const sortedTracks = useMemo(
    () => (reference ? [...reference.alignment.tracks].sort((a, b) => a.videoStartSec - b.videoStartSec) : []),
    [reference],
  );

  const nextTrack = useCallback(() => {
    const next = sortedTracks.find((t) => t.videoStartSec > masterRef.current + 0.5);
    if (next) seek(next.videoStartSec);
  }, [sortedTracks, seek]);

  const prevTrack = useCallback(() => {
    const current = findCurrentTrack(tilesRef.current[0].alignment, masterRef.current);
    if (current && masterRef.current - current.videoStartSec > 3) {
      seek(current.videoStartSec);
      return;
    }
    const before = sortedTracks.filter((t) => t.videoStartSec < (current?.videoStartSec ?? masterRef.current));
    seek(before.length > 0 ? before[before.length - 1].videoStartSec : 0);
  }, [sortedTracks, seek]);

  const gridCount = tiles.length + pending.length + 1;

  return (
    <div className="app">
      <div className="app-body">
        <aside className="sidebar">
          <h2>Releases</h2>
          <p className="hint">
            Add a folder that contains release folders (MP3s with same-named LRC files). Nothing in it is modified.
          </p>
          <button className="primary" onClick={() => void addFolder()}>
            Add release folder…
          </button>
          {folders.map((f) => (
            <div className="folder-row" key={f} title={f}>
              <span>{f}</span>
              <button onClick={() => setFolders((prev) => prev.filter((x) => x !== f))}>✕</button>
            </div>
          ))}
          <div className="release-list">
            {releasesLoaded && releases.length === 0 && folders.length > 0 && (
              <p className="hint">No releases found (needs NN - name.mp3 plus NN - name.lrc).</p>
            )}
            {releases.map((r) => (
              <div
                key={r.folderPath}
                className={`release-row${r.folderPath === selectedPath ? " selected" : ""}`}
                onClick={() => setSelectedPath(r.folderPath)}
                title={r.folderPath}
              >
                <span>
                  {r.program} {r.release}
                </span>
                <span className="dim">{r.tracks.length} tracks</span>
              </div>
            ))}
          </div>
          <h2>Add video</h2>
          <label className="field">
            This video is a
            <select value={source} onChange={(e) => setSource(e.target.value as VideoSource)}>
              <option value="self">Self-teaching recording</option>
              <option value="masterclass">Masterclass</option>
            </select>
          </label>
          <label className="file-button primary">
            Open video…
            <input
              type="file"
              multiple
              accept={VIDEO_EXTENSIONS.join(",")}
              hidden
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {selectedRelease?.masterclassVideoPath && (
            <button onClick={() => void addVideo(selectedRelease.masterclassVideoPath!, "masterclass", selectedRelease)}>
              Load this release's masterclass video
            </button>
          )}
          <button onClick={() => void window.lmsync.cache.clear().then(() => setMessage("Analysis cache cleared."))}>
            Clear analysis cache
          </button>
        </aside>
        <main
          className="content"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
        >
          {message && (
            <div className="message" onClick={() => setMessage(null)}>
              {message}
            </div>
          )}
          <div className="workspace" style={{ ["--cols" as string]: Math.min(gridCount, 3) }}>
            {tiles.length === 0 && pending.length === 0 && (
              <div className="empty">
                <h2>LM Sync</h2>
                <p>1. Add a release folder · 2. Select the release · 3. Drop a video of the class here</p>
              </div>
            )}
            {tiles.map((tile, index) => {
              const target = reference ? targetForTile(reference.alignment, tile.alignment, timeSec) : null;
              const trackAlignment = tile.alignment.tracks.find((t) => t.trackNo === target?.trackNo);
              return (
                <VideoTile
                  key={tile.id}
                  tile={tile}
                  isReference={index === 0}
                  confidence={trackAlignment?.confidence ?? null}
                  missingTrack={target?.trackNo != null && !trackAlignment}
                  registerRef={registerRef}
                  onRemove={removeTile}
                />
              );
            })}
            {pending.map((p) => (
              <div className="tile" key={p.id}>
                <div className="tile-header">
                  <span className="tile-title">{p.fileName}</span>
                </div>
                <div className="video-wrap pending">
                  <span>{p.message}</span>
                  <div className="progress">
                    <div style={{ width: `${Math.round(p.fraction * 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
            {tiles.length > 0 && (
              <LrcScroller
                title={refTrack ? `Track ${refTrack.trackNo} – choreography` : "Choreography"}
                cues={cues}
                activeIndex={activeIndex}
                loopIndex={loop && refTrack && loop.trackNo === refTrack.trackNo ? loop.cueIndex : null}
                onCueClick={onCueClick}
              />
            )}
          </div>
        </main>
      </div>
      <TransportBar
        playing={playing}
        disabled={tiles.length === 0}
        timeSec={timeSec}
        durationSec={durationSec}
        speed={speed}
        trackNo={refTrack?.trackNo ?? null}
        loopActive={loop !== null}
        onTogglePlay={togglePlay}
        onSkip={(delta) => seek(masterRef.current + delta)}
        onSetSpeed={setSpeed}
        onNextTrack={nextTrack}
        onPrevTrack={prevTrack}
        onToggleLoop={toggleLoop}
        onSeek={seek}
      />
    </div>
  );
}
