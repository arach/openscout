import { stateColor } from "../../lib/colors.ts";
import { agentStateLabel } from "../../lib/agent-state.ts";
import type { MissionGroupMode } from "../../lib/mission-control-store.ts";

export const TILE_W = 420;
export const TILE_H = 320;
export const TILE_GAP = 20;
export const GROUP_GAP_X = 48;
export const GROUP_GAP_Y = 36;
export const GROUP_LABEL_H = 28;
export const CANVAS_PAD = 40;
export const FOCUS_TILE_MARGIN = 72;
export const MIN_FOCUS_ZOOM = 0.35;
export const MAX_FOCUS_ZOOM = 1.15;

export const MINIMAP_FALLBACK_W = 244;
export const MINIMAP_MAX_H = 160;
export const ACTIVE_EVENT_WINDOW_MS = 60_000;

export type MissionGroupFields = {
  activityLabel: string;
  workspace: string | null | undefined;
  harness: string | null | undefined;
  state: string | null | undefined;
  source: "scout" | "native";
};

export function missionGroupLabel(
  subject: MissionGroupFields,
  mode: MissionGroupMode,
): string {
  switch (mode) {
    case "activity":
      return subject.activityLabel;
    case "workspace":
      return subject.workspace?.trim() || "Unassigned";
    case "harness":
      return subject.harness?.trim() || "Unknown harness";
    case "state":
      return agentStateLabel(subject.state ?? null);
    case "source":
      return subject.source === "native" ? "Native sessions" : "Scout agents";
  }
}

export const KIND_COLOR: Record<string, string> = {
  think: "var(--dim)",
  tool: "var(--accent)",
  ask: "var(--amber)",
  message: "var(--muted)",
  note: "var(--green)",
  system: "var(--dim)",
  boot: "var(--dim)",
};

export const KIND_LABEL: Record<string, string> = {
  think: "think",
  tool: "tool",
  ask: "ask",
  message: "msg",
  note: "note",
  system: "sys",
  boot: "boot",
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function stateChipColor(state: string): string {
  return stateColor(state);
}
