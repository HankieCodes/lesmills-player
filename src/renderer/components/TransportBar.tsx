interface TransportBarProps {
  playing: boolean;
  confidence: number | null;
  onTogglePlay: () => void;
  onSkip: (deltaSec: number) => void;
  onSetSpeed: (speed: number) => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  onLoopToggle: () => void;
  loopActive: boolean;
}

export function TransportBar({
  playing,
  confidence,
  onTogglePlay,
  onSkip,
  onSetSpeed,
  onNextTrack,
  onPrevTrack,
  onLoopToggle,
  loopActive,
}: TransportBarProps) {
  return (
    <div className="transport">
      <button className="primary" onClick={onTogglePlay}>
        {playing ? "⏸ Pause" : "▶ Play"}
      </button>
      <button onClick={() => onSkip(-5)}>-5s</button>
      <button onClick={() => onSkip(5)}>+5s</button>
      <button onClick={onPrevTrack}>Prev track</button>
      <button onClick={onNextTrack}>Next track</button>
      <button onClick={() => onSetSpeed(0.5)}>0.5x</button>
      <button onClick={() => onSetSpeed(0.75)}>0.75x</button>
      <button onClick={() => onSetSpeed(1)}>1x</button>
      <button onClick={() => onSetSpeed(1.25)}>1.25x</button>
      <div className="spacer" />
      {confidence !== null && <span>Confidence: {(confidence * 100).toFixed(0)}%</span>}
      <button onClick={onLoopToggle}>{loopActive ? "Loop on" : "Loop block"}</button>
    </div>
  );
}
