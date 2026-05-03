import { useSyncExternalStore } from "react";
import type { MeshStatus } from "./types.ts";

type MeshViewState = {
  mode: "map" | "fleet";
  selectedId: string | null;
  selectedType: "node" | "agent" | null;
  meshSnapshot: MeshStatus | null;
};

let _state: MeshViewState = {
  mode: "map",
  selectedId: null,
  selectedType: null,
  meshSnapshot: null,
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
