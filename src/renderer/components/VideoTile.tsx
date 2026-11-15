import { useState } from "react";
import { statusForConfidence } from "../../analyzer/status";
import type { VideoTileState } from "../types";

interface VideoTileProps {
  tile: VideoTileState;
  isReference: boolean;
  /** Confidence of the track currently playing in this video, if known. */
  confidence: number | null;
  /** True when this video has no match for the current track. */
  missingTrack: boolean;
  registerRef: (id: string, el: HTMLVideoElement | null) => void;
  onRemove: (id: string) => void;
}

export function VideoTile({ tile, isReference, confidence, missingTrack, registerRef, onRemove }: VideoTileProps) {
  const [muted, setMuted] = useState(!isReference);
  const src = `lmsync://local/${encodeURIComponent(tile.path)}`;
  const status = confidence === null ? null : statusForConfidence(confidence);
  const unmatched = tile.matchReport.results.filter((r) => r.status === "unmatched").length;

  return (
    <div className="tile">
      <div className="tile-header">
        <span className="badge">{tile.source === "self" ? "Self" : "Masterclass"}</span>
        <span className="tile-title" title={tile.path}>
          {tile.fileName}
        </span>
        {isReference && <span className="badge dim">clock</span>}
        {status && (
          <span className={`badge ${status}`} title="Alignment confidence for the current track">
            sync {(confidence! * 100).toFixed(0)}%{status === "low" ? " – low" : ""}
          </span>
        )}
        {unmatched > 0 && <span className="badge low">{unmatched} track(s) unmatched</span>}
        <span className="spacer" />
        <button onClick={() => setMuted((m) => !m)}>{muted ? "Unmute" : "Mute"}</button>
        <button onClick={() => onRemove(tile.id)}>✕</button>
      </div>
      <div className="video-wrap">
        <video src={src} ref={(el) => registerRef(tile.id, el)} muted={muted} playsInline preload="auto" />
        {missingTrack && <div className="video-note">No alignment for this track in this video</div>}
      </div>
    </div>
  );
}
