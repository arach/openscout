import { describe, expect, test } from "bun:test";

import { formatTerminalSurfaceId } from "./terminal-surface-id.js";
import type { TerminalSessionRecord, TerminalSurface } from "./terminal-sessions.js";
import {
  normalizeTerminalWorkspaceColumns,
  reconcileTerminalWorkspace,
  resolveTerminalWorkspaceColumns,
  TERMINAL_WORKSPACE_MAX_COLUMNS,
  terminalWorkspaceLayoutLabel,
  terminalWorkspaceLayoutOf,
  type TerminalWorkspaceCell,
  type TerminalWorkspaceHostState,
  type TerminalWorkspaceRecord,
} from "./terminal-workspaces.js";

const HOSTS: TerminalWorkspaceHostState[] = [
  { id: "tmux", installed: true, canCreate: true },
  { id: "zellij", installed: true, canCreate: true },
  { id: "herdr", installed: true, canCreate: false },
  { id: "screen", installed: false, canCreate: true },
];

function surface(backend: string, sessionName: string, state: TerminalSurface["state"] = "live"): TerminalSurface {
  return {
    surfaceId: formatTerminalSurfaceId({ backend, hostSession: sessionName }),
    backend,
    sessionName,
    paneId: null,
    attachCommand: [backend, "attach", sessionName],
    observeCommand: null,
    relay: { backend, sessionName },
    state,
  };
}

function session(id: string, surfaces: TerminalSurface[]): TerminalSessionRecord {
  return {
    id,
    harness: "claude",
    sourceSessionId: `${id}-source`,
    cwd: "/Users/art/dev/openscout",
    resumeCommand: "claude --resume abc",
    surfaces,
    createdAt: 1,
    updatedAt: 2,
  };
}

function workspace(cells: TerminalWorkspaceCell[]): TerminalWorkspaceRecord {
  return {
    id: "ws-1",
    name: "Release desk",
    purpose: "Watch the train",
    columns: 2,
    cells,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("reconcileTerminalWorkspace", () => {
  test("binds a cell to its live surface by durable handle", () => {
    const live = surface("tmux", "scout-tmux-cell-1");
    const result = reconcileTerminalWorkspace(
      workspace([{ id: "c1", surfaceId: live.surfaceId, intent: { hostId: "tmux", sessionName: "scout-tmux-cell-1" } }]),
      { sessions: [session("ts.1", [live])], hosts: HOSTS },
    );

    expect(result.liveCount).toBe(1);
    expect(result.cells[0]).toMatchObject({
      cellId: "c1",
      status: "live",
      terminalSessionId: "ts.1",
      detail: "Running",
      revive: null,
    });
  });

  test("binds by session name when the handle is stale, which is what stable names are for", () => {
    // The surface was re-created, so the record id moved; the cell's own
    // session name still identifies it.
    const live = surface("tmux", "scout-tmux-cell-1");
    const result = reconcileTerminalWorkspace(
      workspace([{
        id: "c1",
        surfaceId: formatTerminalSurfaceId({ backend: "tmux", hostSession: "some-older-name" }),
        terminalSessionId: "ts.old",
        intent: { hostId: "tmux", sessionName: "scout-tmux-cell-1" },
      }]),
      { sessions: [session("ts.new", [live])], hosts: HOSTS },
    );

    expect(result.cells[0]?.status).toBe("live");
    expect(result.cells[0]?.terminalSessionId).toBe("ts.new");
  });

  test("does not bind a same-named surface on a different host", () => {
    const result = reconcileTerminalWorkspace(
      workspace([{ id: "c1", intent: { hostId: "tmux", sessionName: "shared-name" } }]),
      { sessions: [session("ts.1", [surface("zellij", "shared-name")])], hosts: HOSTS },
    );
    expect(result.cells[0]?.status).toBe("revivable");
  });

  test("an exited surface is not live", () => {
    const dead = surface("zellij", "scout-zj-1", "exited");
    const result = reconcileTerminalWorkspace(
      workspace([{ id: "c1", surfaceId: dead.surfaceId, intent: { hostId: "zellij", sessionName: "scout-zj-1" } }]),
      { sessions: [session("ts.1", [dead])], hosts: HOSTS },
    );
    expect(result.cells[0]?.status).toBe("revivable");
  });

  test("the reboot story: nothing is live, and every cell with intent can be rebuilt", () => {
    const result = reconcileTerminalWorkspace(
      workspace([
        { id: "c1", intent: { hostId: "tmux", sessionName: "scout-tmux-c1", cwd: "/repo", harness: "claude", resumeCommand: "claude --resume abc" } },
        { id: "c2", intent: { hostId: "zellij", sessionName: "scout-zellij-c2", cwd: "/repo" } },
      ]),
      // After a reboot the multiplexers are empty. The hosts are still here.
      { sessions: [], hosts: HOSTS },
    );

    expect(result).toMatchObject({ liveCount: 0, revivableCount: 2, unavailableCount: 0 });
    expect(result.cells[0]).toMatchObject({
      status: "revivable",
      detail: "Not running. Scout can start it again.",
      revive: { hostId: "tmux", sessionName: "scout-tmux-c1", cwd: "/repo", resumeCommand: "claude --resume abc" },
    });
    expect(result.cells[1]?.revive).toEqual({
      hostId: "zellij",
      sessionName: "scout-zellij-c2",
      cwd: "/repo",
      resumeCommand: null,
    });
  });

  test("refuses to invent a plan when the cell was saved without one", () => {
    const result = reconcileTerminalWorkspace(
      workspace([{ id: "c1", intent: {} }, { id: "c2", intent: { hostId: "tmux" } }]),
      { sessions: [], hosts: HOSTS },
    );
    expect(result.unavailableCount).toBe(2);
    for (const cell of result.cells) {
      expect(cell.revive).toBeNull();
      expect(cell.detail).toBe("This tile was saved without enough detail to reopen it.");
    }
  });

  test("says which host is missing rather than silently substituting one", () => {
    const result = reconcileTerminalWorkspace(
      workspace([
        { id: "c1", intent: { hostId: "screen", sessionName: "s1" } },
        { id: "c2", intent: { hostId: "kitty", sessionName: "s2" } },
      ]),
      { sessions: [], hosts: HOSTS },
    );
    expect(result.cells[0]).toMatchObject({
      status: "unavailable",
      detail: "This tile needs screen, which is not installed here.",
    });
    expect(result.cells[1]).toMatchObject({
      status: "unavailable",
      detail: "This tile needs kitty, which Scout does not know about.",
    });
  });

  test("a host Scout must not create sessions on is honest about it", () => {
    const result = reconcileTerminalWorkspace(
      workspace([{ id: "c1", intent: { hostId: "herdr", sessionName: "scout-local-1" } }]),
      { sessions: [], hosts: HOSTS },
    );
    expect(result.cells[0]).toMatchObject({
      status: "unavailable",
      detail: "Scout cannot reopen herdr sessions for you; open it there and come back.",
      revive: null,
    });
  });

  test("falls back to the default host only when the cell named none", () => {
    const result = reconcileTerminalWorkspace(
      workspace([{ id: "c1", intent: { sessionName: "scout-c1" } }]),
      { sessions: [], hosts: HOSTS, defaultHostId: "tmux" },
    );
    expect(result.cells[0]?.revive?.hostId).toBe("tmux");

    const noDefault = reconcileTerminalWorkspace(
      workspace([{ id: "c1", intent: { sessionName: "scout-c1" } }]),
      { sessions: [], hosts: HOSTS },
    );
    expect(noDefault.cells[0]?.status).toBe("unavailable");
  });

  test("counts a mixed workspace exactly once per cell", () => {
    const live = surface("tmux", "scout-live");
    const result = reconcileTerminalWorkspace(
      workspace([
        { id: "c1", surfaceId: live.surfaceId, intent: { hostId: "tmux", sessionName: "scout-live" } },
        { id: "c2", intent: { hostId: "tmux", sessionName: "scout-dead" } },
        { id: "c3", intent: {} },
      ]),
      { sessions: [session("ts.1", [live])], hosts: HOSTS },
    );
    expect(result).toMatchObject({ liveCount: 1, revivableCount: 1, unavailableCount: 1 });
    expect(result.cells).toHaveLength(3);
  });
});

describe("normalizeTerminalWorkspaceColumns", () => {
  test("clamps to a usable range", () => {
    expect(normalizeTerminalWorkspaceColumns(3)).toBe(3);
    expect(normalizeTerminalWorkspaceColumns(0)).toBe(1);
    expect(normalizeTerminalWorkspaceColumns(99)).toBe(TERMINAL_WORKSPACE_MAX_COLUMNS);
    expect(normalizeTerminalWorkspaceColumns("2")).toBe(2);
  });
});

describe("terminalWorkspaceLayoutOf", () => {
  test("prefers a stored layout", () => {
    expect(terminalWorkspaceLayoutOf({ layout: { mode: "lanes", columns: "dynamic" }, columns: 2, cellCount: 5 }))
      .toEqual({ mode: "lanes", columns: "dynamic" });
    expect(terminalWorkspaceLayoutOf({ layout: { mode: "solo" } })).toEqual({ mode: "solo" });
  });

  test("folds a pre-layout record forward from its column count", () => {
    // One tile is solo whatever the stored column count said.
    expect(terminalWorkspaceLayoutOf({ columns: 3, cellCount: 1 })).toEqual({ mode: "solo" });
    // Everything fits on one row: lanes.
    expect(terminalWorkspaceLayoutOf({ columns: 3, cellCount: 3 })).toEqual({ mode: "lanes", columns: 3 });
    // The old "quad" — 2 columns, 4 cells — was a grid.
    expect(terminalWorkspaceLayoutOf({ columns: 2, cellCount: 4 })).toEqual({ mode: "grid", columns: 2 });
    expect(terminalWorkspaceLayoutOf({})).toEqual({ mode: "solo" });
  });

  test("clamps a stored column count that is out of range", () => {
    expect(terminalWorkspaceLayoutOf({ layout: { mode: "grid", columns: 99 } }))
      .toEqual({ mode: "grid", columns: TERMINAL_WORKSPACE_MAX_COLUMNS });
  });
});

describe("resolveTerminalWorkspaceColumns", () => {
  test("solo is always one column", () => {
    expect(resolveTerminalWorkspaceColumns({ mode: "solo" }, { tileCount: 9 })).toBe(1);
    expect(resolveTerminalWorkspaceColumns({ mode: "solo", columns: 4 }, { tileCount: 9 })).toBe(1);
  });

  test("a pinned column count is used as written", () => {
    expect(resolveTerminalWorkspaceColumns({ mode: "lanes", columns: 3 }, { tileCount: 9 })).toBe(3);
    expect(resolveTerminalWorkspaceColumns({ mode: "grid", columns: 2 }, { tileCount: 9 })).toBe(2);
  });

  test("dynamic lanes give every tile its own lane, up to the readable limit", () => {
    expect(resolveTerminalWorkspaceColumns({ mode: "lanes", columns: "dynamic" }, { tileCount: 1 })).toBe(1);
    expect(resolveTerminalWorkspaceColumns({ mode: "lanes", columns: "dynamic" }, { tileCount: 3 })).toBe(3);
    expect(resolveTerminalWorkspaceColumns({ mode: "lanes", columns: "dynamic" }, { tileCount: 20 }))
      .toBe(TERMINAL_WORKSPACE_MAX_COLUMNS);
  });

  test("a dynamic grid is the squarest arrangement that holds the tiles", () => {
    expect(resolveTerminalWorkspaceColumns({ mode: "grid", columns: "dynamic" }, { tileCount: 4 })).toBe(2);
    expect(resolveTerminalWorkspaceColumns({ mode: "grid", columns: "dynamic" }, { tileCount: 9 })).toBe(3);
    expect(resolveTerminalWorkspaceColumns({ mode: "grid", columns: "dynamic" }, { tileCount: 5 })).toBe(3);
    expect(resolveTerminalWorkspaceColumns({ mode: "grid" }, { tileCount: 4 })).toBe(2);
  });

  test("an empty workspace still renders one column rather than zero", () => {
    expect(resolveTerminalWorkspaceColumns({ mode: "grid", columns: "dynamic" }, { tileCount: 0 })).toBe(1);
  });
});

describe("terminalWorkspaceLayoutLabel", () => {
  test("says the shape and the column rule in product language", () => {
    expect(terminalWorkspaceLayoutLabel({ mode: "solo" })).toBe("Solo");
    expect(terminalWorkspaceLayoutLabel({ mode: "lanes", columns: "dynamic" })).toBe("Lanes · dynamic");
    expect(terminalWorkspaceLayoutLabel({ mode: "grid", columns: 1 })).toBe("Grid · 1 column");
    expect(terminalWorkspaceLayoutLabel({ mode: "grid", columns: 3 })).toBe("Grid · 3 columns");
  });
});
