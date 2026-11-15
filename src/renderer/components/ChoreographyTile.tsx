import { useEffect, useRef } from "react";
import { statusForConfidence } from "../../analyzer/status";
import { fileNameOf } from "../../shared/files";
import type { LrcCue, MatchReport, Track } from "../../shared/types";

export interface VideoColumn {
  path: string;
  label: string;
  report: MatchReport | null;
  running: boolean;
}

interface ChoreographyTileProps {
  title: string;
  /** Shown when the cues are not tied to the video by an alignment. */
  notSyncedNote: string | null;
  cues: LrcCue[];
  /** Index of the active cue, or -1. */
  activeIndex: number;
  loopIndex: number | null;
  onCueClick: (cue: LrcCue) => void;
  tracks: Track[];
  missing: Set<string>;
  videos: VideoColumn[];
  /** Key of the track the master clock is currently inside. */
  activeKey: string | null;
  previewKey: string | null;
  onPreviewKey: (key: string) => void;
  onRemoveFile: (path: string) => void;
  /** Jump to the track, or open its alignment editor when it is already active. */
  onTrackClick: (track: Track) => void;
}

function FileCell({ filePath, missing, onRemove }: { filePath: string | null; missing: Set<string>; onRemove: (p: string) => void }) {
  if (filePath === null) return <span className="dim">—</span>;
  const gone = missing.has(filePath);
  return (
    <span className={gone ? "gone" : ""} title={gone ? `Not found: ${filePath}` : filePath}>
      {gone ? "missing" : "✓"}{" "}
      <button className="tiny" onClick={() => onRemove(filePath)} title={`Remove ${fileNameOf(filePath)}`}>
        ✕
      </button>
    </span>
  );
}

export function ChoreographyTile(props: ChoreographyTileProps) {
  const { cues, activeIndex, loopIndex, tracks, missing, videos } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const isLinked = (track: Track) => track.mp3Path !== null && !missing.has(track.mp3Path);

  useEffect(() => {
    const container = listRef.current;
    const line = container?.children[activeIndex] as HTMLElement | undefined;
    if (!container || !line) return;
    container.scrollTo({ top: line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
  }, [activeIndex]);

  return (
    <div className="tile">
      <div className="tile-header">
        <span className="tile-title">{props.title}</span>
        {props.notSyncedNote && <span className="badge low">{props.notSyncedNote}</span>}
        {props.notSyncedNote && tracks.some((t) => t.lrcPath) && (
          <select value={props.previewKey ?? ""} onChange={(e) => props.onPreviewKey(e.target.value)}>
            {tracks
              .filter((t) => t.lrcPath)
              .map((t) => (
                <option key={t.key} value={t.key}>
                  {t.trackNo}. {t.label}
                </option>
              ))}
          </select>
        )}
      </div>
      <div className="lrc-list" ref={listRef}>
        {cues.map((cue, index) => (
          <div
            key={`${cue.timeSec}-${index}`}
            className={`lrc-line${index === activeIndex ? " active" : ""}${index === loopIndex ? " looping" : ""}`}
            onClick={() => props.onCueClick(cue)}
          >
            <span className="lrc-time">
              {Math.floor(cue.timeSec / 60)}:{(cue.timeSec % 60).toFixed(1).padStart(4, "0")}
            </span>
            {cue.text}
          </div>
        ))}
        {cues.length === 0 && (
          <div className="lrc-empty">
            {tracks.length === 0
              ? "Drop MP3 and LRC files here (or use Add files…). MP3s align the videos; LRC files supply the choreography text."
              : "No choreography for the current position yet."}
          </div>
        )}
      </div>
      {tracks.length > 0 && (
        <div className="track-list">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Track</th>
                <th>MP3</th>
                <th>LRC</th>
                {videos.map((v) => (
                  <th key={v.path} title={v.path}>
                    {v.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tracks.map((t) => (
                <tr key={t.key}>
                  <td>{t.trackNo}</td>
                  <td className="name" title={t.label}>
                    {isLinked(t) ? (
                      <button
                        className={`track-link${t.key === props.activeKey ? " active" : ""}`}
                        title={
                          t.key === props.activeKey
                            ? "Fix this track's alignment in the videos"
                            : "Jump the player to this track's start; click again to fix its alignment"
                        }
                        onClick={() => props.onTrackClick(t)}
                      >
                        {t.label}
                      </button>
                    ) : (
                      t.label
                    )}
                  </td>
                  <td>
                    <FileCell filePath={t.mp3Path} missing={missing} onRemove={props.onRemoveFile} />
                  </td>
                  <td>
                    <FileCell filePath={t.lrcPath} missing={missing} onRemove={props.onRemoveFile} />
                  </td>
                  {videos.map((v) => {
                    const result = v.report?.results.find((r) => r.trackKey === t.key);
                    const status = result?.status === "unmatched" ? "unmatched" : result?.confidence != null ? statusForConfidence(result.confidence) : null;
                    return (
                      <td key={v.path} title={result?.reason ?? ""}>
                        {!t.mp3Path ? (
                          <span className="dim">no MP3</span>
                        ) : v.running && !result ? (
                          <span className="dim">…</span>
                        ) : result?.manual ? (
                          <span className="badge manual" title="Set in the alignment editor">
                            manual
                          </span>
                        ) : status === null ? (
                          <span className="dim">—</span>
                        ) : (
                          <span className={`badge ${status}`}>{status === "unmatched" ? "no match" : `${Math.round((result!.confidence ?? 0) * 100)}%`}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
