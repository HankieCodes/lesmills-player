import type { Alignment, ParsedLrc } from "../shared/types";

export interface SessionVideo {
  source: "self" | "masterclass";
  videoPath: string;
  videoFileName: string;
  release: { program: string; release: string };
  alignment: Alignment;
  lrc: ParsedLrc;
}

export type Tile =
  | { id: string; kind: "video"; video: SessionVideo }
  | { id: string; kind: "lrc"; lrc: ParsedLrc; label: string };

export type VideoTile = Extract<Tile, { kind: "video" }>;
