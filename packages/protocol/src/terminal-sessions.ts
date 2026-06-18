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

export type TerminalBackend = "tmux" | "zellij";

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
