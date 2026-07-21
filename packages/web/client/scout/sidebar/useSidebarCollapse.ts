/**
 * Sidebar collapse state (SCO-083).
 *
 * - Manual preference persists under its own key (separate from legacy left panel).
 * - Auto-collapse below 1024px is derived from viewport and NEVER overwrites the
 *   persisted manual preference.
 * - Manual expand remains available while auto-collapsed (session-only force expand).
 */
import { useCallback, useEffect, useState } from "react";
import { usePersistentState } from "@hudsonkit";

export const SIDEBAR_EXPANDED_WIDTH = 260;
export const SIDEBAR_COLLAPSED_WIDTH = 48;
export const SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH = 1023;

export function useSidebarCollapse(appId: string, viewportWidth: number) {
  const storageKey = `appshell.${appId}.sidebar.manualCollapsed`;
  const [manualCollapsed, setManualCollapsed] = usePersistentState(storageKey, false);
  const autoCollapsed = viewportWidth <= SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH;
  const [forceExpanded, setForceExpanded] = useState(false);

  useEffect(() => {
    if (!autoCollapsed) {
      setForceExpanded(false);
    }
  }, [autoCollapsed]);

  const effectiveCollapsed = autoCollapsed ? !forceExpanded : manualCollapsed;
  const width = effectiveCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;

  const toggleCollapsed = useCallback(() => {
    if (autoCollapsed) {
      // Session-only; does not touch the persisted manual preference.
      setForceExpanded((current) => !current);
      return;
    }
    setManualCollapsed((current) => !current);
  }, [autoCollapsed, setManualCollapsed]);

  return {
    manualCollapsed,
    autoCollapsed,
    forceExpanded,
    effectiveCollapsed,
    width,
    toggleCollapsed,
    setManualCollapsed,
  };
}
