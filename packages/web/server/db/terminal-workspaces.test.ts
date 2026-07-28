import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const roots = new Set<string>();

// Import after the control home is redirected, so the module's lazy handles
// resolve to a throwaway database and never touch a real control plane.
let mod: typeof import("./terminal-workspaces.ts");
let closeSharedDb: () => void;

beforeEach(async () => {
  const root = mkdtempSync(join(tmpdir(), "openscout-terminal-workspaces-"));
  roots.add(root);
  process.env.OPENSCOUT_CONTROL_HOME = root;
  ({ closeDb: closeSharedDb } = await import("./internal/db.ts"));
  // The readonly handle is cached per process; drop it so it reopens against
  // this test's throwaway control home.
  closeSharedDb();
  mod = await import(`./terminal-workspaces.ts?home=${encodeURIComponent(root)}`);
});

afterEach(() => {
  mod?.closeTerminalWorkspaceDb();
  closeSharedDb?.();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
  if (originalControlHome === undefined) delete process.env.OPENSCOUT_CONTROL_HOME;
  else process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
});

describe("terminal workspace store", () => {
  test("an install that never authored a workspace reads empty, not an error", () => {
    expect(mod.queryTerminalWorkspaces()).toEqual([]);
    expect(mod.queryTerminalWorkspace("tw.missing")).toBeNull();
  });

  test("round-trips a workspace with the intent each cell needs to be rebuilt", () => {
    const created = mod.upsertTerminalWorkspace({
      name: "Release desk",
      purpose: "Watch the train",
      columns: 3,
      cells: [{
        id: "cell-1",
        surfaceId: "srf1.abc",
        terminalSessionId: "ts.1",
        intent: {
          hostId: "tmux",
          sessionName: "scout-tmux-cell-1",
          cwd: "/repo",
          harness: "claude",
          resumeCommand: "claude --resume abc",
        },
      }],
    });

    expect(created.id).toMatch(/^tw\./);
    expect(created.columns).toBe(3);
    expect(created.cells[0]?.intent.resumeCommand).toBe("claude --resume abc");
    expect(mod.queryTerminalWorkspace(created.id)).toEqual(created);
    expect(mod.queryTerminalWorkspaces()).toEqual([created]);
  });

  test("updating keeps identity and creation time", () => {
    const first = mod.upsertTerminalWorkspace({ name: "Desk" });
    const second = mod.upsertTerminalWorkspace({ id: first.id, name: "Desk renamed", columns: 1 });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(mod.queryTerminalWorkspaces()).toHaveLength(1);
  });

  test("clamps an out-of-range column count", () => {
    expect(mod.upsertTerminalWorkspace({ name: "Wide", columns: 99 }).columns).toBe(6);
    expect(mod.upsertTerminalWorkspace({ name: "Thin", columns: 0 }).columns).toBe(1);
  });

  test("delete reports whether anything was removed", () => {
    const record = mod.upsertTerminalWorkspace({ name: "Desk" });
    expect(mod.deleteTerminalWorkspace(record.id)).toBe(true);
    expect(mod.deleteTerminalWorkspace(record.id)).toBe(false);
    expect(mod.queryTerminalWorkspace(record.id)).toBeNull();
  });
});
