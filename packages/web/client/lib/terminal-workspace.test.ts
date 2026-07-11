import { describe, expect, test } from "bun:test";
import {
  moveTerminalWorkspaceItem,
  resolveTerminalProjectDestinations,
  terminalProjectCdCommand,
  terminalWorkspaceDropPlacement,
} from "./terminal-workspace.ts";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

describe("moveTerminalWorkspaceItem", () => {
  test("moves a tile before an earlier tile", () => {
    expect(moveTerminalWorkspaceItem(items, "d", "b", "before").map((item) => item.id))
      .toEqual(["a", "d", "b", "c"]);
  });

  test("moves a tile after a later tile", () => {
    expect(moveTerminalWorkspaceItem(items, "a", "c", "after").map((item) => item.id))
      .toEqual(["b", "c", "a", "d"]);
  });

  test("leaves the order unchanged for missing or identical ids", () => {
    expect(moveTerminalWorkspaceItem(items, "a", "a", "after")).toEqual(items);
    expect(moveTerminalWorkspaceItem(items, "missing", "b", "before")).toEqual(items);
  });
});

describe("terminalWorkspaceDropPlacement", () => {
  const bounds = { left: 100, top: 200, width: 400, height: 300 };

  test("uses top and bottom halves for a single-column grid", () => {
    expect(terminalWorkspaceDropPlacement({ x: 490, y: 220 }, bounds, 1))
      .toEqual({ axis: "vertical", edge: "before" });
    expect(terminalWorkspaceDropPlacement({ x: 110, y: 480 }, bounds, 1))
      .toEqual({ axis: "vertical", edge: "after" });
  });

  test("uses left and right halves for a multi-column grid", () => {
    expect(terminalWorkspaceDropPlacement({ x: 120, y: 480 }, bounds, 2))
      .toEqual({ axis: "horizontal", edge: "before" });
    expect(terminalWorkspaceDropPlacement({ x: 480, y: 220 }, bounds, 2))
      .toEqual({ axis: "horizontal", edge: "after" });
  });
});

describe("resolveTerminalProjectDestinations", () => {
  test("keeps configured projects canonical and ranks active roots first", () => {
    const destinations = resolveTerminalProjectDestinations(
      [
        { id: "alpha", title: "Alpha", root: "/Users/art/dev/alpha" },
        { id: "scout", title: "OpenScout", root: "/Users/art/dev/openscout/" },
      ],
      [
        {
          id: "agent-1",
          name: "Scout agent",
          project: "stale label",
          projectRoot: "~/dev/openscout",
          cwd: "~/dev/openscout/packages/web",
          updatedAt: 200,
        },
      ],
    );

    expect(destinations).toEqual([
      {
        id: "configured:scout",
        label: "OpenScout",
        path: "/Users/art/dev/openscout",
        source: "configured",
      },
      {
        id: "configured:alpha",
        label: "Alpha",
        path: "/Users/art/dev/alpha",
        source: "configured",
      },
    ]);
  });

  test("falls back to recent agent workspaces and rejects unsafe paths", () => {
    const destinations = resolveTerminalProjectDestinations([], [
      {
        id: "older",
        name: "Older",
        project: null,
        projectRoot: "/Users/art/dev/older",
        cwd: null,
        updatedAt: 10,
      },
      {
        id: "unsafe",
        name: "Unsafe",
        project: "Unsafe",
        projectRoot: "/Users/art/dev/unsafe\nrm -rf ~",
        cwd: null,
        updatedAt: 30,
      },
      {
        id: "newer",
        name: "Newer",
        project: "Newest",
        projectRoot: null,
        cwd: "/Users/art/dev/newer",
        updatedAt: 20,
      },
    ]);

    expect(destinations.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: "Newest", path: "/Users/art/dev/newer" },
      { label: "older", path: "/Users/art/dev/older" },
    ]);
  });
});

describe("terminalProjectCdCommand", () => {
  test("quotes spaces and embedded single quotes for the shell", () => {
    expect(terminalProjectCdCommand("/Users/art/dev/My Project's app"))
      .toBe("cd -- '/Users/art/dev/My Project'\\''s app'");
  });

  test("keeps the home shortcut expandable", () => {
    expect(terminalProjectCdCommand("~/dev/My Project"))
      .toBe("cd -- ~/'dev/My Project'");
  });
});
