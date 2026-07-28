/**
 * Terminal session registry.
 *
 * The durable noun is a HARNESS SESSION — a stable agent session identified by
 * its harness-native source id and resumable via a resume command. A harness
 * session is *materialized* through one or more disposable TERMINAL SURFACES
 * (tmux, zellij, future ssh/host-control). Backends are interchangeable: the
 * source session id is the stable key; the surface is the throwaway shell.
 *
 * This module defines the shared contract used by `scout session intake`
 * (which writes the record), the runtime store (which persists it), the
 * web/runtime APIs (which list it + materialize surfaces), and the app
 * terminal UI (which reads it to attach/observe/take over).
 *
 * Terminal scrollback is never imported as Scout messages — a surface is a
 * relay target, not a message source.
 */

import { formatTerminalSurfaceId, parseTerminalSurfaceId } from "./terminal-surface-id.js";
import type { TerminalBackend, TerminalSurfaceId } from "./terminal-surface-id.js";

/** Lifecycle of a single materialized surface. */
export type TerminalSurfaceState = "live" | "detached" | "exited";

/** Backend-neutral relay descriptor for one surface. */
export type TerminalSurfaceRelay = {
  backend: TerminalBackend;
  sessionName: string;
  tmuxSession?: string;
  zellijSession?: string;
  zellijPaneId?: string;
};

/** One disposable terminal surface a harness session has been materialized through. */
export type TerminalSurface = {
  /**
   * Opaque durable handle for this surface. Absent on records written before
   * surface ids existed; derive one with `terminalSurfaceIdForSurface`.
   */
  surfaceId?: TerminalSurfaceId;
  backend: TerminalBackend;
  /** Backend session name (e.g. tmux target, zellij session). Secondary metadata. */
  sessionName: string;
  paneId: string | null;
  attachCommand: string[];
  observeCommand: string[] | null;
  relay: TerminalSurfaceRelay;
  /** Lifecycle state; absent means unknown / not yet observed. */
  state?: TerminalSurfaceState;
  /**
   * Zellij requires a short socket dir on macOS (the default $TMPDIR exceeds the
   * Unix socket-path length limit). Any relay attaching to a Scout-created zellij
   * surface must preserve this, or it lands in a different server namespace.
   */
  socketDir?: string;
};

/**
 * Durable registry record: a stable harness session plus the disposable
 * terminal surfaces it owns. Re-materializing in another backend appends a
 * surface; it never changes the record identity.
 */
export type TerminalSessionRecord = {
  /** Stable Scout record id (derived from harness + sourceSessionId by default). */
  id: string;
  harness: string;
  /** Harness-native session id — the stable identity across backends. */
  sourceSessionId: string;
  cwd: string;
  resumeCommand: string;
  /**
   * Where the record came from. `registry` records are Scout-owned harness
   * sessions with a real harness and resume command; `discovered` records are
   * live multiplexer sessions observed on the host, for which both are unknown
   * and must be left empty rather than filled with the backend and attach argv.
   * Absent means `registry`.
   */
  origin?: "registry" | "discovered";
  surfaces: TerminalSurface[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
};

/** Upsert input for a registry record. Timestamps + id are assigned by the store. */
export type TerminalSessionRecordInput = {
  /** Optional explicit id; defaults to a deterministic id from harness + sourceSessionId. */
  id?: string;
  harness: string;
  sourceSessionId: string;
  cwd: string;
  resumeCommand: string;
  surfaces?: TerminalSurface[];
  metadata?: Record<string, unknown>;
};

/**
 * The durable handle for a surface. Prefers the stored id and derives the same
 * value from the surface's address otherwise, so a record written before
 * surface ids existed resolves to the id it would be issued today.
 */
export function terminalSurfaceIdForSurface(
  surface: Pick<TerminalSurface, "surfaceId" | "backend" | "sessionName" | "paneId">,
  options: { nodeId?: string | null } = {},
): TerminalSurfaceId {
  if (surface.surfaceId) return surface.surfaceId;
  return formatTerminalSurfaceId({
    backend: surface.backend,
    hostSession: surface.sessionName,
    paneId: surface.paneId,
    nodeId: options.nodeId ?? null,
  });
}

/** True when a handle addresses this surface, in either the opaque or legacy form. */
export function terminalSurfaceMatchesId(
  surface: Pick<TerminalSurface, "surfaceId" | "backend" | "sessionName" | "paneId">,
  handle: string | null | undefined,
): boolean {
  const address = parseTerminalSurfaceId(handle);
  if (!address) return false;
  if (address.backend !== surface.backend || address.hostSession !== surface.sessionName) return false;
  // A legacy key carries no pane, so it matches any pane on the session; an
  // opaque id that names a pane must match it exactly.
  return address.paneId === null || address.paneId === (surface.paneId ?? null);
}
