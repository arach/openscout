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
  switch (state) {
    case "working": return "var(--green)";
    case "ready": return "var(--accent)";
    default: return "var(--dim)";
  }
}
