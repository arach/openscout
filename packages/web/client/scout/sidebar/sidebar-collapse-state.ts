/**
 * Pure sidebar collapse + resize transitions (SCO-084 / SCO-086).
 * Kept free of React so unit tests do not load the hook module.
 */

/** Shared collapsed width for all rails (sidebar, side rail, inspector). */
export const RAIL_COLLAPSED_WIDTH = 48;

/** @deprecated Prefer RAIL_COLLAPSED_WIDTH — same value, shared across rails. */
export const SIDEBAR_COLLAPSED_WIDTH = RAIL_COLLAPSED_WIDTH;

/** Default expanded sidebar width (also the double-click reset target). */
export const SIDEBAR_EXPANDED_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH = 1023;

export type SidebarCollapseSnapshot = {
  manualCollapsed: boolean;
  autoCollapsed: boolean;
  forceExpanded: boolean;
};

/** Pure: effective collapsed state from preferences + viewport-derived flags. */
export function resolveEffectiveCollapsed(
  snapshot: SidebarCollapseSnapshot,
): boolean {
  return snapshot.autoCollapsed
    ? !snapshot.forceExpanded
    : snapshot.manualCollapsed;
}

/** Clamp expanded sidebar width to the SCO-086 min/max band. */
export function clampSidebarExpandedWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_EXPANDED_WIDTH;
  return Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)),
  );
}

/**
 * Resolve layout width from collapse + live/persisted expanded width.
 * Collapsed always uses RAIL_COLLAPSED_WIDTH; expanded uses the clamped value.
 */
export function resolveSidebarWidth(
  effectiveCollapsed: boolean,
  expandedWidth: number = SIDEBAR_EXPANDED_WIDTH,
): number {
  return effectiveCollapsed
    ? RAIL_COLLAPSED_WIDTH
    : clampSidebarExpandedWidth(expandedWidth);
}

/**
 * Pure, idempotent setCollapsed transition.
 * Wide viewport → manualCollapsed; auto-collapse viewport → forceExpanded only.
 */
export function applySetCollapsed(
  snapshot: SidebarCollapseSnapshot,
  nextCollapsed: boolean,
): Pick<SidebarCollapseSnapshot, "manualCollapsed" | "forceExpanded"> {
  if (snapshot.autoCollapsed) {
    return {
      manualCollapsed: snapshot.manualCollapsed,
      forceExpanded: !nextCollapsed,
    };
  }
  return {
    manualCollapsed: nextCollapsed,
    forceExpanded: snapshot.forceExpanded,
  };
}

/** Pure toggle of the active preference layer. */
export function applyToggleCollapsed(
  snapshot: SidebarCollapseSnapshot,
): Pick<SidebarCollapseSnapshot, "manualCollapsed" | "forceExpanded"> {
  const effective = resolveEffectiveCollapsed(snapshot);
  return applySetCollapsed(snapshot, !effective);
}
