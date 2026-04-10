import type { ScoutElectronBridge } from "../../../app/electron/bridge.ts";
import { createWebBridge } from "./web-bridge.ts";

export type ScoutDesktopBridge = NonNullable<Window["scoutDesktop"]>;

declare global {
  interface Window {
    scoutDesktop?: ScoutElectronBridge;
  }
}

let webBridge: ScoutElectronBridge | null = null;

export function getScoutDesktop(): ScoutElectronBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (window.scoutDesktop) {
    return window.scoutDesktop;
  }

  if (!webBridge) {
    webBridge = createWebBridge();
  }
  return webBridge;
}

export function isDesktopApp() {
  return typeof window !== "undefined" && Boolean(window.scoutDesktop);
}
