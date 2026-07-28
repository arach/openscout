import { describe, expect, test } from "bun:test";

import {
  createFreshTerminalCell,
  isTerminalWorkspaceCell,
  restoreTerminalWorkspaceDeck,
  terminalCellSessionName,
  terminalWorkspaceLayoutFromRecord,
  terminalWorkspaceRecordInputFromLayout,
} from "./workspace-deck.ts";

/** The relay rejects anything else before it reaches a multiplexer CLI. */
const RELAY_SESSION_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/u;

describe("terminalCellSessionName", () => {
  test("is stable for a cell id and safe for the relay validator", () => {
    const name = terminalCellSessionName("tmux", "cell-mabc123-1a2b3c4d");
    expect(name).toBe("scout-tmux-cell-mabc123-1a2b3c4d");
    expect(name).toBe(terminalCellSessionName("tmux", "cell-mabc123-1a2b3c4d"));
    expect(name).toMatch(RELAY_SESSION_NAME);
  });

  test("separates backends so replacing a tile does not squat the old name", () => {
    expect(terminalCellSessionName("zellij", "cell-1")).not.toBe(terminalCellSessionName("tmux", "cell-1"));
  });

  test("scrubs characters a multiplexer target cannot carry", () => {
    expect(terminalCellSessionName("tmux", "weird:id with spaces")).toBe("scout-tmux-weird-id-with-spaces");
    expect(terminalCellSessionName("tmux", "weird:id with spaces")).toMatch(RELAY_SESSION_NAME);
    expect(terminalCellSessionName("tmux", "-leading")).toBe("scout-tmux-leading");
    expect(terminalCellSessionName("tmux", "::::")).toBe("scout-tmux-cell");
  });
});

describe("createFreshTerminalCell", () => {
  test("mints an id once so the cell keeps its session across entries", () => {
    const first = createFreshTerminalCell("tmux");
    const second = createFreshTerminalCell("tmux");
    expect(first.id).not.toBe(second.id);
    expect(isTerminalWorkspaceCell(first)).toBe(true);
  });
});

describe("isTerminalWorkspaceCell", () => {
  test("rejects cells with no durable id", () => {
    expect(isTerminalWorkspaceCell({ kind: "fresh", backend: "pty", agent: "shell" })).toBe(false);
    expect(isTerminalWorkspaceCell({ id: "  ", kind: "fresh", backend: "pty", agent: "shell" })).toBe(false);
    expect(isTerminalWorkspaceCell({ id: "c1", kind: "fresh", backend: "pty", agent: "shell" })).toBe(true);
    expect(isTerminalWorkspaceCell({ id: "c1", kind: "registered", terminalSessionId: "s", terminalSurfaceKey: "tmux:a" })).toBe(true);
    expect(isTerminalWorkspaceCell({ id: "c1", kind: "unknown" })).toBe(false);
    expect(isTerminalWorkspaceCell(null)).toBe(false);
  });
});

describe("restoreTerminalWorkspaceDeck", () => {
  test("folds the v1 array forward and keys legacy cells by workspace slot", () => {
    const deck = restoreTerminalWorkspaceDeck([
      {
        id: "workspace-a",
        name: "Release desk",
        purpose: "Watch the train",
        columns: 3,
        updatedAt: 7,
        cells: [
          { kind: "fresh", backend: "tmux", agent: "shell" },
          { kind: "registered", terminalSessionId: "ts.1", terminalSurfaceKey: "tmux:relay-main" },
        ],
      },
    ]);

    expect(deck).toEqual({
      version: 1,
      activeWorkspaceId: "workspace-a",
      workspaces: [{
        id: "workspace-a",
        name: "Release desk",
        purpose: "Watch the train",
        columns: 3,
        updatedAt: 7,
        tiles: [
          { id: "workspace-a-0", kind: "fresh", backend: "tmux", agent: "shell" },
          { id: "workspace-a-1", kind: "registered", terminalSessionId: "ts.1", terminalSurfaceKey: "tmux:relay-main" },
        ],
      }],
    });
  });

  test("is idempotent, so an upgraded workspace keeps its session names", () => {
    const legacy = [{ id: "w", name: "W", columns: 2, cells: [{ kind: "fresh", backend: "tmux", agent: "shell" }] }];
    const once = restoreTerminalWorkspaceDeck(legacy);
    expect(restoreTerminalWorkspaceDeck(once)).toEqual(once);
    expect(terminalCellSessionName("tmux", once.workspaces[0]!.tiles[0]!.id)).toBe("scout-tmux-w-0");
  });

  test("keeps a fresh install empty instead of inventing a workspace", () => {
    expect(restoreTerminalWorkspaceDeck(undefined).workspaces).toEqual([]);
    expect(restoreTerminalWorkspaceDeck([]).workspaces).toEqual([]);
    expect(restoreTerminalWorkspaceDeck([{ name: "no id" }]).workspaces).toEqual([]);
  });
});

describe("server workspace projections", () => {
  test("a fresh cell round-trips through the record with the intent needed to rebuild it", () => {
    const layout = {
      id: "tw.1",
      name: "Release desk",
      purpose: "Watch the train",
      columns: 3,
      updatedAt: 7,
      tiles: [
        { id: "cell-1", kind: "fresh" as const, backend: "tmux" as const, agent: "shell" as const },
        { id: "cell-2", kind: "fresh" as const, backend: "pty" as const, agent: "shell" as const },
      ],
    };

    const input = terminalWorkspaceRecordInputFromLayout(layout);
    expect(input.cells?.[0]?.intent).toEqual({ hostId: "tmux", sessionName: "scout-tmux-cell-1" });
    // A disposable shell has nothing to reattach to; promising a revive would
    // be a lie.
    expect(input.cells?.[1]?.intent).toEqual({ hostId: "pty", sessionName: null });

    const record = {
      id: input.id,
      name: input.name,
      purpose: input.purpose ?? "",
      columns: input.columns ?? 2,
      cells: input.cells ?? [],
      createdAt: 1,
      updatedAt: 7,
    };
    expect(terminalWorkspaceLayoutFromRecord(record)).toEqual(layout);
  });

  test("a registered cell keeps its surface handle across the round trip", () => {
    const layout = {
      id: "tw.2",
      name: "Desk",
      columns: 2,
      updatedAt: 3,
      tiles: [{
        id: "cell-1",
        kind: "registered" as const,
        terminalSessionId: "ts.1",
        terminalSurfaceKey: "srf1.abc",
      }],
    };
    const input = terminalWorkspaceRecordInputFromLayout(layout);
    expect(input.cells?.[0]).toEqual({
      id: "cell-1",
      surfaceId: "srf1.abc",
      terminalSessionId: "ts.1",
      intent: {},
    });
    expect(terminalWorkspaceLayoutFromRecord({
      id: input.id,
      name: input.name,
      purpose: "",
      columns: 2,
      cells: input.cells ?? [],
      createdAt: 1,
      updatedAt: 3,
    })).toEqual(layout);
  });

  test("a record naming a host this client cannot render falls back to a shell tile", () => {
    const layout = terminalWorkspaceLayoutFromRecord({
      id: "tw.3",
      name: "Desk",
      purpose: "",
      columns: 2,
      cells: [{ id: "cell-1", intent: { hostId: "herdr", sessionName: "scout-local-1" } }],
      createdAt: 1,
      updatedAt: 2,
    });
    expect(layout.tiles[0]).toEqual({ id: "cell-1", kind: "fresh", backend: "pty", agent: "shell" });
  });
});
