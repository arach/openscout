/**
 * Sidebar collapse state (SCO-083 / SCO-084).
 *
 * - Manual preference persists under its own key (separate from legacy left panel).
 * - Auto-collapse below 1024px is derived from viewport and NEVER overwrites the
 *   persisted manual preference.
 * - Manual expand remains available while auto-collapsed (session-only force expand).
 * - setCollapsed is the controlled-provider seam: wide viewport updates
 *   manualCollapsed; auto-collapse viewport updates session-only forceExpanded.
 *   Do NOT wire onOpenChange as setManualCollapsed(!open).
 */
import { useCallback, useEffect, useState } from "react";
import { usePersistentState } from "@hudsonkit";
import {
  SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  applySetCollapsed,
  applyToggleCollapsed,
  resolveEffectiveCollapsed,
  resolveSidebarWidth,
  type SidebarCollapseSnapshot,
} from "./sidebar-collapse-state.ts";

export {
  SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  applySetCollapsed,
  applyToggleCollapsed,
  resolveEffectiveCollapsed,
  resolveSidebarWidth,
  type SidebarCollapseSnapshot,
} from "./sidebar-collapse-state.ts";

export function useSidebarCollapse(appId: string, viewportWidth: number) {
  const storageKey = `appshell.${appId}.sidebar.manualCollapsed`;
  // Default presentation is the 48px icon rail (SCO-084 Req 7 revised).
  // Expanded 260px is available via trigger / ⌘B, not the default.
  const [manualCollapsed, setManualCollapsed] = usePersistentState(storageKey, true);
  const autoCollapsed = viewportWidth <= SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH;
  const [forceExpanded, setForceExpanded] = useState(false);

  useEffect(() => {
    if (!autoCollapsed) {
      setForceExpanded(false);
    }
  }, [autoCollapsed]);

  const snapshot: SidebarCollapseSnapshot = {
    manualCollapsed,
    autoCollapsed,
    forceExpanded,
  };
  const effectiveCollapsed = resolveEffectiveCollapsed(snapshot);
  const width = resolveSidebarWidth(effectiveCollapsed);

  const toggleCollapsed = useCallback(() => {
    const next = applyToggleCollapsed({
      manualCollapsed,
      autoCollapsed,
      forceExpanded,
    });
    if (autoCollapsed) {
      setForceExpanded(next.forceExpanded);
      return;
    }
    setManualCollapsed(next.manualCollapsed);
  }, [autoCollapsed, forceExpanded, manualCollapsed, setManualCollapsed]);

  /**
   * Controlled SidebarProvider seam.
   * Idempotent: setting the same collapsed state is a no-op on the active layer.
   */
  const setCollapsed = useCallback(
    (nextCollapsed: boolean) => {
      const next = applySetCollapsed(
        { manualCollapsed, autoCollapsed, forceExpanded },
        nextCollapsed,
      );
      if (autoCollapsed) {
        setForceExpanded((current) =>
          current === next.forceExpanded ? current : next.forceExpanded,
        );
        return;
      }
      setManualCollapsed((current) =>
        current === next.manualCollapsed ? current : next.manualCollapsed,
      );
    },
    [autoCollapsed, forceExpanded, manualCollapsed, setManualCollapsed],
  );

  return {
    manualCollapsed,
    autoCollapsed,
    forceExpanded,
    effectiveCollapsed,
    width,
    toggleCollapsed,
    setCollapsed,
    setManualCollapsed,
  };
}
