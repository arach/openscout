import type { ScoutElectronBridge } from "../../../app/electron/bridge.ts";

export type ScoutDesktopBridge = NonNullable<Window["scoutDesktop"]>;

declare global {
  interface Window {
    scoutDesktop?: ScoutElectronBridge;
  }
}

export function getScoutDesktop() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.scoutDesktop ?? null;
}

export function isElectronApp() {
  return Boolean(getScoutDesktop());
}
