/**
 * Sidebar collapse + continuous resize state (SCO-083 / SCO-084 / SCO-086).
 *
 * - Manual preference persists under its own key (separate from legacy left panel).
 * - Auto-collapse below 1024px is derived from viewport and NEVER overwrites the
 *   persisted manual preference.
 * - Manual expand remains available while auto-collapsed (session-only force expand).
 * - setCollapsed is the controlled-provider seam: wide viewport updates
 *   manualCollapsed; auto-collapse viewport updates session-only forceExpanded.
 *   Do NOT wire onOpenChange as setManualCollapsed(!open).
 * - Expanded width persists under `appshell.${appId}.sidebar.width` (SCO-086).
 *   SCO-087: live drag updates only the ghost target (dragGhostWidth); the
 *   committed layout width and all insets stay pinned until pointer-up, so the
 *   center pane reflows at most once per resize instead of every pointer-move.
 */
import { useCallback, useEffect, useState } from "react";
import { usePersistentState } from "@hudsonkit";
import {
  RAIL_COLLAPSED_WIDTH,
  SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  applySetCollapsed,
  applyToggleCollapsed,
  clampSidebarExpandedWidth,
  resolveEffectiveCollapsed,
  resolveSidebarWidth,
  type SidebarCollapseSnapshot,
} from "./sidebar-collapse-state.ts";

export {
  RAIL_COLLAPSED_WIDTH,
  SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  applySetCollapsed,
  applyToggleCollapsed,
  clampSidebarExpandedWidth,
  resolveEffectiveCollapsed,
  resolveSidebarWidth,
  type SidebarCollapseSnapshot,
} from "./sidebar-collapse-state.ts";

export function useSidebarCollapse(appId: string, viewportWidth: number) {
  const storageKey = `appshell.${appId}.sidebar.manualCollapsed`;
  const widthKey = `appshell.${appId}.sidebar.width`;
  // Default presentation is the 48px icon rail (SCO-084 Req 7 revised).
  // Expanded width is available via trigger / ⌘B, not the default.
  const [manualCollapsed, setManualCollapsed] = usePersistentState(storageKey, true);
  const [persistedExpandedWidth, setPersistedExpandedWidth] = usePersistentState(
    widthKey,
    SIDEBAR_EXPANDED_WIDTH,
  );
  const autoCollapsed = viewportWidth <= SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH;
  const [forceExpanded, setForceExpanded] = useState(false);
  /** Live width during drag; null when not resizing. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);

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
  // SCO-087: layout width IGNORES the live drag value. During a drag-resize the
  // sidebar and every inset derived from it stay pinned to the committed width,
  // so the heavy center pane never relayouts per pointer-move. `dragGhostWidth`
  // is the live target used only to paint a ghost edge; the real width commits
  // once on pointer-up (endResize).
  const expandedWidth = clampSidebarExpandedWidth(persistedExpandedWidth);
  const dragGhostWidth =
    dragWidth != null ? clampSidebarExpandedWidth(dragWidth) : null;
  const width = resolveSidebarWidth(effectiveCollapsed, expandedWidth);

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

  const setExpandedWidth = useCallback(
    (next: number) => {
      setPersistedExpandedWidth(clampSidebarExpandedWidth(next));
    },
    [setPersistedExpandedWidth],
  );

  const resetExpandedWidth = useCallback(() => {
    setPersistedExpandedWidth(SIDEBAR_EXPANDED_WIDTH);
    setDragWidth(null);
  }, [setPersistedExpandedWidth]);

  /** Start a live resize session from the current expanded width. */
  const beginResize = useCallback((startWidth?: number) => {
    setIsSidebarResizing(true);
    setDragWidth(
      clampSidebarExpandedWidth(startWidth ?? persistedExpandedWidth),
    );
  }, [persistedExpandedWidth]);

  /** Update live width during drag (no storage write). */
  const updateResize = useCallback((nextWidth: number) => {
    setDragWidth(clampSidebarExpandedWidth(nextWidth));
  }, []);

  /** Persist live width and clear the drag session. */
  const endResize = useCallback(() => {
    setDragWidth((current) => {
      if (current != null) {
        setPersistedExpandedWidth(clampSidebarExpandedWidth(current));
      }
      return null;
    });
    setIsSidebarResizing(false);
  }, [setPersistedExpandedWidth]);

  return {
    manualCollapsed,
    autoCollapsed,
    forceExpanded,
    effectiveCollapsed,
    /** Live layout width (collapsed rail or expanded). */
    width,
    /** Committed expanded width (never the collapsed rail width; stable during drag). */
    expandedWidth,
    /** Live drag target for the ghost edge; null when not resizing (SCO-087). */
    dragGhostWidth,
    isSidebarResizing,
    toggleCollapsed,
    setCollapsed,
    setManualCollapsed,
    setExpandedWidth,
    resetExpandedWidth,
    beginResize,
    updateResize,
    endResize,
  };
}
