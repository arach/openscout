import type { ScoutDesktopBridge } from "../../../app/host/bridge.ts";
import { createWebBridge } from "./web-bridge.ts";

export type { ScoutDesktopBridge } from "../../../app/host/bridge.ts";

declare global {
  interface Window {
    scoutDesktop?: ScoutDesktopBridge;
  }
}

let webBridge: ScoutDesktopBridge | null = null;

export function getScoutDesktop(): ScoutDesktopBridge | null {
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
