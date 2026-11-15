import { useState } from "react";
import { statusForConfidence } from "../../analyzer/status";
import type { MatchReport, VideoSource } from "../../shared/types";
import type { VideoAnalysis } from "../types";

interface VideoTileProps {
  path: string;
  fileName: string;
  source: VideoSource;
  missing: boolean;
  isReference: boolean;
  analysis: VideoAnalysis | undefined;
  /** False when this video has no alignment (or the reference has none): it just plays from 0:00. */
  synced: boolean;
  /** Confidence of the current track in this video; null if unknown. */
  confidence: number | null;
  /** True when this video has no match for the current track. */
  missingTrack: boolean;
  report: MatchReport | null;
  registerRef: (path: string, el: HTMLVideoElement | null) => void;
  onDuration: (path: string, durationSec: number) => void;
  onToggleSource: (path: string) => void;
  onRemove: (path: string) => void;
}

export function VideoTile(props: VideoTileProps) {
  const { path, fileName, source, missing, isReference, analysis, synced, confidence, missingTrack, report } = props;
  const [muted, setMuted] = useState(!isReference);
  const [playError, setPlayError] = useState(false);
  const status = confidence === null ? null : statusForConfidence(confidence);
  const unmatched = report?.results.filter((r) => r.status === "unmatched").length ?? 0;
  const running = analysis?.running ?? null;

  return (
    <div className="tile">
      <div className="tile-header">
        <button className="badge-button" title="Click to switch between self-teaching and masterclass" onClick={() => props.onToggleSource(path)}>
          {source === "self" ? "Self" : "Masterclass"}
        </button>
        <span className="tile-title" title={path}>
          {fileName}
        </span>
        {isReference && <span className="badge dim">clock</span>}
        {!missing && !synced && <span className="badge low" title="Add the MP3s for this class so the video can be aligned">not synced</span>}
        {status && (
          <span className={`badge ${status}`} title="Alignment confidence for the current track">
            sync {(confidence! * 100).toFixed(0)}%{status === "low" ? " – low" : ""}
          </span>
        )}
        {unmatched > 0 && <span className="badge low">{unmatched} track(s) unmatched</span>}
        <span className="spacer" />
        {!missing && <button onClick={() => setMuted((m) => !m)}>{muted ? "Unmute" : "Mute"}</button>}
        <button onClick={() => props.onRemove(path)} title="Remove from workspace">
          ✕
        </button>
      </div>
      <div className="video-wrap">
        {missing ? (
          <div className="video-note center">File not found:<br />{path}</div>
        ) : (
          <video
            src={`lmsync://local/${encodeURIComponent(path)}`}
            ref={(el) => props.registerRef(path, el)}
            muted={muted}
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => props.onDuration(path, e.currentTarget.duration)}
            onError={() => setPlayError(true)}
            onLoadStart={() => setPlayError(false)}
          />
        )}
        {playError && !missing && (
          <div className="video-note center">This video can't be played here (unsupported codec?). Alignment still works if its audio decodes.</div>
        )}
        {missingTrack && !running && <div className="video-note">No alignment for this track in this video</div>}
        {analysis?.error && !running && <div className="video-note error">Analysis failed: {analysis.error}</div>}
        {running && (
          <div className="video-progress">
            <span>{running.message}</span>
            <div className="progress">
              <div style={{ width: `${Math.round(running.fraction * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
