import { useEffect, useRef } from "react";
import { cueAt } from "../../analyzer/lrc";
import type { LrcCue } from "../../shared/types";

interface LrcScrollerProps {
  cues: LrcCue[];
  activeTimeSec: number;
  onCueClick: (timeSec: number) => void;
}

export function LrcScroller({ cues, activeTimeSec, onCueClick }: LrcScrollerProps) {
  const sorted = [...cues].sort((a, b) => a.timeSec - b.timeSec);
  const active = cueAt(sorted, activeTimeSec);
  const activeId = active ? `lrc-cue-${active.timeSec.toFixed(3)}` : null;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeId === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[id="${activeId}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [activeId]);

  return (
    <div className="tile lrc-tile" ref={listRef}>
      {sorted.map((cue, index) => {
        const isActive = active !== null && cue.timeSec === active.timeSec;
        const id = `lrc-cue-${cue.timeSec.toFixed(3)}`;
        return (
          <div
            key={`${id}-${index}`}
            id={id}
            className={`lrc-line${isActive ? " active" : ""}`}
            onClick={() => onCueClick(cue.timeSec)}
          >
            {cue.timeSec.toFixed(2)}s — {cue.text}
          </div>
        );
      })}
    </div>
  );
}
