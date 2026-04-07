// Bridge — the local orchestrator.
//
// Runs on the user's machine.  Manages adapter instances (one per session),
// collects their Pairing events, and exposes a single WebSocket endpoint for
// the relay (or a direct phone connection) to consume.
//
// The bridge never touches API keys or provider credentials directly — those
// live inside the adapters, which run as local code on the same machine.

import type {
  Adapter,
  AdapterConfig,
  AdapterFactory,
  PairingEvent,
  Prompt,
  Session,
} from "../protocol/index.ts";
import { OutboundBuffer, type SequencedEvent } from "./buffer.ts";
import { StateTracker } from "./state.ts";
import type { SessionState, SessionSummary } from "./state.ts";
import { log } from "./log.ts";

// ---------------------------------------------------------------------------
// Bridge configuration
// ---------------------------------------------------------------------------

export interface BridgeConfig {
  /** Port for the local WebSocket listener. */
  port?: number;
  /** Registered adapter factories, keyed by adapter type. */
  adapters: Record<string, AdapterFactory>;
  /** Max events in the outbound ring buffer (default 500). */
  bufferCapacity?: number;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export class Bridge {
  private sessions = new Map<string, Adapter>();
  private adapterFactories: Record<string, AdapterFactory>;
  private listeners = new Set<(event: SequencedEvent) => void>();
  private buffer: OutboundBuffer;
  private stateTracker = new StateTracker();

  constructor(private config: BridgeConfig) {
    this.adapterFactories = config.adapters;
    this.buffer = new OutboundBuffer(config.bufferCapacity);
  }

  // -- Session management ---------------------------------------------------

  /** Create a new session with the given adapter type. */
  async createSession(
    adapterType: string,
    options?: Partial<AdapterConfig>,
  ): Promise<Session> {
    const factory = this.adapterFactories[adapterType];
    if (!factory) {
      throw new Error(`Unknown adapter type: "${adapterType}". Registered: ${Object.keys(this.adapterFactories).join(", ")}`);
    }

    const sessionId = options?.sessionId ?? crypto.randomUUID();
    const config: AdapterConfig = {
      sessionId,
      name: options?.name ?? `${adapterType} session`,
      cwd: options?.cwd ?? process.cwd(),
      env: options?.env,
      options: options?.options,
    };

    // Detect git branch in the session's cwd.
    let branch: string | undefined;
    try {
      const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: config.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode === 0) {
        branch = new TextDecoder().decode(result.stdout).trim();
      }
    } catch { /* not a git repo */ }

    const adapter = factory(config);

    // Wire adapter events to state tracker, buffer, and broadcast.
    adapter.on("event", (e) => {
      this.stateTracker.trackEvent(sessionId, e);
      this.broadcast(e);
    });
    adapter.on("error", (err) => {
      const errorEvent: PairingEvent = {
        event: "session:update",
        session: { ...adapter.session, status: "error" },
      };
      this.stateTracker.trackEvent(sessionId, errorEvent);
      this.broadcast(errorEvent);
      console.error(`[bridge] adapter error (${sessionId}):`, err.message);
    });

    // Inject metadata into session.
    if (branch) {
      adapter.session.providerMeta = {
        ...adapter.session.providerMeta,
        branch,
      };
    }

    this.sessions.set(sessionId, adapter);

    // Register with state tracker before start so events during startup are captured.
    this.stateTracker.createSession(sessionId, adapter.session);

    await adapter.start();

    // Track post-start session state (adapter.start may have set status).
    this.stateTracker.trackEvent(sessionId, {
      event: "session:update",
      session: { ...adapter.session },
    });

    return adapter.session;
  }

  /** Send a prompt to a session. */
  send(prompt: Prompt): void {
    const adapter = this.sessions.get(prompt.sessionId);
    if (!adapter) {
      throw new Error(`No session: ${prompt.sessionId}`);
    }
    adapter.send(prompt);
  }

  /** Interrupt the active turn in a session. */
  interrupt(sessionId: string): void {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) return;
    adapter.interrupt();
  }

  /** Route a user's answer to a QuestionBlock back to the adapter. */
  answerQuestion(answer: import("../../protocol/primitives.ts").QuestionAnswer): void {
    const adapter = this.sessions.get(answer.sessionId) as any;
    if (!adapter) return;
    adapter.answerQuestion?.(answer);
  }

  /** Shut down a single session. */
  async closeSession(sessionId: string): Promise<void> {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) return;
    await adapter.shutdown();
    this.sessions.delete(sessionId);
    const closedEvent: PairingEvent = { event: "session:closed", sessionId };
    this.stateTracker.trackEvent(sessionId, closedEvent);
    this.broadcast(closedEvent);
    this.stateTracker.removeSession(sessionId);
  }

  /** List all active sessions. */
  listSessions(): Session[] {
    return [...this.sessions.values()].map((a) => ({ ...a.session }));
  }

  /**
   * Relay an approval decision to the adapter for a given session.
   * The caller (server.ts) is responsible for version validation.
   */
  decide(sessionId: string, blockId: string, decision: "approve" | "deny", reason?: string): void {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) {
      throw new Error(`No session: ${sessionId}`);
    }
    if (!adapter.decide) {
      throw new Error("Adapter does not support approvals");
    }
    adapter.decide(blockId, decision, reason);
  }

  /** Shut down the bridge and all sessions. */
  async shutdown(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map((id) => this.closeSession(id)));
  }

  // -- Snapshot / status ----------------------------------------------------

  /** Return the full accumulated state for a session (for reconnect). */
  getSessionSnapshot(sessionId: string): SessionState | null {
    return this.stateTracker.getSessionState(sessionId);
  }

  /** Return lightweight summaries of all active sessions. */
  getSessionSummaries(): SessionSummary[] {
    return this.stateTracker.getAllSessionSummaries();
  }

  // -- Event distribution ---------------------------------------------------

  /** Subscribe to all Pairing events from all sessions (receives SequencedEvents). */
  onEvent(listener: (event: SequencedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replay buffered events after `afterSeq` (for reconnecting clients). */
  replay(afterSeq: number): SequencedEvent[] {
    return this.buffer.replay(afterSeq);
  }

  /** Highest sequence number assigned so far (0 if no events yet). */
  currentSeq(): number {
    return this.buffer.currentSeq();
  }

  /** Oldest buffered sequence number (0 if buffer is empty). */
  oldestBufferedSeq(): number {
    return this.buffer.oldestSeq();
  }

  private broadcast(event: PairingEvent): void {
    const seq = this.buffer.push(event);
    if (event.event !== "block:delta") {
      log.debug("event", `seq=${seq} ${event.event} → ${this.listeners.size} listener(s)`);
    }
    const sequenced: SequencedEvent = {
      seq,
      event,
      timestamp: Date.now(),
    };
    for (const fn of this.listeners) {
      fn(sequenced);
    }
  }
}
