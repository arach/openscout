/**
 * HUD sizing tokens. Every magic number that varies by `HudSize` lives
 * here so components stay readable and the four tabs stay in sync.
 *
 * Locked font ladder (project-wide):
 *   10  · chrome eyebrow / micro count
 *   11  · mono row body / dense tail line
 *   12  · sans secondary copy
 *   13  · sans primary copy (row headline, name)
 *   15  · sans display (rare; large headlines only)
 * No 9pt. No 14pt. No serif. No display face.
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
 *  — masthead, footer, section headers, agent rows, etc.). Standardized
 *  so every tab + every masthead pulls from the same axis. */
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

/** Activity-row grid template per size — `[time | gap | spine | gap | dispatch]`.
 *  The first column (time gutter) widens at medium/large so it can hold
 *  the stacked relative+absolute timestamp. */
export const ACTIVITY_GRID: Record<HudSize, string> = {
  compact: "36px 10px 1px 14px 1fr",
  medium: "54px 12px 1px 18px 1fr",
  large: "64px 14px 1px 20px 1fr",
};

/** Tail row font size — locked to the 10/11 mono range so tail reads
 *  as a denser, more raw stream than activity. */
export const TAIL_ROW_FONT_PX: Record<HudSize, number> = {
  compact: 10,
  medium: 11,
  large: 11,
};
