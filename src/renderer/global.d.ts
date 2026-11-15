import type { LmsyncApi } from "../electron/preload";

declare global {
  interface Window {
    lmsync: LmsyncApi;
  }
}
