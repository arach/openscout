/**
 * HUD sizing tokens. Every magic number that varies by `HudSize` lives
 * here so components stay readable and the four tabs stay in sync.
 */

import type { HudSize } from "./types";

export interface HudDims {
  /** Outer panel width in px. */
  w: number;
  /** Outer panel height in px. */
  h: number;
}

export const PANEL_DIMS: Record<HudSize, HudDims> = {
  compact: { w: 420, h: 520 },
  medium: { w: 680, h: 640 },
  large: { w: 900, h: 720 },
};

/** Horizontal padding utility classes per size (applied to chrome rows
 *  — masthead, footer, section headers, fleet rows, etc.). */
export const PANEL_PAD_X: Record<HudSize, string> = {
  compact: "px-4",
  medium: "px-4",
  large: "px-5",
};

/** Activity-pulse strip geometry per size — 8 bars, varying width / gap
 *  / max height. */
export interface PulseCfg {
  bar: number;
  gap: number;
  maxH: number;
}

export const PULSE_CFG: Record<HudSize, PulseCfg> = {
  compact: { bar: 2, gap: 2, maxH: 10 },
  medium: { bar: 3, gap: 2, maxH: 12 },
  large: { bar: 3, gap: 3, maxH: 14 },
};

/** Observe-row grid template per size — `[time | gap | spine | gap | dispatch]`.
 *  The first column (time gutter) widens at medium/large so it can hold
 *  the stacked relative+absolute timestamp. */
export const OBSERVE_GRID: Record<HudSize, string> = {
  compact: "36px 10px 1px 14px 1fr",
  medium: "54px 12px 1px 18px 1fr",
  large: "64px 14px 1px 20px 1fr",
};

/** Number of pane-preview lines shown in the session card on
 *  medium/large. Compact uses the one-line snippet instead. The
 *  engaged detail panel uses `SESSION_PANE_LINES_ENGAGED` to show more
 *  context. */
export const SESSION_PANE_LINES: Record<HudSize, number> = {
  compact: 0,
  medium: 3,
  large: 3,
};

export const SESSION_PANE_LINES_ENGAGED = 8;
