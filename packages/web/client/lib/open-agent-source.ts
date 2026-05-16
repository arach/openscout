import type { Route } from "./types.ts";

const STORAGE_KEY = "openscout.openAgent.returnTo.v1";
let _returnTo: Route | null = null;

function tryParse(raw: string): Route | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as { view?: unknown }).view === "string") {
      return parsed as Route;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setOpenAgentReturn(route: Route): void {
  _returnTo = route;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(route));
  } catch {
    /* quota / privacy mode; ignore */
  }
}

export function getOpenAgentReturn(): Route | null {
  if (_returnTo) return _returnTo;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = tryParse(raw);
      _returnTo = parsed;
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearOpenAgentReturn(): void {
  _returnTo = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
