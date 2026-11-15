import type { Tile } from "../types";

interface VideoTileProps {
  tile: Extract<Tile, { kind: "video" }>;
  registerRef: (id: string, el: HTMLVideoElement | null) => void;
}

export function VideoTile({ tile, registerRef }: VideoTileProps) {
  const src = `lmsync://local/${encodeURIComponent(tile.video.videoPath)}`;
  return (
    <div className="tile">
      <video
        src={src}
        ref={(el) => registerRef(tile.id, el)}
        playsInline
        preload="metadata"
      />
    </div>
  );
}
