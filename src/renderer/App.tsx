import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { elementTimeForTrack, findCurrentTrack, masterTimeForTrack, planSync } from "../sync/clock";
import type { LmsyncApi } from "../electron/preload";
import type { Alignment, ParsedLrc, ReleaseFolder, VideoSource } from "../shared/types";
import { DropZone } from "./components/DropZone";
import { VideoTile as VideoTileComponent } from "./components/VideoTile";
import { LrcScroller } from "./components/LrcScroller";
import { TransportBar } from "./components/TransportBar";
import type { Tile, SessionVideo, VideoTile } from "./types";

declare global {
  interface Window {
    lmsync?: LmsyncApi;
  }
}

const DEFAULT_SOURCE_FOLDERS = ["/mnt/hdrive/docker/volumes"];

export function App() {
  const sourceFolders = DEFAULT_SOURCE_FOLDERS;
  const [releases, setReleases] = useState<ReleaseFolder[]>([]);
  const [selectedRelease, setSelectedRelease] = useState<ReleaseFolder | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [currentTileId, setCurrentTileId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [masterTimeSec, setMasterTimeSec] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState<{ startSec: number; endSec: number } | null>(null);
  const [progress, setProgress] = useState<{ phase: string; cached?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const masterTimeRef = useRef(0);
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const tilesRef = useRef<Tile[]>([]);
  tilesRef.current = tiles;
  const tileSeq = useRef(0);
  const playingRef = useRef(false);

  const setMasterTime = useCallback((sec: number) => {
    masterTimeRef.current = sec;
    setMasterTimeSec(sec);
  }, []);

  const applyMasterTime = useCallback((sec: number) => {
    setMasterTime(sec);
    for (const [id, el] of videoRefs.current) {
      const t = tilesRef.current.find((x): x is VideoTile => x.kind === "video" && x.id === id);
      if (!t) continue;
      const tr = findCurrentTrack(t.video.alignment, sec) ?? t.video.alignment.tracks[0];
      if (!tr) continue;
      el.currentTime = elementTimeForTrack(tr, sec);
    }
  }, [setMasterTime]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Virtual master clock: advances while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    const loop = (ts: number) => {
      if (last === null) last = ts;
      masterTimeRef.current += (ts - last) / 1000;
      last = ts;
      setMasterTimeSec(masterTimeRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    if (playing) return;
    videoRefs.current.forEach((el) => {
      el.pause();
    });
  }, [playing]);

  useEffect(() => {
    if (!loop) return;
    if (masterTimeSec >= loop.endSec) {
      setMasterTime(loop.startSec);
    }
  }, [masterTimeSec, loop, setMasterTime]);

  // Sync loop: converge every playing video onto the master clock.
  useEffect(() => {
    if (!playing) return;
    for (const [id, el] of videoRefs.current) {
      const tile = tiles.find((t) => t.id === id);
      if (!tile || tile.kind !== "video") continue;
      const track = findCurrentTrack(tile.video.alignment, masterTimeSec);
      if (!track) continue;
      const target = elementTimeForTrack(track, masterTimeSec);
      if (el.paused) {
        void el.play().catch(() => undefined);
      }
      const plan = planSync(el.currentTime, target);
      if (plan.action === "hard-seek") {
        el.currentTime = plan.targetSec;
      } else if (plan.action === "nudge") {
        el.playbackRate = plan.rate;
      }
    }
  }, [playing, masterTimeSec, tiles]);

  useEffect(() => {
    if (!playing) return;
    for (const el of videoRefs.current.values()) {
      el.playbackRate = speed;
    }
  }, [playing, speed]);

  useEffect(() => {
    const api = window.lmsync;
    if (!api) return;
    const off = api.progress.on((p: unknown) => {
      setProgress({ phase: String(p), cached: (p as { cached?: boolean })?.cached });
    });
    return off;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const api = window.lmsync;
    if (!api) return;
    void api.releases.list(sourceFolders).then((result) => {
      if (cancelled) return;
      setReleases(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceFolders]);

  const registerRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) {
      videoRefs.current.set(id, el);
    } else {
      videoRefs.current.delete(id);
    }
  }, []);

  const togglePlay = useCallback(() => {
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
  }, []);

  const setPlaybackSpeed = useCallback((next: number) => {
    setSpeed(next);
  }, []);

  const skipBy = useCallback(
    (deltaSec: number) => {
      applyMasterTime(masterTimeRef.current + deltaSec);
    },
    [applyMasterTime],
  );

  const handleNextTrack = useCallback(() => {
    const tile = currentVideoTileRef.current;
    if (!tile) return;
    const track = findCurrentTrack(tile.video.alignment, masterTimeSec) ?? tile.video.alignment.tracks[0];
    if (!track) return;
    const tracks = [...tile.video.alignment.tracks].sort((a, b) => a.trackNo - b.trackNo);
    const idx = tracks.findIndex((t) => t.trackNo === track.trackNo);
    const next = tracks[idx + 1];
    if (next) applyMasterTime(next.videoStartSec);
  }, [masterTimeSec, applyMasterTime]);

  const handlePrevTrack = useCallback(() => {
    const tile = currentVideoTileRef.current;
    if (!tile) return;
    const track = findCurrentTrack(tile.video.alignment, masterTimeSec) ?? tile.video.alignment.tracks[0];
    if (!track) return;
    const tracks = [...tile.video.alignment.tracks].sort((a, b) => a.trackNo - b.trackNo);
    const idx = tracks.findIndex((t) => t.trackNo === track.trackNo);
    const prev = tracks[idx - 1];
    if (prev) applyMasterTime(prev.videoStartSec);
  }, [masterTimeSec, applyMasterTime]);

  const currentVideoTile = useMemo((): VideoTile | null => {
    const videoTiles = tiles.filter((t): t is VideoTile => t.kind === "video");
    return videoTiles.find((t) => t.id === currentTileId) ?? videoTiles[0] ?? null;
  }, [tiles, currentTileId]);

  const currentVideoTileRef = useRef<VideoTile | null>(null);
  currentVideoTileRef.current = currentVideoTile;

  const handleCueClick = useCallback(
    (timeSec: number) => {
      const tile = currentVideoTileRef.current;
      if (!tile) return;
      const track = findCurrentTrack(tile.video.alignment, masterTimeSec) ?? tile.video.alignment.tracks[0];
      if (!track) return;
      const elementTime = track.videoStartSec + timeSec;
      applyMasterTime(masterTimeForTrack(track, elementTime));
    },
    [masterTimeSec, applyMasterTime],
  );

  const runAnalysis = useCallback(
    async (
      source: VideoSource,
      videoPath: string,
      videoFileName: string,
      release: ReleaseFolder,
    ) => {
      const api = window.lmsync;
      if (!api) return;
      setProgress({ phase: "started" });
      setError(null);
      try {
        const result = (await api.analyze.run({
          videoPath,
          source,
          fileName: videoFileName,
          release: { program: release.program, release: release.release },
          releaseFolder: release,
        })) as {
          alignment: Alignment;
          lrc: ParsedLrc | null;
          cached: boolean;
        };
        setProgress({ phase: "complete", cached: result.cached });
        const lrc = result.lrc ?? {
          path: "",
          cues: [],
          durationSec: 0,
        };
        const sessionVideo: SessionVideo = {
          source,
          videoPath,
          videoFileName,
          release: { program: release.program, release: release.release },
          alignment: result.alignment,
          lrc,
        };
        const tile: Tile = { id: `tile-${tileSeq.current++}`, kind: "video", video: sessionVideo };
        const lrcTile: Tile | null =
          lrc.cues.length > 0
            ? {
                id: `tile-${tileSeq.current++}`,
                kind: "lrc",
                lrc,
                label: `${release.program} ${release.release}`,
              }
            : null;
        setTiles((prev) => {
          const without = prev.filter(
            (t) =>
              !(t.kind === "video" && t.video.videoPath === videoPath) &&
              !(t.kind === "lrc" && t.label === `${release.program} ${release.release}`),
          );
          const next: Tile[] = [...without, tile];
          if (lrcTile) next.push(lrcTile);
          return next;
        });
        setCurrentTileId(tile.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const handleDroppedVideo = useCallback(
    (path: string, fileName: string) => {
      void runAnalysis(
        "self",
        path,
        fileName,
        selectedRelease ?? {
          folderPath: "",
          program: "UNKNOWN",
          release: "0",
          tracks: [],
          masterclassVideoPath: null,
        },
      );
    },
    [runAnalysis, selectedRelease],
  );

  const handleDroppedLrc = useCallback((path: string, fileName: string) => {
    setError(`LRC loaded: ${fileName} (${path})`);
  }, []);

  const currentTrack = useMemo(() => {
    const tile = currentVideoTile;
    if (!tile) return null;
    return findCurrentTrack(tile.video.alignment, masterTimeSec);
  }, [currentVideoTile, masterTimeSec]);

  const activeLrcTimeSec = useMemo(() => {
    if (!currentTrack) return 0;
    const tile = currentVideoTile;
    if (!tile) return 0;
    const cues = [...tile.video.lrc.cues].sort((a, b) => a.timeSec - b.timeSec);
    const mp3Time = masterTimeSec - currentTrack.mp3StartSec;
    let active: number | null = null;
    for (const c of cues) {
      if (c.timeSec <= mp3Time) active = c.timeSec;
    }
    return active ?? 0;
  }, [currentTrack, currentVideoTile, masterTimeSec]);

  const toggleLoopBlock = useCallback(() => {
    const tile = currentVideoTileRef.current;
    if (!tile) return;
    const track =
      findCurrentTrack(tile.video.alignment, masterTimeSec) ?? tile.video.alignment.tracks[0];
    if (!track) return;
    const cues = [...tile.video.lrc.cues].sort((a, b) => a.timeSec - b.timeSec);
    const mp3Time = masterTimeSec - track.mp3StartSec;
    let currentIdx = -1;
    for (let i = 0; i < cues.length; i++) {
      if (cues[i].timeSec <= mp3Time) currentIdx = i;
    }
    const startCue = cues[currentIdx];
    if (!startCue) return;
    const startSec = masterTimeForTrack(track, track.videoStartSec + startCue.timeSec);
    const endCue = currentIdx + 1 < cues.length ? cues[currentIdx + 1] : null;
    const endSec = endCue ? masterTimeForTrack(track, track.videoStartSec + endCue.timeSec) : startSec + 5;
    setLoop((prev) => (prev && Math.abs(prev.startSec - startSec) < 0.01 && Math.abs(prev.endSec - endSec) < 0.01 ? null : { startSec, endSec }));
  }, [masterTimeSec]);

  const layoutClass = useMemo(() => {
    const count = tiles.length;
    if (count <= 1) return "has-one";
    if (count === 2) return "has-two";
    return "has-many";
  }, [tiles]);

  return (
    <div className="app">
      <div className="topbar">
        <h1>LM Sync</h1>
        <span className="spacer" />
        {progress && <span>{progress.phase}{progress.cached ? " (cached)" : ""}</span>}
        {error && <span>{error}</span>}
      </div>
      <div className="app-body">
        <div className="sidebar panel">
          <h2>Source media folders</h2>
          {sourceFolders.map((f) => (
            <div key={f}>{f}</div>
          ))}
          <h2>Releases</h2>
          {releases.map((r) => (
            <div
              key={r.folderPath}
              className={`release-row${r === selectedRelease ? " selected" : ""}`}
              onClick={() => setSelectedRelease(r)}
            >
              <span>
                {r.program} {r.release}
              </span>
              <span>{r.tracks.length}</span>
            </div>
          ))}
        </div>
        <div className="content">
          <DropZone onVideo={(p, f) => void handleDroppedVideo(p, f)} onLrc={(p, f) => void handleDroppedLrc(p, f)} />
          <div className={`workspace ${layoutClass}`}>
            {tiles.map((tile) => {
              if (tile.kind === "video") {
                return <VideoTileComponent key={tile.id} tile={tile} registerRef={registerRef} />;
              }
              const lrc = tile.lrc;
              return (
                <LrcScroller
                  key={tile.id}
                  cues={lrc.cues}
                  activeTimeSec={activeLrcTimeSec}
                  onCueClick={handleCueClick}
                />
              );
            })}
          </div>
        </div>
      </div>
      <TransportBar
        playing={playing}
        confidence={currentTrack?.confidence ?? null}
        onTogglePlay={togglePlay}
        onSkip={skipBy}
        onSetSpeed={setPlaybackSpeed}
        onNextTrack={() => void handleNextTrack()}
        onPrevTrack={() => void handlePrevTrack()}
        onLoopToggle={() => void toggleLoopBlock()}
        loopActive={loop !== null}
      />
    </div>
  );
}
