import {
  normalizeTerminalWorkspaceDeck,
  type TerminalWorkspaceDeck,
  type TerminalWorkspaceLayout,
} from "../../lib/terminal-workspace.ts";
import type { Route } from "../../lib/types.ts";

type TerminalRoute = Extract<Route, { view: "terminal" }>;
export type TerminalCellBackend = NonNullable<TerminalRoute["terminalBackend"]>;
export type TerminalCellAgent = NonNullable<TerminalRoute["terminalAgent"]>;

/**
 * One authored slot in a workspace. `id` is minted once, when the cell is
 * created, and then persisted: it is what makes a slot the same slot across
 * reloads, so the terminal session it opens can be reattached instead of
 * replaced. Never derive it from a display name or from a timestamp read at
 * entry time.
 */
export type TerminalWorkspaceCellDefinition =
  | { id: string; kind: "fresh"; backend: TerminalCellBackend; agent: TerminalCellAgent }
  | { id: string; kind: "registered"; terminalSessionId: string; terminalSurfaceKey: string };

export type TerminalWorkspaceDefinition = TerminalWorkspaceLayout<TerminalWorkspaceCellDefinition>;
export type TerminalWorkspaceDeckState = TerminalWorkspaceDeck<TerminalWorkspaceCellDefinition>;

export const TERMINAL_WORKSPACES_STORAGE_KEY = "openscout.terminal.workspaces.v1";
export const TERMINAL_WORKSPACES_STORAGE_VERSION = 2;
export const TERMINAL_WORKSPACE_VIEW_STORAGE_KEY = "openscout.terminal.workspace-view.v1";
export const TERMINAL_DEFAULT_GRID_COLUMNS = 2;

export function createTerminalDeckId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/**
 * Multiplexer session name for a cell. Derived from the cell's persisted id, so
 * re-entering a workspace reattaches to the session that cell opened last time.
 * Minting a name at entry (as this screen used to) abandons a live session on
 * every reload, which is why web tiles were not durable at all.
 *
 * The result must satisfy the relay's session-name validator
 * (`/^[A-Za-z0-9_][A-Za-z0-9_-]*$/`) before it reaches a CLI.
 */
export function terminalCellSessionName(backend: TerminalCellBackend, cellId: string): string {
  const suffix = cellId.replace(/[^A-Za-z0-9_-]+/gu, "-").replace(/^[^A-Za-z0-9_]+/u, "");
  return `scout-${backend}-${suffix || "cell"}`;
}

export function createFreshTerminalCell(
  backend: TerminalCellBackend,
  agent: TerminalCellAgent = "shell",
): TerminalWorkspaceCellDefinition {
  return { id: createTerminalDeckId("cell"), kind: "fresh", backend, agent };
}

export function isTerminalWorkspaceCell(value: unknown): value is TerminalWorkspaceCellDefinition {
  if (!value || typeof value !== "object") return false;
  const cell = value as Partial<TerminalWorkspaceCellDefinition>;
  if (typeof cell.id !== "string" || !cell.id.trim()) return false;
  if (cell.kind === "fresh") return typeof cell.backend === "string" && typeof cell.agent === "string";
  if (cell.kind === "registered") {
    return typeof cell.terminalSessionId === "string" && typeof cell.terminalSurfaceKey === "string";
  }
  return false;
}

/**
 * Restore the workspace deck from storage, folding forward the v1 shape: a bare
 * array of definitions whose cells carried no ids. Legacy cells are keyed by
 * workspace + slot, which is the identity macOS already gives its tiles, so an
 * upgraded workspace keeps reattaching to the sessions its slots opened.
 */
export function restoreTerminalWorkspaceDeck(stored: unknown): TerminalWorkspaceDeckState {
  if (!Array.isArray(stored)) {
    return normalizeTerminalWorkspaceDeck(stored, isTerminalWorkspaceCell, { allowEmpty: true });
  }
  const workspaces = stored.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const legacy = entry as {
      id?: unknown;
      name?: unknown;
      purpose?: unknown;
      columns?: unknown;
      cells?: unknown;
      updatedAt?: unknown;
    };
    if (typeof legacy.id !== "string" || !legacy.id.trim()) return [];
    const cells = Array.isArray(legacy.cells) ? legacy.cells : [];
    return [{
      id: legacy.id,
      name: typeof legacy.name === "string" && legacy.name.trim() ? legacy.name : legacy.id,
      purpose: legacy.purpose,
      columns: legacy.columns,
      updatedAt: legacy.updatedAt,
      tiles: cells.map((cell, index) => ({
        ...(cell as Record<string, unknown>),
        id: `${legacy.id}-${index}`,
      })),
    }];
  });
  return normalizeTerminalWorkspaceDeck(
    { version: 1, activeWorkspaceId: workspaces[0]?.id ?? "", workspaces },
    isTerminalWorkspaceCell,
    { allowEmpty: true },
  );
}
