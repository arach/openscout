// Adapter interface — the contract any backend must implement to work with
// Pairing.  An adapter wraps one agent (Claude Code, Codex, Gemini, a browser
// extension, etc.) and translates its native events into Pairing primitives.
//
// The bridge instantiates adapters and wires their events to the encrypted
// pipe.  The adapter never touches networking, encryption, or the phone —
// it only speaks primitives.

import type {
  PairingEvent,
  Prompt,
  QuestionAnswer,
  Session,
  SessionStatus,
} from "./primitives";

// ---------------------------------------------------------------------------
// Adapter configuration — passed by the bridge when instantiating
// ---------------------------------------------------------------------------

export interface AdapterConfig {
  /** Unique session ID assigned by the bridge. */
  sessionId: string;
  /** Human-readable session name. */
  name?: string;
  /** Working directory for the agent. */
  cwd?: string;
  /** Environment variables for the agent process. */
  env?: Record<string, string>;
  /** Adapter-specific options (model, endpoint, flags, etc.). */
  options?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface Adapter {
  /** Adapter type identifier (e.g. "claude-code", "ollama", "chatgpt-web"). */
  readonly type: string;

  /** Current session snapshot. */
  readonly session: Session;

  /**
   * Start the adapter — connect to the agent, spawn the process, etc.
   * The adapter should emit a session:update event when ready.
   */
  start(): Promise<void>;

  /**
   * Send a user prompt to the agent.  The adapter translates this into
   * whatever the native backend expects and begins emitting turn/block
   * deltas as the response streams in.
   */
  send(prompt: Prompt): void;

  /**
   * Route an answer for a QuestionBlock back to the underlying agent.
   * Adapters that do not support interactive questions can omit this.
   */
  answerQuestion?(answer: QuestionAnswer): void;

  /**
   * Interrupt the current turn (user hit Stop).
   */
  interrupt(): void;

  /**
   * Shut down the adapter — kill the process, close connections, clean up.
   * Called when the session is removed or the bridge is shutting down.
   */
  shutdown(): Promise<void>;

  /**
   * Relay an approval decision to the underlying agent.
   * Called by the bridge after version validation passes.
   * Adapters that don't support approvals can ignore this (optional).
   */
  decide?(turnId: string, blockId: string, decision: "approve" | "deny", reason?: string): void;

  // -- Event emitter surface ------------------------------------------------

  on(event: "event", listener: (e: PairingEvent) => void): void;
  on(event: "error", listener: (e: Error) => void): void;

  off(event: "event", listener: (e: PairingEvent) => void): void;
  off(event: "error", listener: (e: Error) => void): void;
}

// ---------------------------------------------------------------------------
// Adapter factory — how the bridge discovers and instantiates adapters
// ---------------------------------------------------------------------------

/**
 * Each adapter ships as a factory function.  The bridge calls it with config,
 * gets back an Adapter instance.  Adapter authors export this from their
 * package.
 *
 * Example:
 *   export const createAdapter: AdapterFactory = (config) => new ClaudeCodeAdapter(config);
 */
export type AdapterFactory = (config: AdapterConfig) => Adapter;

// ---------------------------------------------------------------------------
// BaseAdapter — optional helper that wires up the EventEmitter boilerplate
// ---------------------------------------------------------------------------

export abstract class BaseAdapter implements Adapter {
  abstract readonly type: string;

  readonly session: Session;

  private eventListeners = new Set<(e: PairingEvent) => void>();
  private errorListeners = new Set<(e: Error) => void>();

  constructor(protected config: AdapterConfig) {
    this.session = {
      id: config.sessionId,
      name: config.name ?? config.sessionId,
      adapterType: "",   // subclass overrides via `type`
      status: "connecting",
      cwd: config.cwd,
    };
  }

  abstract start(): Promise<void>;
  abstract send(prompt: Prompt): void;
  abstract interrupt(): void;
  abstract shutdown(): Promise<void>;

  on(event: "event", listener: (e: PairingEvent) => void): void;
  on(event: "error", listener: (e: Error) => void): void;
  on(event: string, listener: (...args: any[]) => void): void {
    if (event === "event") this.eventListeners.add(listener);
    else if (event === "error") this.errorListeners.add(listener);
  }

  off(event: "event", listener: (e: PairingEvent) => void): void;
  off(event: "error", listener: (e: Error) => void): void;
  off(event: string, listener: (...args: any[]) => void): void {
    if (event === "event") this.eventListeners.delete(listener);
    else if (event === "error") this.errorListeners.delete(listener);
  }

  /** Emit a Pairing event. */
  protected emit(event: "event", payload: PairingEvent): void;
  protected emit(event: "error", payload: Error): void;
  protected emit(event: string, payload: any): void {
    if (event === "event") {
      for (const fn of this.eventListeners) fn(payload);
    } else if (event === "error") {
      for (const fn of this.errorListeners) fn(payload);
    }
  }

  /** Convenience: update session status and emit the event. */
  protected setStatus(status: SessionStatus): void {
    (this.session as { status: SessionStatus }).status = status;
    (this.session as { adapterType: string }).adapterType = this.type;
    this.emit("event", { event: "session:update", session: { ...this.session } });
  }
}
