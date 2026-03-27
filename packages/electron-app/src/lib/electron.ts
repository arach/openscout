import type { DesktopAppInfo } from "@/lib/openscout-desktop";

export type OpenScoutDesktopAppInfo = DesktopAppInfo;

export type OpenScoutDesktopBridge = Window["openScoutDesktop"];

export function getOpenScoutDesktop() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.openScoutDesktop ?? null;
}

export function isElectronApp() {
  return Boolean(getOpenScoutDesktop());
}
