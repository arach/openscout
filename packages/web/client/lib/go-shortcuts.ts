import type { Route } from "./types.ts";

export type GoShortcut = {
  key: string;
  label: string;
  route: Route;
};

export const GO_SHORTCUTS: readonly GoShortcut[] = [
  { key: "h", label: "Go home", route: { view: "inbox" } },
  { key: "i", label: "Go to chat inbox", route: { view: "messages" } },
  { key: "c", label: "Go to chat", route: { view: "messages" } },
  { key: "p", label: "Go to projects", route: { view: "agents-v2" } },
  { key: "s", label: "Go to sessions", route: { view: "sessions" } },
  { key: "t", label: "Go to terminals", route: { view: "terminal" } },
  { key: "r", label: "Go to repos", route: { view: "repos" } },
  { key: "f", label: "Go to search", route: { view: "search" } },
  { key: "l", label: "Go to tail", route: { view: "ops", mode: "tail" } },
  { key: "o", label: "Go to ops", route: { view: "ops" } },
  { key: "d", label: "Go to dispatch", route: { view: "broker" } },
  { key: "m", label: "Go to mesh", route: { view: "mesh" } },
  { key: "a", label: "Go to activity", route: { view: "activity" } },
];

export function goShortcutForKey(key: string): GoShortcut | null {
  const normalized = key.toLowerCase();
  return GO_SHORTCUTS.find((shortcut) => shortcut.key === normalized) ?? null;
}
