/**
 * Pure sidebar collapse transitions (SCO-084).
 * Kept free of React so unit tests do not load the hook module.
 */

export const SIDEBAR_EXPANDED_WIDTH = 260;
export const SIDEBAR_COLLAPSED_WIDTH = 48;
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

export function resolveSidebarWidth(effectiveCollapsed: boolean): number {
  return effectiveCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;
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
