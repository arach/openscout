import { describe, expect, test } from "bun:test";
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

describe("sidebar collapse constants (SCO-083 / SCO-086)", () => {
  test("auto-collapse breakpoint is below 1024px", () => {
    expect(SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH).toBe(1023);
    expect(900).toBeLessThanOrEqual(SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH);
    expect(1280).toBeGreaterThan(SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH);
  });

  test("expanded and icon-rail widths match the anatomy", () => {
    expect(SIDEBAR_EXPANDED_WIDTH).toBe(260);
    expect(SIDEBAR_COLLAPSED_WIDTH).toBe(48);
    expect(RAIL_COLLAPSED_WIDTH).toBe(48);
    expect(SIDEBAR_COLLAPSED_WIDTH).toBe(RAIL_COLLAPSED_WIDTH);
  });

  test("resize band is min 200 / max 360 / default 260", () => {
    expect(SIDEBAR_MIN_WIDTH).toBe(200);
    expect(SIDEBAR_MAX_WIDTH).toBe(360);
    expect(SIDEBAR_EXPANDED_WIDTH).toBe(260);
  });
});

describe("sidebar resize pure logic (SCO-086)", () => {
  test("clampSidebarExpandedWidth clamps to min/max and rounds", () => {
    expect(clampSidebarExpandedWidth(100)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarExpandedWidth(500)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarExpandedWidth(250.6)).toBe(251);
    expect(clampSidebarExpandedWidth(Number.NaN)).toBe(SIDEBAR_EXPANDED_WIDTH);
  });

  test("resolveSidebarWidth uses expandedWidth when expanded", () => {
    expect(resolveSidebarWidth(true)).toBe(RAIL_COLLAPSED_WIDTH);
    expect(resolveSidebarWidth(false)).toBe(SIDEBAR_EXPANDED_WIDTH);
    expect(resolveSidebarWidth(false, 220)).toBe(220);
    expect(resolveSidebarWidth(false, 180)).toBe(SIDEBAR_MIN_WIDTH);
    expect(resolveSidebarWidth(true, 300)).toBe(RAIL_COLLAPSED_WIDTH);
  });

  test("double-click reset target is SIDEBAR_EXPANDED_WIDTH (260)", () => {
    expect(clampSidebarExpandedWidth(SIDEBAR_EXPANDED_WIDTH)).toBe(260);
  });
});

describe("sidebar collapse pure transitions (SCO-084)", () => {
  const wide: SidebarCollapseSnapshot = {
    manualCollapsed: false,
    autoCollapsed: false,
    forceExpanded: false,
  };
  const narrow: SidebarCollapseSnapshot = {
    manualCollapsed: false,
    autoCollapsed: true,
    forceExpanded: false,
  };

  test("wide viewport uses manualCollapsed for effective state", () => {
    expect(resolveEffectiveCollapsed(wide)).toBe(false);
    expect(resolveEffectiveCollapsed({ ...wide, manualCollapsed: true })).toBe(true);
    expect(resolveSidebarWidth(true)).toBe(SIDEBAR_COLLAPSED_WIDTH);
    expect(resolveSidebarWidth(false)).toBe(SIDEBAR_EXPANDED_WIDTH);
  });

  test("narrow viewport derives collapse unless forceExpanded", () => {
    expect(resolveEffectiveCollapsed(narrow)).toBe(true);
    expect(resolveEffectiveCollapsed({ ...narrow, forceExpanded: true })).toBe(false);
    // Manual preference does not affect narrow derived collapse.
    expect(
      resolveEffectiveCollapsed({ ...narrow, manualCollapsed: false, forceExpanded: false }),
    ).toBe(true);
  });

  test("setCollapsed on wide viewport updates manual only", () => {
    const collapse = applySetCollapsed(wide, true);
    expect(collapse.manualCollapsed).toBe(true);
    expect(collapse.forceExpanded).toBe(false);

    const expand = applySetCollapsed({ ...wide, manualCollapsed: true }, false);
    expect(expand.manualCollapsed).toBe(false);
    expect(expand.forceExpanded).toBe(false);
  });

  test("setCollapsed on narrow viewport updates forceExpanded only (never manual)", () => {
    const expand = applySetCollapsed(
      { ...narrow, manualCollapsed: true },
      false,
    );
    expect(expand.manualCollapsed).toBe(true); // preserved
    expect(expand.forceExpanded).toBe(true);

    const collapse = applySetCollapsed(
      { ...narrow, manualCollapsed: true, forceExpanded: true },
      true,
    );
    expect(collapse.manualCollapsed).toBe(true); // preserved
    expect(collapse.forceExpanded).toBe(false);
  });

  test("setCollapsed is idempotent for already-desired state", () => {
    const again = applySetCollapsed({ ...wide, manualCollapsed: true }, true);
    expect(again.manualCollapsed).toBe(true);

    const againNarrow = applySetCollapsed(
      { ...narrow, forceExpanded: true },
      false,
    );
    expect(againNarrow.forceExpanded).toBe(true);
  });

  test("toggle uses the active preference layer", () => {
    const wideToggle = applyToggleCollapsed(wide);
    expect(wideToggle.manualCollapsed).toBe(true);
    expect(wideToggle.forceExpanded).toBe(false);

    const narrowToggle = applyToggleCollapsed(narrow);
    expect(narrowToggle.manualCollapsed).toBe(false);
    expect(narrowToggle.forceExpanded).toBe(true);
  });

  test("onOpenChange must not map to setManualCollapsed(!open) on narrow", () => {
    // Regression guard for the Codex correction: if open=true on a narrow
    // viewport, we set forceExpanded, never flip manualCollapsed.
    const open = true;
    const nextCollapsed = !open;
    const next = applySetCollapsed(
      { manualCollapsed: false, autoCollapsed: true, forceExpanded: false },
      nextCollapsed,
    );
    expect(next.manualCollapsed).toBe(false);
    expect(next.forceExpanded).toBe(true);
  });
});
