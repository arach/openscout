import { useSyncExternalStore } from "react";
import type { MeshStatus } from "./types.ts";

export type ProbeAgent = {
  id: string;
  title: string;
  state: string;
  statusLabel: string;
  activeTask: string | null;
};

export type ProbeResult = {
  reachable: boolean;
  home: { agents: ProbeAgent[] } | null;
  node: {
    id?: string;
    name?: string;
    hostName?: string;
    meshId?: string;
    capabilities?: string[];
    brokerUrl?: string;
    version?: string;
  } | null;
  error?: string;
};

export type ProbeEntry = {
  status: "loading" | "done" | "error";
  result: ProbeResult | null;
  fetchedAt: number;
};

type MeshViewState = {
  mode: "map" | "fleet";
  selectedId: string | null;
  selectedType: "node" | "agent" | null;
  meshSnapshot: MeshStatus | null;
  probeCache: Record<string, ProbeEntry>;
};

let _state: MeshViewState = {
  mode: "map",
  selectedId: null,
  selectedType: null,
  meshSnapshot: null,
  probeCache: {},
};

const _listeners = new Set<() => void>();

function _notify() {
  for (const fn of _listeners) fn();
}

export function setMeshViewMode(mode: "map" | "fleet"): void {
  if (_state.mode === mode) return;
  _state = { ..._state, mode };
  _notify();
}

export function setMeshSelection(id: string | null, type: "node" | "agent" | null): void {
  if (_state.selectedId === id && _state.selectedType === type) return;
  _state = { ..._state, selectedId: id, selectedType: type };
  _notify();
}

export function setMeshSnapshot(snapshot: MeshStatus | null): void {
  _state = { ..._state, meshSnapshot: snapshot };
  _notify();
}

export function setProbeEntry(nodeId: string, entry: ProbeEntry): void {
  _state = { ..._state, probeCache: { ..._state.probeCache, [nodeId]: entry } };
  _notify();
}

function _subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function _getSnapshot(): MeshViewState {
  return _state;
}

export function useMeshViewStore(): MeshViewState {
  return useSyncExternalStore(_subscribe, _getSnapshot);
}
