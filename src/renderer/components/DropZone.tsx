import { useRef, useState } from "react";
import type { VideoSource } from "../../shared/types";

export interface DroppedMedia {
  source: VideoSource;
  path: string;
  fileName: string;
}

interface DropZoneProps {
  onVideo: (path: string, fileName: string) => void;
  onLrc: (path: string, fileName: string) => void;
}

const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi"];
const LRC_EXTENSIONS = ["lrc"];

function extensionOf(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.pop() ?? "").toLowerCase() : "";
}

export function DropZone({ onVideo, onLrc }: DropZoneProps) {
  const videoInputRef = useRef<HTMLInputElement>(null);
  const lrcInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const resolvePath = async (file: File): Promise<string | null> => {
    const api = window.lmsync;
    if (!api) return null;
    try {
      return await api.file.getPathForFile(file);
    } catch {
      return null;
    }
  };

  const handleVideoFiles = async (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) {
      const ext = extensionOf(file.name);
      if (!VIDEO_EXTENSIONS.includes(ext)) continue;
      const path = await resolvePath(file);
      if (path) onVideo(path, file.name);
    }
  };

  const handleLrcFiles = async (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) {
      const ext = extensionOf(file.name);
      if (!LRC_EXTENSIONS.includes(ext)) continue;
      const path = await resolvePath(file);
      if (path) onLrc(path, file.name);
    }
  };

  return (
    <div className="dropzone-stack">
      <div
        className="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleVideoFiles(e.dataTransfer.files);
        }}
      >
        <div>Video drop zone (drag & drop or click)</div>
        <input
          ref={videoInputRef}
          type="file"
          accept=".mp4,.mov,.m4v,.mkv,.webm,.avi"
          style={{ display: "none" }}
          onChange={(e) => {
            void handleVideoFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button onClick={() => videoInputRef.current?.click()}>Open video…</button>
      </div>
      <div
        className="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleLrcFiles(e.dataTransfer.files);
        }}
      >
        <div>LRC drop zone (drag & drop or click)</div>
        <input
          ref={lrcInputRef}
          type="file"
          accept=".lrc"
          style={{ display: "none" }}
          onChange={(e) => {
            void handleLrcFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button onClick={() => lrcInputRef.current?.click()}>Open LRC…</button>
      </div>
      {dragOver && <div>drop detected</div>}
    </div>
  );
}
