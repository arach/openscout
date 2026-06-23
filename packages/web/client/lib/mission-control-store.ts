import { useSyncExternalStore } from "react";

export type MissionActivityFilter = "active" | "live" | "all";
export type MissionSourceFilter = "all" | "scout" | "native";
export type MissionGroupMode = "activity" | "workspace";
export type MissionActivityState = "active" | "recent" | "idle";

export const MISSION_ACTIVITY_WINDOWS = [
  { label: "5m", value: 5 * 60_000 },
  { label: "30m", value: 30 * 60_000 },
  { label: "4h", value: 4 * 60 * 60_000 },
  { label: "24h", value: 24 * 60 * 60_000 },
] as const;

type MissionActivityWindow = (typeof MISSION_ACTIVITY_WINDOWS)[number]["value"];

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
  activity: MissionActivityState;
  lastActiveAt: number | null;
};

export type MissionCanvasFocusRequest = {
  id: string;
  serial: number;
};

type MissionControlState = {
  activityFilter: MissionActivityFilter;
  sourceFilter: MissionSourceFilter;
  activityWindowMs: MissionActivityWindow;
  groupMode: MissionGroupMode;
  query: string;
  focusedId: string | null;
  canvasFocusRequest: MissionCanvasFocusRequest | null;
  visibleAgents: MissionVisibleAgent[];
  selectedIds: string[];
};

let _state: MissionControlState = {
  activityFilter: "active",
  sourceFilter: "all",
  activityWindowMs: MISSION_ACTIVITY_WINDOWS[3].value,
  groupMode: "activity",
  query: "",
  focusedId: null,
  canvasFocusRequest: null,
  visibleAgents: [],
  selectedIds: [],
};

const _listeners = new Set<() => void>();
let _canvasFocusSerial = 0;

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

export function setMissionActivityWindow(activityWindowMs: MissionActivityWindow): void {
  if (_state.activityWindowMs === activityWindowMs) return;
  _state = { ..._state, activityWindowMs };
  _notify();
}

export const MISSION_RECENT_WINDOWS = MISSION_ACTIVITY_WINDOWS;
export const setMissionRecentWindow = setMissionActivityWindow;

export function setMissionGroupMode(groupMode: MissionGroupMode): void {
  if (_state.groupMode === groupMode) return;
  _state = { ..._state, groupMode };
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

export function requestMissionCanvasFocus(id: string): void {
  _canvasFocusSerial += 1;
  _state = {
    ..._state,
    canvasFocusRequest: { id, serial: _canvasFocusSerial },
  };
  _notify();
}

export function clearMissionCanvasFocusRequest(serial: number): void {
  if (_state.canvasFocusRequest?.serial !== serial) return;
  _state = { ..._state, canvasFocusRequest: null };
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
    if (x.activity !== y.activity) return false;
    if (x.lastActiveAt !== y.lastActiveAt) return false;
  }
  return true;
}

export function setMissionVisibleAgents(visibleAgents: MissionVisibleAgent[]): void {
  if (visibleAgentsEqual(_state.visibleAgents, visibleAgents)) return;
  _state = { ..._state, visibleAgents };
  _notify();
}

export function toggleMissionSelected(id: string): void {
  const has = _state.selectedIds.includes(id);
  _state = {
    ..._state,
    selectedIds: has
      ? _state.selectedIds.filter((x) => x !== id)
      : [..._state.selectedIds, id],
  };
  _notify();
}

export function clearMissionSelection(): void {
  if (_state.selectedIds.length === 0) return;
  _state = { ..._state, selectedIds: [] };
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
