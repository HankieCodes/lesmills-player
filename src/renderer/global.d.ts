import type { LmplayerApi } from "../electron/preload";

declare global {
  interface Window {
    lmplayer: LmplayerApi;
  }
}
