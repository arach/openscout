import { describe, expect, test } from "bun:test";
import {
  GO_SHORTCUT_PROJECTION,
  NAV_DESTINATIONS,
  allProjectedDestinationIds,
  areaSubNavForRoute,
  getDestination,
  projectAreaSubNav,
  projectCoreSystemMenuEntries,
  projectGoShortcuts,
  projectJumpDockItems,
  projectOpsSecondaryNav,
  projectOpsSystemMenuEntries,
  projectPaletteNavCommands,
  projectTopNavItems,
  type NavDestinationId,
} from "./nav-destinations.ts";
import { CORE_SYSTEM_MENU_ENTRIES, SYSTEM_OPS_ENTRIES } from "./nav-system-menu-config.ts";
import {
  AGENTS_SECONDARY_NAV,
  CHAT_SECONDARY_NAV,
  OPS_SECONDARY_NAV,
} from "./secondaryNavConfig.ts";
import { GO_SHORTCUTS } from "../lib/go-shortcuts.ts";
import { TOP_NAV_ITEMS } from "./topNavConfig.ts";

describe("nav destination catalog", () => {
  test("every catalog destination has a unique id, route, and active predicate", () => {
    const ids = NAV_DESTINATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const destination of NAV_DESTINATIONS) {
      expect(destination.id).toBeTruthy();
      expect(destination.label).toBeTruthy();
      expect(destination.route).toBeTruthy();
      expect(typeof destination.route.view).toBe("string");
      expect(typeof destination.active).toBe("function");
      // Default route should activate its own destination.
      expect(destination.active(destination.route)).toBe(true);
    }
  });

  test("every projected destination id resolves to a catalog entry", () => {
    for (const id of allProjectedDestinationIds()) {
      const destination = getDestination(id);
      expect(destination.id).toBe(id);
      expect(destination.active(destination.route)).toBe(true);
    }
  });

  test("top nav projection matches the public TOP_NAV_ITEMS export", () => {
    expect(projectTopNavItems()).toEqual(TOP_NAV_ITEMS);
    expect(TOP_NAV_ITEMS.map((item) => item.key)).toEqual([
      "home",
      "agents",
      "sessions",
      "chat",
    ]);
  });

  test("system menu projections match public exports and share active with secondary ops", () => {
    expect(projectCoreSystemMenuEntries().map((e) => e.key)).toEqual(
      CORE_SYSTEM_MENU_ENTRIES.map((e) => e.key),
    );
    expect(projectOpsSystemMenuEntries().map((e) => e.key)).toEqual(
      SYSTEM_OPS_ENTRIES.map((e) => e.key),
    );

    const systemMission = SYSTEM_OPS_ENTRIES.find((e) => e.key === "control");
    const secondaryMission = OPS_SECONDARY_NAV
      .flatMap((g) => g.items)
      .find((item) => item.id === "control");

    expect(systemMission).toBeDefined();
    expect(secondaryMission).toBeDefined();
    // Shared destination identity: same active semantics (no duplicated predicates).
    expect(systemMission!.active).toBe(secondaryMission!.active);
    expect(systemMission!.route).toEqual(secondaryMission!.route);
    expect(systemMission!.active({ view: "ops" })).toBe(true);
    expect(systemMission!.active({ view: "ops", mode: "mission" })).toBe(true);
    expect(systemMission!.active({ view: "ops", mode: "tail" })).toBe(false);
  });

  test("ops secondary nav items resolve to catalog destinations with valid active predicates", () => {
    const opsItems = projectOpsSecondaryNav().flatMap((g) => g.items);
    expect(opsItems.length).toBeGreaterThan(0);
    for (const item of opsItems) {
      expect(item.active(item.route)).toBe(true);
    }
    // Public export is the projection.
    expect(OPS_SECONDARY_NAV).toEqual(projectOpsSecondaryNav());
  });

  test("secondary nav surfaces stay wired to the catalog", () => {
    expect(AGENTS_SECONDARY_NAV[0]?.items[0]?.route).toEqual({
      view: "settings",
      section: "agents",
    });
    expect(CHAT_SECONDARY_NAV[0]?.items.map((i) => i.id)).toEqual([
      "messages",
      "channels",
    ]);
  });

  test("ops secondary nav excludes Dispatch/Repos/Code (SCO-083 area boundaries)", () => {
    const ids = OPS_SECONDARY_NAV.flatMap((g) => g.items).map((item) => item.id);
    expect(ids).not.toContain("dispatch");
    expect(ids).not.toContain("repos");
    expect(ids).not.toContain("code");
    expect(ids).toEqual([
      "lanes",
      "control",
      "harnesses",
      "mesh",
      "tail",
      "runtime",
      "plans",
    ]);
  });

  test("go-shortcuts projection preserves keys and resolves destinations", () => {
    const projected = projectGoShortcuts();
    expect(projected).toEqual([...GO_SHORTCUTS]);
    const keys = projected.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const shortcut of projected) {
      const destination = getDestination(shortcut.destinationId);
      expect(destination).toBeDefined();
      // Active predicate comes from the catalog destination.
      if (shortcut.route.view === destination.route.view) {
        expect(destination.active(shortcut.route) || destination.active(destination.route)).toBe(
          true,
        );
      }
    }
    // Bare ops shortcut still uses historical route shape.
    expect(GO_SHORTCUTS.find((s) => s.key === "o")?.route).toEqual({ view: "ops" });
  });

  test("jump dock projection items resolve to catalog destinations", () => {
    const jumps = projectJumpDockItems();
    expect(jumps.length).toBeGreaterThan(0);
    for (const jump of jumps) {
      const destination = getDestination(jump.destinationId);
      expect(destination).toBeDefined();
      expect(jump.icon).toBeTruthy();
      expect(jump.route.view).toBeTruthy();
    }
    const opsJump = jumps.find((j) => j.id === "ops");
    expect(opsJump?.opsGated).toBe(true);
    expect(opsJump?.route).toEqual({ view: "ops", mode: "mission" });
  });

  test("palette nav projection resolves destinations and gates ops entries", () => {
    const all = projectPaletteNavCommands({ opsEnabled: true });
    const gated = projectPaletteNavCommands({ opsEnabled: false });
    expect(all.some((c) => c.id === "nav:ops")).toBe(true);
    expect(all.some((c) => c.id === "nav:ops-atop")).toBe(true);
    expect(gated.some((c) => c.id === "nav:ops")).toBe(false);
    expect(gated.some((c) => c.id === "nav:ops-atop")).toBe(false);
    // Settings drawer is intentionally absent from the destination projection.
    expect(all.some((c) => c.id === "nav:settings")).toBe(false);
    // Agent config remains a routed destination.
    expect(all.find((c) => c.id === "nav:agent-config")?.route).toEqual({
      view: "settings",
      section: "agents",
    });
    for (const command of all) {
      const destination = getDestination(command.destinationId as NavDestinationId);
      expect(destination).toBeDefined();
      expect(command.route.view).toBeTruthy();
    }
  });

  test("go-shortcut projection table only references known destinations", () => {
    for (const entry of GO_SHORTCUT_PROJECTION) {
      expect(() => getDestination(entry.destinationId)).not.toThrow();
    }
  });

  test("AREA_SUB_NAV projection covers repos/code/terminals (SCO-085)", () => {
    const projects = projectAreaSubNav("projects");
    expect(projects.map((item) => item.id)).toEqual(["projects", "repos", "code"]);
    expect(projects.find((item) => item.id === "repos")?.route).toEqual({ view: "repos" });
    expect(projects.find((item) => item.id === "code")?.route).toEqual({ view: "code" });

    const sessions = projectAreaSubNav("sessions");
    expect(sessions.map((item) => item.id)).toEqual(["sessions", "terminals"]);
    expect(sessions.find((item) => item.id === "terminals")?.route).toEqual({
      view: "terminal",
    });
  });

  test("repos.active includes repo-diff (SCO-085)", () => {
    const repos = getDestination("repos");
    expect(repos.active({ view: "repos" })).toBe(true);
    expect(repos.active({ view: "repo-diff" })).toBe(true);
    expect(repos.active({ view: "code" })).toBe(false);

    const sub = areaSubNavForRoute({ view: "repo-diff" });
    expect(sub?.areaId).toBe("projects");
    expect(sub?.items.find((item) => item.id === "repos")?.active({ view: "repo-diff" })).toBe(
      true,
    );
  });

  test("areaSubNavForRoute maps projects and sessions surfaces", () => {
    expect(areaSubNavForRoute({ view: "agents-v2" })?.areaId).toBe("projects");
    expect(areaSubNavForRoute({ view: "code" })?.areaId).toBe("projects");
    expect(areaSubNavForRoute({ view: "sessions" })?.areaId).toBe("sessions");
    expect(areaSubNavForRoute({ view: "terminal" })?.areaId).toBe("sessions");
    expect(areaSubNavForRoute({ view: "ops", mode: "lanes" })).toBeNull();
    expect(areaSubNavForRoute({ view: "inbox" })).toBeNull();
  });
});
