/**
 * Durable terminal workspaces.
 *
 * A workspace is a named, server-owned arrangement of agent-CLI tiles. It is
 * the Scout object the three clients had each invented privately —
 * `openscout.terminal.workspaces.v1` in localStorage,
 * `scout.terminals.workspaces.v1` in UserDefaults, and nothing at all on iOS —
 * with the same version number, the same idea, and no synchronization.
 *
 * The load-bearing design decision is that a cell stores INTENT, not just a
 * binding. A saved cell that only remembers "tmux session scout-tmux-cell-7"
 * is worth nothing after a reboot: tmux is empty and the name resolves to
 * nothing. A cell that also remembers which host to use, what directory, and
 * how to resume the harness can be rebuilt. This is the same conclusion
 * tmux-resurrect/continuum reached — persist intent and replay it, never
 * process state — and what macOS's `restoreCommandLine` already does in a
 * cruder form.
 */

import { terminalSurfaceMatchesId } from "./terminal-sessions.js";
import type { TerminalSessionRecord, TerminalSurface } from "./terminal-sessions.js";
import type { TerminalHostId, TerminalSurfaceId } from "./terminal-surface-id.js";

/**
 * Everything needed to re-materialize a cell when nothing live matches it.
 * Every field is optional because a workspace authored before a given field
 * existed must still resolve; what a cell cannot say, reconciliation refuses to
 * invent.
 */
export type TerminalWorkspaceCellIntent = {
  /** Host to materialize on. Absent means "whatever the operator's default is". */
  hostId?: TerminalHostId | null;
  /** Durable per-cell host session name. This is what makes a tile reattach. */
  sessionName?: string | null;
  /** Working directory to open in. */
  cwd?: string | null;
  /** Harness to resume, when the cell is an agent rather than a shell. */
  harness?: string | null;
  /** Harness-native resume command, e.g. `claude --resume <id>`. */
  resumeCommand?: string | null;
};

export type TerminalWorkspaceCell = {
  /** Stable cell id. Minted once, at authoring; never derived from a name. */
  id: string;
  /** Durable handle for the surface this cell last bound to. */
  surfaceId?: TerminalSurfaceId | null;
  /** Registry record that surface belonged to, when it had one. */
  terminalSessionId?: string | null;
  intent: TerminalWorkspaceCellIntent;
};

export type TerminalWorkspaceRecord = {
  id: string;
  name: string;
  purpose: string;
  columns: number;
  cells: TerminalWorkspaceCell[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
};

export type TerminalWorkspaceRecordInput = {
  id?: string;
  name: string;
  purpose?: string;
  columns?: number;
  cells?: TerminalWorkspaceCell[];
  metadata?: Record<string, unknown>;
};

/** Highest column count a workspace may reopen with. */
export const TERMINAL_WORKSPACE_MAX_COLUMNS = 6;
export const TERMINAL_WORKSPACE_DEFAULT_COLUMNS = 2;

export type TerminalWorkspaceCellStatus = "live" | "revivable" | "unavailable";

/** What reconciliation needs to know about a host, with no host access. */
export type TerminalWorkspaceHostState = {
  id: TerminalHostId;
  installed: boolean;
  /** Whether Scout can materialize a session on this host headlessly. */
  canCreate: boolean;
};

export type TerminalWorkspaceRevivePlan = {
  hostId: TerminalHostId;
  sessionName: string;
  cwd: string | null;
  /** Harness resume command to run inside the revived surface, when known. */
  resumeCommand: string | null;
};

export type TerminalWorkspaceCellResolution = {
  cellId: string;
  status: TerminalWorkspaceCellStatus;
  surfaceId: TerminalSurfaceId | null;
  terminalSessionId: string | null;
  surface: TerminalSurface | null;
  /** Operator-facing reason, in product language. */
  detail: string;
  /** Present exactly when the status is `revivable`. */
  revive: TerminalWorkspaceRevivePlan | null;
};

export type TerminalWorkspaceResolution = {
  workspaceId: string;
  cells: TerminalWorkspaceCellResolution[];
  liveCount: number;
  revivableCount: number;
  unavailableCount: number;
};

/**
 * Map every saved cell to a live surface, a restorable-but-dead one, or an
 * unavailable one.
 *
 * This is the only honest answer to a reboot. tmux and zellij sessions do not
 * survive a restart; a workspace that stored intent can rebuild itself, and one
 * that stored only a session name cannot. Judgement lives here, on the server
 * side of the wire, so all three clients inherit the same answer instead of
 * each re-deriving it — and it never fabricates a record: a cell with nothing
 * to rebuild from reports `unavailable` and says why.
 */
export function reconcileTerminalWorkspace(
  workspace: TerminalWorkspaceRecord,
  input: {
    sessions: readonly TerminalSessionRecord[];
    hosts: readonly TerminalWorkspaceHostState[];
    /** Host used when a cell's intent names none. */
    defaultHostId?: TerminalHostId | null;
  },
): TerminalWorkspaceResolution {
  const cells = workspace.cells.map((cell) => resolveTerminalWorkspaceCell(cell, input));
  return {
    workspaceId: workspace.id,
    cells,
    liveCount: cells.filter((cell) => cell.status === "live").length,
    revivableCount: cells.filter((cell) => cell.status === "revivable").length,
    unavailableCount: cells.filter((cell) => cell.status === "unavailable").length,
  };
}

function resolveTerminalWorkspaceCell(
  cell: TerminalWorkspaceCell,
  input: {
    sessions: readonly TerminalSessionRecord[];
    hosts: readonly TerminalWorkspaceHostState[];
    defaultHostId?: TerminalHostId | null;
  },
): TerminalWorkspaceCellResolution {
  const live = findLiveSurface(cell, input.sessions);
  if (live) {
    return {
      cellId: cell.id,
      status: "live",
      surfaceId: live.surface.surfaceId ?? cell.surfaceId ?? null,
      terminalSessionId: live.session.id,
      surface: live.surface,
      detail: "Running",
      revive: null,
    };
  }

  const hostId = cell.intent.hostId ?? input.defaultHostId ?? null;
  const sessionName = cell.intent.sessionName?.trim() || null;
  if (!hostId || !sessionName) {
    return unavailable(cell, "This tile was saved without enough detail to reopen it.");
  }

  const host = input.hosts.find((candidate) => candidate.id === hostId) ?? null;
  if (!host) {
    return unavailable(cell, `This tile needs ${hostId}, which Scout does not know about.`);
  }
  if (!host.installed) {
    return unavailable(cell, `This tile needs ${hostId}, which is not installed here.`);
  }
  if (!host.canCreate) {
    return unavailable(cell, `Scout cannot reopen ${hostId} sessions for you; open it there and come back.`);
  }

  return {
    cellId: cell.id,
    status: "revivable",
    surfaceId: cell.surfaceId ?? null,
    terminalSessionId: cell.terminalSessionId ?? null,
    surface: null,
    detail: "Not running. Scout can start it again.",
    revive: {
      hostId,
      sessionName,
      cwd: cell.intent.cwd?.trim() || null,
      resumeCommand: cell.intent.resumeCommand?.trim() || null,
    },
  };
}

function unavailable(
  cell: TerminalWorkspaceCell,
  detail: string,
): TerminalWorkspaceCellResolution {
  return {
    cellId: cell.id,
    status: "unavailable",
    surfaceId: cell.surfaceId ?? null,
    terminalSessionId: cell.terminalSessionId ?? null,
    surface: null,
    detail,
    revive: null,
  };
}

/**
 * A cell binds to a live surface by durable handle first. The intent's session
 * name is the fallback, because a surface re-created under the same name on the
 * same host IS the tile's session — that is the whole point of stable per-cell
 * names — while a record id is not enough on its own, since ids move when a
 * discovered session is renamed.
 */
function findLiveSurface(
  cell: TerminalWorkspaceCell,
  sessions: readonly TerminalSessionRecord[],
): { session: TerminalSessionRecord; surface: TerminalSurface } | null {
  const handle = cell.surfaceId?.trim() || null;
  if (handle) {
    for (const session of sessions) {
      const surface = session.surfaces.find((candidate) => terminalSurfaceMatchesId(candidate, handle));
      if (surface && surface.state !== "exited") return { session, surface };
    }
  }

  const sessionName = cell.intent.sessionName?.trim() || null;
  const hostId = cell.intent.hostId ?? null;
  if (!sessionName) return null;
  for (const session of sessions) {
    const surface = session.surfaces.find((candidate) =>
      candidate.sessionName === sessionName
      && (!hostId || candidate.backend === hostId)
      && candidate.state !== "exited"
    );
    if (surface) return { session, surface };
  }
  return null;
}

export function normalizeTerminalWorkspaceColumns(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return TERMINAL_WORKSPACE_DEFAULT_COLUMNS;
  return Math.max(1, Math.min(TERMINAL_WORKSPACE_MAX_COLUMNS, Math.floor(value)));
}
