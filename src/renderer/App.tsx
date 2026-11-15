import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileNameOf, VIDEO_EXTENSIONS } from "../shared/files";
import { buildTracks } from "../shared/tracks";
import { addPaths, emptyWorkspace, removePath, setVideoSource } from "../shared/workspace";
import type { Alignment, LrcCue, ParsedLrc, WorkspaceFile } from "../shared/types";
import { elementTimeForTrack, findCurrentTrack, isAligned, planSync, targetForTile } from "../sync/clock";
import { ChoreographyTile, type VideoColumn } from "./components/ChoreographyTile";
import { TransportBar } from "./components/TransportBar";
import { VideoTile } from "./components/VideoTile";
import type { LoopRange, VideoAnalysis } from "./types";

const UI_UPDATE_MS = 100;
const SAVE_DEBOUNCE_MS = 300;
const NO_ANALYSIS: VideoAnalysis = { sig: null, alignment: null, report: null, running: null, error: null };

interface PlaybackView {
  videos: Array<{ path: string; alignment: Alignment | null; isReference: boolean }>;
  durationSec: number;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceFile>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [analysis, setAnalysis] = useState<Record<string, VideoAnalysis>>({});
  const [lrcs, setLrcs] = useState<Record<string, ParsedLrc>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [loop, setLoop] = useState<LoopRange | null>(null);
  const [timeSec, setTimeSec] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const masterRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const loopRef = useRef<LoopRange | null>(null);
  loopRef.current = loop;
  const videoEls = useRef(new Map<string, HTMLVideoElement>());
  const viewRef = useRef<PlaybackView>({ videos: [], durationSec: 0 });
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const tracks = useMemo(() => buildTracks(workspace.mp3s, workspace.lrcs), [workspace.mp3s, workspace.lrcs]);
  const analyzable = useMemo(
    () =>
      tracks
        .filter((t) => t.mp3Path !== null && !missing.has(t.mp3Path))
        .map((t) => ({ trackKey: t.key, trackNo: t.trackNo, mp3Path: t.mp3Path as string })),
    [tracks, missing],
  );
  const sig = useMemo(() => analyzable.map((t) => `${t.trackKey}=${t.mp3Path}`).join("|"), [analyzable]);

  const videos = useMemo(
    () =>
      workspace.videos.map((v) => ({
        ...v,
        fileName: fileNameOf(v.path),
        missing: missing.has(v.path),
        analysis: analysis[v.path] as VideoAnalysis | undefined,
        alignment: analysis[v.path]?.alignment ?? null,
      })),
    [workspace.videos, missing, analysis],
  );
  const reference = videos.find((v) => !v.missing) ?? null;
  const refAlignment = reference?.alignment ?? null;
  const durationSec = (reference && durations[reference.path]) || refAlignment?.video.durationSec || 0;
  const playableCount = videos.filter((v) => !v.missing).length;

  viewRef.current = {
    videos: videos.filter((v) => !v.missing).map((v) => ({ path: v.path, alignment: v.alignment, isReference: v === reference })),
    durationSec,
  };

  const syncElements = useCallback((masterSec: number, forceSeek: boolean) => {
    const { videos: list } = viewRef.current;
    const refAlign = list.find((v) => v.isReference)?.alignment ?? null;
    for (const video of list) {
      const el = videoEls.current.get(video.path);
      if (!el) continue;
      const { targetSec } = targetForTile(refAlign, video.alignment, masterSec, video.isReference);
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
      const max = viewRef.current.durationSec;
      const clamped = Math.max(0, max > 0 ? Math.min(sec, max) : sec);
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
    if (viewRef.current.videos.length === 0) return;
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
      const max = viewRef.current.durationSec;
      if (max > 0 && masterRef.current >= max) {
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

  const registerRef = useCallback((path: string, el: HTMLVideoElement | null) => {
    if (el) videoEls.current.set(path, el);
    else videoEls.current.delete(path);
  }, []);

  const onDuration = useCallback((path: string, sec: number) => {
    if (Number.isFinite(sec)) setDurations((prev) => (prev[path] === sec ? prev : { ...prev, [path]: sec }));
  }, []);

  // Workspace: load the last one on launch, then auto-save every change.
  useEffect(() => {
    void window.lmsync.workspace.load().then((saved) => {
      if (saved) setWorkspace(saved);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void window.lmsync.workspace.save(workspace), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [ready, workspace]);

  // Which workspace files are gone from disk.
  useEffect(() => {
    const paths = [...workspace.videos.map((v) => v.path), ...workspace.mp3s, ...workspace.lrcs];
    if (paths.length === 0) {
      setMissing((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    let cancelled = false;
    void window.lmsync.exists(paths).then((found) => {
      if (!cancelled) setMissing(new Set(paths.filter((p) => !found[p])));
    });
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  useEffect(() => {
    for (const lrcPath of workspace.lrcs) {
      if (lrcs[lrcPath] || missing.has(lrcPath)) continue;
      void window.lmsync.loadLrc(lrcPath).then((parsed) => {
        if (parsed) setLrcs((prev) => ({ ...prev, [lrcPath]: parsed }));
        else setMessage(`${fileNameOf(lrcPath)} could not be read as an LRC file.`);
      });
    }
  }, [workspace.lrcs, lrcs, missing]);

  // Re-analyze whenever a video has not yet been aligned against the current set of MP3s.
  useEffect(() => {
    if (!ready) return;
    for (const video of workspace.videos) {
      if (missing.has(video.path)) continue;
      const current = analysis[video.path];
      if (current?.running) continue;
      if (analyzable.length === 0) {
        if (current && (current.alignment || current.sig !== null)) setAnalysis((prev) => ({ ...prev, [video.path]: NO_ANALYSIS }));
        continue;
      }
      if (current?.sig === sig) continue;
      const videoPath = video.path;
      const startedSig = sig;
      setAnalysis((prev) => ({
        ...prev,
        [videoPath]: { ...(prev[videoPath] ?? NO_ANALYSIS), running: { message: "Queued…", fraction: 0 }, error: null },
      }));
      window.lmsync
        .analyze({ videoPath, fileName: fileNameOf(videoPath), tracks: analyzable })
        .then((result) =>
          setAnalysis((prev) => ({
            ...prev,
            [videoPath]: { sig: startedSig, alignment: result.alignment, report: result.matchReport, running: null, error: null },
          })),
        )
        .catch((error: unknown) =>
          setAnalysis((prev) => ({
            ...prev,
            [videoPath]: { ...(prev[videoPath] ?? NO_ANALYSIS), sig: startedSig, running: null, error: errorText(error) },
          })),
        );
    }
  }, [ready, workspace.videos, missing, analysis, analyzable, sig]);

  useEffect(
    () =>
      window.lmsync.onProgress((progress) =>
        setAnalysis((prev) => {
          const current = prev[progress.videoPath];
          if (!current?.running) return prev;
          return { ...prev, [progress.videoPath]: { ...current, running: { message: progress.message, fraction: progress.fraction } } };
        }),
      ),
    [],
  );

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

  const addFiles = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const result = addPaths(workspaceRef.current, paths);
    workspaceRef.current = result.workspace;
    setWorkspace(result.workspace);
    const notes: string[] = [];
    if (result.rejected.length > 0) {
      notes.push(`Not a supported file: ${result.rejected.map(fileNameOf).join(", ")}. Use videos (MP4, M4V, MOV, …), MP3 or LRC.`);
    }
    if (result.duplicates.length > 0) notes.push(`Already in the workspace: ${result.duplicates.map(fileNameOf).join(", ")}.`);
    setMessage(notes.length > 0 ? notes.join(" ") : null);
  }, []);

  const dropFiles = useCallback(
    (files: FileList | null) => {
      if (files) addFiles(Array.from(files, (file) => window.lmsync.pathForFile(file)).filter((p) => p !== ""));
    },
    [addFiles],
  );

  const removeFile = useCallback(
    (filePath: string) => {
      if (reference?.path === filePath) {
        pauseAll();
        setLoop(null);
        masterRef.current = 0;
        setTimeSec(0);
      }
      setWorkspace((prev) => removePath(prev, filePath));
    },
    [reference, pauseAll],
  );

  const replaceWorkspace = useCallback(
    (next: WorkspaceFile) => {
      pauseAll();
      setLoop(null);
      masterRef.current = 0;
      setTimeSec(0);
      setAnalysis({});
      setWorkspace(next);
    },
    [pauseAll],
  );

  const newWorkspace = useCallback(() => {
    const hasContent = workspace.videos.length + workspace.mp3s.length + workspace.lrcs.length > 0;
    if (!hasContent || window.confirm("Clear the workspace? (Files on disk are not touched.)")) replaceWorkspace(emptyWorkspace());
  }, [workspace, replaceWorkspace]);

  const openWorkspace = useCallback(async () => {
    try {
      const opened = await window.lmsync.workspace.open();
      if (opened) {
        replaceWorkspace(opened.workspace);
        setMessage(`Opened ${fileNameOf(opened.path)}.`);
      }
    } catch (error) {
      setMessage(errorText(error));
    }
  }, [replaceWorkspace]);

  const saveCopy = useCallback(async () => {
    const saved = await window.lmsync.workspace.saveAs(workspace);
    if (saved) setMessage(`Saved ${saved}`);
  }, [workspace]);

  const pickFiles = useCallback(async () => addFiles(await window.lmsync.pickFiles()), [addFiles]);

  const clearCache = useCallback(async () => {
    await window.lmsync.clearCache();
    setAnalysis({});
    setMessage("Analysis cache cleared; videos will be analyzed again.");
  }, []);

  // Choreography tile: follows the reference's alignment, or previews a track when not synced.
  const synced = isAligned(refAlignment);
  const refTarget = targetForTile(refAlignment, refAlignment, timeSec, true);
  const refAlignTrack = refAlignment && refTarget.trackKey ? refAlignment.tracks.find((t) => t.trackKey === refTarget.trackKey) : undefined;
  const previewTrack = tracks.find((t) => t.key === previewKey && t.lrcPath) ?? tracks.find((t) => t.lrcPath) ?? null;
  const activeTrack = synced ? (tracks.find((t) => t.key === refTarget.trackKey) ?? null) : previewTrack;
  const mp3Time = synced ? refTarget.mp3TimeSec : playableCount > 0 ? timeSec : null;
  const activeLrc = activeTrack?.lrcPath ? lrcs[activeTrack.lrcPath] : undefined;
  const cues = useMemo<LrcCue[]>(() => activeLrc?.cues ?? [], [activeLrc]);
  let activeIndex = -1;
  if (mp3Time !== null) {
    for (let i = 0; i < cues.length; i++) if (cues[i].timeSec <= mp3Time) activeIndex = i;
  }

  const masterTimeForMp3 = useCallback(
    (t: number) => (refAlignTrack ? elementTimeForTrack(refAlignTrack, t) : t),
    [refAlignTrack],
  );

  const toggleLoop = useCallback(() => {
    if (loopRef.current) {
      setLoop(null);
      return;
    }
    if (cues.length === 0) return;
    const index = Math.max(0, activeIndex);
    const start = cues[index].timeSec;
    const end = cues[index + 1]?.timeSec ?? start + 8;
    setLoop({ startSec: masterTimeForMp3(start), endSec: masterTimeForMp3(end), cueIndex: index, trackKey: activeTrack?.key ?? null });
  }, [cues, activeIndex, masterTimeForMp3, activeTrack]);

  const sortedAlignTracks = useMemo(
    () => (refAlignment ? [...refAlignment.tracks].sort((a, b) => a.videoStartSec - b.videoStartSec) : []),
    [refAlignment],
  );

  const nextTrack = useCallback(() => {
    const next = sortedAlignTracks.find((t) => t.videoStartSec > masterRef.current + 0.5);
    if (next) seek(next.videoStartSec);
  }, [sortedAlignTracks, seek]);

  const prevTrack = useCallback(() => {
    const current = refAlignment ? findCurrentTrack(refAlignment, masterRef.current) : null;
    if (current && masterRef.current - current.videoStartSec > 3) {
      seek(current.videoStartSec);
      return;
    }
    const before = sortedAlignTracks.filter((t) => t.videoStartSec < (current?.videoStartSec ?? masterRef.current));
    seek(before.length > 0 ? before[before.length - 1].videoStartSec : 0);
  }, [refAlignment, sortedAlignTracks, seek]);

  const columns: VideoColumn[] = videos
    .filter((v) => !v.missing)
    .map((v, i) => ({
      path: v.path,
      label: `${i + 1}${v.source === "self" ? "·Self" : "·Master"}`,
      report: v.analysis?.report ?? null,
      running: !!v.analysis?.running,
    }));

  const gridColumns = Math.min(videos.length + 1, 3);
  const isEmpty = videos.length === 0 && tracks.length === 0;

  return (
    <div
      className={`app${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        dropFiles(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <h1>LM Sync</h1>
        <button className="primary" onClick={() => void pickFiles()}>
          Add files…
        </button>
        <span className="hint">Videos, MP3s and LRC files — or drop them anywhere</span>
        <span className="spacer" />
        <button onClick={newWorkspace}>New</button>
        <button onClick={() => void openWorkspace()}>Open…</button>
        <button onClick={() => void saveCopy()}>Save copy…</button>
        <button onClick={() => void clearCache()} title="Forget all analysis results">
          Clear cache
        </button>
      </header>
      {message && (
        <div className="message" onClick={() => setMessage(null)} title="Click to dismiss">
          {message}
        </div>
      )}
      <main className="workspace" style={{ ["--cols" as string]: gridColumns }}>
        {isEmpty && (
          <div className="empty">
            <h2>Drop files here</h2>
            <p>
              Videos ({VIDEO_EXTENSIONS.slice(0, 4).join(" ")} …) play right away. Add the class's MP3s to align them, and LRC files for the
              choreography text. Files can arrive in any order — videos are re-aligned as soon as the context is there.
            </p>
            <button className="primary" onClick={() => void pickFiles()}>
              Add files…
            </button>
          </div>
        )}
        {videos.map((v) => {
          const target = targetForTile(refAlignment, v.alignment, timeSec, v === reference);
          const trackAlignment = v.alignment?.tracks.find((t) => t.trackKey === target.trackKey);
          return (
            <VideoTile
              key={v.path}
              path={v.path}
              fileName={v.fileName}
              source={v.source}
              missing={v.missing}
              isReference={v === reference}
              analysis={v.analysis}
              synced={target.synced}
              confidence={trackAlignment?.confidence ?? null}
              missingTrack={target.synced && target.trackKey !== null && target.targetSec === null}
              report={v.analysis?.report ?? null}
              registerRef={registerRef}
              onDuration={onDuration}
              onToggleSource={(p) => setWorkspace((prev) => setVideoSource(prev, p, prev.videos.find((x) => x.path === p)?.source === "self" ? "masterclass" : "self"))}
              onRemove={removeFile}
            />
          );
        })}
        {!isEmpty && (
          <ChoreographyTile
            title={activeTrack ? `${synced ? "" : "Preview: "}Track ${activeTrack.trackNo} – ${activeTrack.label}` : "Choreography"}
            notSyncedNote={!synced && playableCount > 0 ? "not synced – follows video time" : null}
            cues={cues}
            activeIndex={activeIndex}
            loopIndex={loop && loop.trackKey === (activeTrack?.key ?? null) ? loop.cueIndex : null}
            onCueClick={(cue) => seek(masterTimeForMp3(cue.timeSec))}
            tracks={tracks}
            missing={missing}
            videos={columns}
            previewKey={previewTrack?.key ?? null}
            onPreviewKey={setPreviewKey}
            onRemoveFile={removeFile}
          />
        )}
      </main>
      <TransportBar
        playing={playing}
        disabled={playableCount === 0}
        timeSec={timeSec}
        durationSec={durationSec}
        speed={speed}
        trackNo={synced ? (activeTrack?.trackNo ?? null) : null}
        loopActive={loop !== null}
        canSkipTracks={synced}
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
