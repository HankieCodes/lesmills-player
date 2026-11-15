const SPEEDS = [0.5, 0.75, 1, 1.25];

function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
}

interface TransportBarProps {
  playing: boolean;
  disabled: boolean;
  timeSec: number;
  durationSec: number;
  speed: number;
  trackNo: number | null;
  loopActive: boolean;
  onTogglePlay: () => void;
  onSkip: (deltaSec: number) => void;
  onSetSpeed: (speed: number) => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  onToggleLoop: () => void;
  onSeek: (sec: number) => void;
}

export function TransportBar(props: TransportBarProps) {
  const { playing, disabled, timeSec, durationSec, speed, trackNo, loopActive } = props;
  return (
    <div className="transport">
      <input
        className="scrubber"
        type="range"
        min={0}
        max={Math.max(1, durationSec)}
        step={0.1}
        value={Math.min(timeSec, durationSec)}
        disabled={disabled}
        onChange={(e) => props.onSeek(Number(e.target.value))}
      />
      <div className="transport-row">
        <span className="time">
          {formatTime(timeSec)} / {formatTime(durationSec)}
          {trackNo !== null && <span className="badge dim">track {trackNo}</span>}
        </span>
        <div className="transport-center">
          <button disabled={disabled} onClick={props.onPrevTrack} title="Previous track / restart track">
            ⏮
          </button>
          <button disabled={disabled} onClick={() => props.onSkip(-5)}>
            −5s
          </button>
          <button className="primary play" disabled={disabled} onClick={props.onTogglePlay}>
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button disabled={disabled} onClick={() => props.onSkip(5)}>
            +5s
          </button>
          <button disabled={disabled} onClick={props.onNextTrack} title="Next track">
            ⏭
          </button>
        </div>
        <div className="transport-right">
          <button disabled={disabled} className={loopActive ? "primary" : ""} onClick={props.onToggleLoop}>
            {loopActive ? "Looping block" : "Loop block"}
          </button>
          {SPEEDS.map((s) => (
            <button key={s} disabled={disabled} className={s === speed ? "primary" : ""} onClick={() => props.onSetSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
