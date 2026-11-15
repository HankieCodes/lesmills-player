import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { fileNameOf } from "../../shared/files";
import type { Alignment, AlignmentMethod, ManualAlignment, Track } from "../../shared/types";

export interface AlignmentEditorVideo {
  path: string;
  fileName: string;
  /** Best known duration; the editor also reads it from the preview video's metadata. */
  durationSec: number;
  alignment: Alignment | null;
}

export interface AlignmentEdit {
  videoPath: string;
  /** New start, or null to drop the manual alignment and return to automatic analysis. */
  startSec: number | null;
}

interface AlignmentEditorProps {
  track: Track;
  videos: AlignmentEditorVideo[];
  manualAlignments: ManualAlignment[];
  onClose: () => void;
  onSave: (edits: AlignmentEdit[]) => Promise<void>;
}

interface LaneState {
  startSec: number;
  /** Value when the editor opened, for the change indicator; null when there was no alignment. */
  baseStartSec: number | null;
  manual: boolean;
  method: AlignmentMethod | null;
  confidence: number | null;
  /** False when the video has no alignment for this track yet. */
  aligned: boolean;
  /** Set once the user drags/keys a lane or clicks Reset. */
  dirty: boolean;
  /** Save should remove the manual alignment rather than set a new start. */
  cleared: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function clock(value: number): string {
  const sec = Math.max(0, value);
  const minutes = Math.floor(sec / 60);
  const rest = sec - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

/** The lane a video starts with: its manual correction, its automatic match, or nothing yet. */
function laneFor(track: Track, video: AlignmentEditorVideo, manualAlignments: ManualAlignment[]): LaneState {
  const override = manualAlignments.find((m) => m.videoPath === video.path && m.trackKey === track.key);
  const automatic = video.alignment?.tracks.find((t) => t.trackKey === track.key);
  if (override) {
    return {
      startSec: override.startSec,
      baseStartSec: override.startSec,
      manual: true,
      method: override.method,
      confidence: override.confidence,
      aligned: true,
      dirty: false,
      cleared: false,
    };
  }
  if (automatic) {
    return {
      startSec: automatic.videoStartSec,
      baseStartSec: automatic.videoStartSec,
      manual: automatic.manual === true,
      method: automatic.method,
      confidence: automatic.confidence,
      aligned: true,
      dirty: false,
      cleared: false,
    };
  }
  return { startSec: 0, baseStartSec: null, manual: false, method: null, confidence: null, aligned: false, dirty: false, cleared: false };
}

function initialLanes(track: Track, videos: AlignmentEditorVideo[], manualAlignments: ManualAlignment[]): Record<string, LaneState> {
  return Object.fromEntries(videos.map((video) => [video.path, laneFor(track, video, manualAlignments)]));
}

function sameLane(a: LaneState, b: LaneState): boolean {
  return (
    a.startSec === b.startSec &&
    a.baseStartSec === b.baseStartSec &&
    a.manual === b.manual &&
    a.method === b.method &&
    a.confidence === b.confidence &&
    a.aligned === b.aligned &&
    a.cleared === b.cleared
  );
}

function VideoPreview(props: {
  video: AlignmentEditorVideo;
  startSec: number;
  /** True while the modal is playing every preview together. */
  playing: boolean;
  /** The preview whose Play button was pressed; it keeps its own sound setting. */
  lead: boolean;
  onDuration: (videoPath: string, durationSec: number) => void;
  onTogglePlay: (videoPath: string) => void;
  onStop: () => void;
}) {
  const { video, startSec, playing, lead, onDuration, onTogglePlay, onStop } = props;
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);

  const seekToStart = () => {
    const el = ref.current;
    if (!el) return;
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration - 0.05 : startSec;
    el.currentTime = clamp(startSec, 0, Math.max(0, max));
  };

  // One Play button drives every preview; one Pause stops them all.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (playing) {
      if (el.paused) void el.play().catch(() => onStop());
    } else if (!el.paused) {
      el.pause();
    }
  }, [playing, onStop]);

  // Show the chosen start frame whenever the span moves and playback is stopped.
  useEffect(() => {
    if (!playing) seekToStart();
    // seekToStart closes over startSec; this effect intentionally follows span changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSec, playing]);

  return (
    <div className="align-preview">
      <div className="align-preview-head">
        <span className="align-preview-name" title={video.path}>
          {video.fileName}
        </span>
        <span className="badge dim">{clock(startSec)}</span>
      </div>
      <div className="align-preview-screen">
        {failed ? (
          <div className="video-note center">Preview unavailable for this codec.</div>
        ) : (
          <video
            ref={ref}
            src={`lmsync://local/${encodeURIComponent(video.path)}`}
            muted={muted || (playing && !lead)}
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              onDuration(video.path, e.currentTarget.duration);
              seekToStart();
            }}
            onPause={() => {
              seekToStart();
              onStop();
            }}
            onEnded={() => {
              seekToStart();
              onStop();
            }}
            onError={() => {
              setFailed(true);
              onStop();
            }}
            onLoadStart={() => setFailed(false)}
          />
        )}
      </div>
      <div className="align-preview-controls">
        <button
          onClick={() => onTogglePlay(video.path)}
          disabled={failed}
          title={playing ? "Pause every preview and return them to their start frames" : "Play every preview from its start frame; the others stay muted"}
        >
          {playing ? "⏸ Pause all" : "▶ Play"}
        </button>
        <button
          onClick={() => setMuted((m) => !m)}
          disabled={failed || (playing && !lead)}
          title={
            playing && !lead
              ? "Muted while another preview plays sound; pause to change this preview's sound"
              : "Mute or unmute this preview"
          }
        >
          {muted ? "🔇 Muted" : "🔊 Sound"}
        </button>
      </div>
    </div>
  );
}

function TimelineLane(props: {
  video: AlignmentEditorVideo;
  lane: LaneState;
  axisDurationSec: number;
  mp3DurationSec: number;
  active: boolean;
  onActivate: (videoPath: string) => void;
  onStart: (videoPath: string, startSec: number, dirty: boolean) => void;
  onReset: (videoPath: string) => void;
}) {
  const { video, lane, axisDurationSec, mp3DurationSec, active } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; clientX: number; startSec: number; width: number } | null>(null);
  const duration = video.durationSec > 0 ? video.durationSec : axisDurationSec;
  const maxStart = Math.max(0, duration - 0.1);
  const ringStart = clamp(lane.startSec, 0, maxStart);
  const ringLength = Math.max(0.2, Math.min(mp3DurationSec > 0 ? mp3DurationSec : axisDurationSec * 0.1, Math.max(0.2, duration - ringStart)));
  const leftPct = axisDurationSec > 0 ? (ringStart / axisDurationSec) * 100 : 0;
  const widthPct = axisDurationSec > 0 ? (ringLength / axisDurationSec) * 100 : 0;
  const fits = mp3DurationSec === 0 || ringStart + mp3DurationSec <= duration + 0.05;

  const timeAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * axisDurationSec, 0, maxStart);
  };

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (axisDurationSec <= 0) return;
    event.preventDefault();
    props.onActivate(video.path);
    const clicked = timeAt(event.clientX);
    const insideRing = clicked >= ringStart && clicked <= ringStart + ringLength;
    const nextStart = insideRing ? ringStart : clamp(clicked, 0, maxStart);
    if (!insideRing) props.onStart(video.path, nextStart, true);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, startSec: nextStart, width: event.currentTarget.getBoundingClientRect().width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.width <= 0) return;
    const deltaSec = ((event.clientX - drag.clientX) / drag.width) * axisDurationSec;
    props.onStart(video.path, clamp(drag.startSec + deltaSec, 0, maxStart), true);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const status =
    lane.cleared
      ? "reset on save"
      : !lane.aligned
        ? "not aligned"
        : lane.manual
          ? "manual"
          : lane.confidence !== null
            ? `${Math.round(lane.confidence * 100)}%`
            : "auto";
  const delta = lane.baseStartSec === null ? 0 : ringStart - lane.baseStartSec;
  const showDelta = lane.dirty && !lane.cleared && lane.baseStartSec !== null && Math.abs(delta) >= 0.005;

  return (
    <div className={`align-lane${active ? " active" : ""}`}>
      <div className="align-lane-head">
        <span className="align-lane-name" title={video.path}>
          {video.fileName}
        </span>
        <div className="align-lane-meta">
          <span className={`badge ${lane.cleared ? "low" : !lane.aligned ? "dim" : lane.manual ? "manual" : "ok"}`}>{status}</span>
          <span className="dim">{clock(ringStart)}</span>
          {showDelta && (
            <span className="align-delta" title="Change from the start when this editor opened">
              {delta > 0 ? "+" : "−"}
              {Math.abs(delta).toFixed(2)} s
            </span>
          )}
          {lane.manual && !lane.cleared && (
            <button className="tiny" title="Return this video to automatic analysis" onClick={() => props.onReset(video.path)}>
              Reset
            </button>
          )}
        </div>
      </div>
      <div
        ref={trackRef}
        className="align-lane-track"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title="Click to place the start, or drag the highlighted span"
      >
        <div
          className={`align-ring${lane.manual ? " manual" : ""}${!lane.aligned || lane.cleared ? " unset" : ""}${fits ? "" : " overflow"}`}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          role="slider"
          tabIndex={0}
          aria-label={`Start of track in ${video.fileName}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(maxStart * 10) / 10}
          aria-valuenow={Math.round(ringStart * 10) / 10}
          onFocus={() => props.onActivate(video.path)}
        >
          <span className="align-ring-label">
            {clock(ringStart)} · {clock(ringStart + (mp3DurationSec || ringLength))}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The alignment editor: every video's start frame for one track, and a shared-time
 * timeline where the aligned span is dragged into place. Saving sends only edited lanes
 * back, each to be reanalyzed in a narrow window around the chosen start.
 */
export function AlignmentEditor(props: AlignmentEditorProps) {
  const { track, videos, manualAlignments, onClose, onSave } = props;
  const [lanes, setLanes] = useState<Record<string, LaneState>>(() => initialLanes(track, videos, manualAlignments));
  const [durations, setDurations] = useState<Record<string, number>>(() =>
    Object.fromEntries(videos.map((v) => [v.path, v.durationSec])),
  );
  const [mp3DurationSec, setMp3DurationSec] = useState(0);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(videos[0]?.path ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const stopPlayback = useCallback(() => setPlayingPath(null), []);
  const togglePlayback = useCallback((videoPath: string) => {
    setPlayingPath((current) => (current === null ? videoPath : null));
  }, []);

  // Move keyboard focus off the track link behind the modal and onto the dialog itself.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // The track's MP3 length sets the ring's width.
  useEffect(() => {
    if (!track.mp3Path) return;
    const audio = new Audio(`lmsync://local/${encodeURIComponent(track.mp3Path)}`);
    const onMetadata = () => {
      if (Number.isFinite(audio.duration)) setMp3DurationSec(audio.duration);
    };
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.preload = "metadata";
    audio.load();
    return () => {
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.src = "";
    };
  }, [track.mp3Path]);

  // Keep unedited lanes current while background analysis finishes or a workspace change lands.
  useEffect(() => {
    setLanes((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const video of videos) {
        const lane = prev[video.path];
        if (!lane || lane.dirty) continue;
        const fresh = laneFor(track, video, manualAlignments);
        if (!sameLane(lane, fresh)) {
          next[video.path] = fresh;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [track, videos, manualAlignments]);

  useEffect(() => {
    setActivePath((prev) => (prev !== null && videos.some((v) => v.path === prev) ? prev : (videos[0]?.path ?? null)));
  }, [videos]);

  const axisDurationSec = useMemo(() => {
    let max = 1;
    for (const video of videos) {
      const lane = lanes[video.path];
      const duration = durations[video.path] || video.durationSec;
      if (duration > 0) max = Math.max(max, duration);
      if (lane) max = Math.max(max, lane.startSec + mp3DurationSec);
    }
    return max;
  }, [videos, lanes, durations, mp3DurationSec]);

  const setStart = useCallback(
    (videoPath: string, startSec: number, dirty: boolean) => {
      setLanes((prev) => {
        const lane = prev[videoPath];
        if (!lane) return prev;
        if (lane.startSec === startSec && lane.dirty === (lane.dirty || dirty) && !lane.cleared) return prev;
        return { ...prev, [videoPath]: { ...lane, startSec, dirty: lane.dirty || dirty, cleared: false } };
      });
      if (dirty) stopPlayback();
    },
    [stopPlayback],
  );

  const resetLane = useCallback(
    (videoPath: string) => {
      stopPlayback();
      setLanes((prev) => {
        const lane = prev[videoPath];
        if (!lane) return prev;
        return { ...prev, [videoPath]: { ...lane, dirty: true, cleared: true } };
      });
    },
    [stopPlayback],
  );

  const setDuration = (videoPath: string, durationSec: number) => {
    if (!Number.isFinite(durationSec) || durationSec <= 0) return;
    setDurations((prev) => (prev[videoPath] === durationSec ? prev : { ...prev, [videoPath]: durationSec }));
  };

  const activeLanePath =
    activePath !== null && videos.some((v) => v.path === activePath) ? activePath : (videos[0]?.path ?? null);

  // Arrow keys nudge the active lane wherever focus is, and must not scroll or move focus
  // between the modal's buttons. The app behind the modal is inert (see App).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!saving) onClose();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      if (saving || activeLanePath === null) return;
      const video = videos.find((v) => v.path === activeLanePath);
      const lane = lanes[activeLanePath];
      if (!video || !lane) return;
      const duration = durations[video.path] || video.durationSec || axisDurationSec;
      const maxStart = Math.max(0, duration - 0.1);
      const step = event.shiftKey ? 1 : 0.1;
      setStart(activeLanePath, clamp(lane.startSec + (event.key === "ArrowRight" ? step : -step), 0, maxStart), true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [activeLanePath, axisDurationSec, durations, lanes, onClose, saving, setStart, videos]);

  const edits: AlignmentEdit[] = Object.entries(lanes)
    .filter(([, lane]) => lane.dirty)
    .map(([videoPath, lane]) => ({ videoPath, startSec: lane.cleared ? null : lane.startSec }));

  const save = async () => {
    if (saving) return;
    if (edits.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(edits);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <div
        ref={dialogRef}
        className="modal alignment-editor"
        role="dialog"
        aria-modal="true"
        aria-label={`Fix alignment for track ${track.trackNo}`}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h2>Fix alignment</h2>
            <div className="hint">
              Track {track.trackNo} – {track.label} · {track.mp3Path ? fileNameOf(track.mp3Path) : "no MP3"}
            </div>
          </div>
          <span className="spacer" />
          <button onClick={onClose} disabled={saving} title="Close without saving">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="align-previews">
            {videos.map((video) => (
              <VideoPreview
                key={video.path}
                video={{ ...video, durationSec: durations[video.path] || video.durationSec }}
                startSec={lanes[video.path]?.startSec ?? 0}
                playing={playingPath !== null}
                lead={playingPath === video.path}
                onDuration={setDuration}
                onTogglePlay={togglePlayback}
                onStop={stopPlayback}
              />
            ))}
          </div>
          <p className="hint align-help">
            Play starts every preview; the others are muted and pausing returns them all to their start frames. Drag the highlighted span on
            a video's timeline to move where this song starts; click the timeline to place it directly. The outlined lane takes the arrow
            keys: 0.1 s, or 1 s with Shift.
          </p>
          <div className="align-timeline">
            <div className="align-axis">
              <span className="align-axis-label" />
              <div className="align-axis-track">
                {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                  <span key={fraction} className="align-tick" style={{ left: `${fraction * 100}%` }}>
                    {clock(axisDurationSec * fraction)}
                  </span>
                ))}
              </div>
            </div>
            {videos.map((video) => (
              <TimelineLane
                key={video.path}
                video={{ ...video, durationSec: durations[video.path] || video.durationSec }}
                lane={
                  lanes[video.path] ?? {
                    startSec: 0,
                    baseStartSec: null,
                    manual: false,
                    method: null,
                    confidence: null,
                    aligned: false,
                    dirty: false,
                    cleared: false,
                  }
                }
                axisDurationSec={axisDurationSec}
                mp3DurationSec={mp3DurationSec}
                active={activeLanePath === video.path}
                onActivate={setActivePath}
                onStart={setStart}
                onReset={resetLane}
              />
            ))}
          </div>
          {mp3DurationSec === 0 && <p className="hint">Reading the MP3 length to size the aligned span…</p>}
          {error && <p className="video-note error">{error}</p>}
        </div>
        <div className="modal-footer">
          <span className="hint">
            {edits.length === 0
              ? "Nothing changed."
              : `${edits.length} video(s) will be reanalyzed from the chosen start −10 s to +5 s past the song's length.`}
          </span>
          <span className="spacer" />
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary" onClick={() => void save()} disabled={saving || edits.length === 0}>
            {saving ? "Reanalyzing…" : "Save & reanalyze"}
          </button>
        </div>
      </div>
    </div>
  );
}
