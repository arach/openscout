import type { Route } from "./types.ts";

/**
 * Slot = the kind of content view whose "back" affordance reads from this store.
 * Add a new slot here when you wire BackToPicker into a new screen.
 */
export type NavReturnSlot =
  | "agents"
  | "conversation"
  | "work"
  | "terminal"
  | "sessions"
  | "agent-info"
  | "channels";

const KEY_PREFIX = "openscout.navReturn.v1.";
const _memory = new Map<NavReturnSlot, Route>();

function storageKey(slot: NavReturnSlot): string {
  return KEY_PREFIX + slot;
}

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

export function setNavReturn(slot: NavReturnSlot, route: Route): void {
  _memory.set(slot, route);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(slot), JSON.stringify(route));
  } catch {
    /* quota / privacy mode; ignore */
  }
}

export function getNavReturn(slot: NavReturnSlot): Route | null {
  const cached = _memory.get(slot);
  if (cached) return cached;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(slot));
    if (raw) {
      const parsed = tryParse(raw);
      if (parsed) _memory.set(slot, parsed);
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearNavReturn(slot: NavReturnSlot): void {
  _memory.delete(slot);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(slot));
  } catch {
    /* ignore */
  }
}
