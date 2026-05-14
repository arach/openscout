import { useSyncExternalStore } from "react";

export type MissionActivityFilter = "all" | "active" | "recent";
export type MissionSourceFilter = "all" | "scout" | "native";

export const MISSION_RECENT_WINDOWS = [
  { label: "15m", value: 15 * 60_000 },
  { label: "1h", value: 60 * 60_000 },
  { label: "24h", value: 24 * 60 * 60_000 },
] as const;

type MissionRecentWindow = (typeof MISSION_RECENT_WINDOWS)[number]["value"];

export type MissionVisibleAgent = {
  id: string;
  name: string;
  handle: string | null;
  harness: string | null;
  branch: string | null;
  project: string | null;
  model: string | null;
  state: string | null;
  agentClass: string;
  updatedAt: number | null;
  source: "scout" | "native";
};

type MissionControlState = {
  activityFilter: MissionActivityFilter;
  sourceFilter: MissionSourceFilter;
  recentWindowMs: MissionRecentWindow;
  query: string;
  focusedId: string | null;
  visibleAgents: MissionVisibleAgent[];
};

let _state: MissionControlState = {
  activityFilter: "all",
  sourceFilter: "all",
  recentWindowMs: MISSION_RECENT_WINDOWS[1].value,
  query: "",
  focusedId: null,
  visibleAgents: [],
};

const _listeners = new Set<() => void>();

function _notify() {
  for (const fn of _listeners) fn();
}

export function setMissionActivityFilter(activityFilter: MissionActivityFilter): void {
  if (_state.activityFilter === activityFilter) return;
  _state = { ..._state, activityFilter };
  _notify();
}

export function setMissionSourceFilter(sourceFilter: MissionSourceFilter): void {
  if (_state.sourceFilter === sourceFilter) return;
  _state = { ..._state, sourceFilter };
  _notify();
}

export function setMissionRecentWindow(recentWindowMs: MissionRecentWindow): void {
  if (_state.recentWindowMs === recentWindowMs) return;
  _state = { ..._state, recentWindowMs };
  _notify();
}

export function setMissionQuery(query: string): void {
  if (_state.query === query) return;
  _state = { ..._state, query };
  _notify();
}

export function setMissionFocusedId(focusedId: string | null): void {
  if (_state.focusedId === focusedId) return;
  _state = { ..._state, focusedId };
  _notify();
}

function visibleAgentsEqual(a: MissionVisibleAgent[], b: MissionVisibleAgent[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id) return false;
    if (x.state !== y.state) return false;
    if (x.updatedAt !== y.updatedAt) return false;
  }
  return true;
}

export function setMissionVisibleAgents(visibleAgents: MissionVisibleAgent[]): void {
  if (visibleAgentsEqual(_state.visibleAgents, visibleAgents)) return;
  _state = { ..._state, visibleAgents };
  _notify();
}

function _subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function _getSnapshot(): MissionControlState {
  return _state;
}

export function useMissionControlStore(): MissionControlState {
  return useSyncExternalStore(_subscribe, _getSnapshot);
}

export function missionAgentMatchesQuery(
  fields: { name?: string | null; handle?: string | null; project?: string | null; branch?: string | null; harness?: string | null; id?: string | null },
  query: string,
): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    fields.name,
    fields.handle,
    fields.project,
    fields.branch,
    fields.harness,
    fields.id,
  ]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase());
  return haystack.some((v) => v.includes(needle));
}
