import { useEffect, useRef } from "react";
import type { LrcCue } from "../../shared/types";

interface LrcScrollerProps {
  title: string;
  cues: LrcCue[];
  /** Index of the active cue, or -1. */
  activeIndex: number;
  loopIndex: number | null;
  onCueClick: (cue: LrcCue) => void;
}

export function LrcScroller({ title, cues, activeIndex, loopIndex, onCueClick }: LrcScrollerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const line = container?.children[activeIndex + 1] as HTMLElement | undefined;
    if (!container || !line) return;
    container.scrollTo({ top: line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
  }, [activeIndex]);

  return (
    <div className="tile">
      <div className="tile-header">{title}</div>
      <div className="lrc-list" ref={containerRef}>
        <div className="lrc-empty" hidden={cues.length > 0}>
          Play or seek into a track to see its choreography.
        </div>
        {cues.map((cue, index) => (
          <div
            key={`${cue.timeSec}-${index}`}
            className={`lrc-line${index === activeIndex ? " active" : ""}${index === loopIndex ? " looping" : ""}`}
            onClick={() => onCueClick(cue)}
          >
            <span className="lrc-time">
              {Math.floor(cue.timeSec / 60)}:{(cue.timeSec % 60).toFixed(1).padStart(4, "0")}
            </span>
            {cue.text}
          </div>
        ))}
      </div>
    </div>
  );
}
