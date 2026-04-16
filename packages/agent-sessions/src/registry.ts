import type {
  Adapter,
  AdapterConfig,
  AdapterFactory,
  PairingEvent,
  Prompt,
  QuestionAnswer,
  Session,
} from "./protocol/index.ts";
import { OutboundBuffer, type SequencedEvent } from "./buffer.ts";
import { StateTracker } from "./state.ts";
import type { SessionState, SessionSummary } from "./state.ts";

export interface SessionRegistryConfig {
  adapters: Record<string, AdapterFactory>;
  bufferCapacity?: number;
}

export interface SessionDecisionInput {
  sessionId: string;
  turnId: string;
  blockId: string;
  version: number;
  decision: "approve" | "deny";
  reason?: string;
}

export type SessionRegistryErrorCode = "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST";

export class SessionRegistryError extends Error {
  readonly code: SessionRegistryErrorCode;

  constructor(code: SessionRegistryErrorCode, message: string) {
    super(message);
    this.name = "SessionRegistryError";
    this.code = code;
  }
}

export function isSessionRegistryError(error: unknown): error is SessionRegistryError {
  return error instanceof SessionRegistryError;
}

export class SessionRegistry {
  private sessions = new Map<string, Adapter>();
  private listeners = new Set<(event: SequencedEvent) => void>();
  private readonly buffers = new Map<string, OutboundBuffer>();
  private readonly stateTracker = new StateTracker();

  constructor(private readonly config: SessionRegistryConfig) {}

  async createSession(
    adapterType: string,
    options?: Partial<AdapterConfig>,
  ): Promise<Session> {
    const factory = this.config.adapters[adapterType];
    if (!factory) {
      throw new Error(
        `Unknown adapter type: "${adapterType}". Registered: ${Object.keys(this.config.adapters).join(", ")}`,
      );
    }

    const sessionId = options?.sessionId ?? crypto.randomUUID();
    const config: AdapterConfig = {
      sessionId,
      name: options?.name ?? `${adapterType} session`,
      cwd: options?.cwd ?? process.cwd(),
      env: options?.env,
      options: options?.options,
    };

    const branch = this.detectBranch(config.cwd);
    const adapter = factory(config);

    adapter.on("event", (event) => {
      this.stateTracker.trackEvent(sessionId, event);
      this.broadcast(sessionId, event);
    });
    adapter.on("error", (error) => {
      const errorEvent: PairingEvent = {
        event: "session:update",
        session: { ...adapter.session, status: "error" },
      };
      this.stateTracker.trackEvent(sessionId, errorEvent);
      this.broadcast(sessionId, errorEvent);
      console.error(`[session-registry] adapter error (${sessionId}):`, error.message);
    });

    if (branch) {
      adapter.session.providerMeta = {
        ...adapter.session.providerMeta,
        branch,
      };
    }

    this.sessions.set(sessionId, adapter);
    this.ensureBuffer(sessionId);
    this.stateTracker.createSession(sessionId, adapter.session);

    await adapter.start();

    this.stateTracker.trackEvent(sessionId, {
      event: "session:update",
      session: { ...adapter.session },
    });

    return adapter.session;
  }

  send(prompt: Prompt): void {
    const adapter = this.sessions.get(prompt.sessionId);
    if (!adapter) {
      throw new SessionRegistryError("NOT_FOUND", `No session: ${prompt.sessionId}`);
    }
    adapter.send(prompt);
  }

  interrupt(sessionId: string): void {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) {
      return;
    }
    adapter.interrupt();
  }

  answer(answer: QuestionAnswer): void {
    const adapter = this.sessions.get(answer.sessionId);
    if (!adapter) {
      throw new SessionRegistryError("NOT_FOUND", `No session: ${answer.sessionId}`);
    }
    if (!adapter.answerQuestion) {
      throw new SessionRegistryError("BAD_REQUEST", "Adapter does not support interactive questions");
    }
    adapter.answerQuestion(answer);
  }

  decide(input: SessionDecisionInput): void {
    const adapter = this.sessions.get(input.sessionId);
    if (!adapter) {
      throw new SessionRegistryError("NOT_FOUND", `No session: ${input.sessionId}`);
    }
    if (!adapter.decide) {
      throw new SessionRegistryError("BAD_REQUEST", "Adapter does not support approvals");
    }

    const approvalVersion = this.findApprovalVersion(input.sessionId, input.turnId, input.blockId);
    if (approvalVersion == null || approvalVersion !== input.version) {
      throw new SessionRegistryError("CONFLICT", "Stale approval version");
    }

    adapter.decide(input.turnId, input.blockId, input.decision, input.reason);
  }

  async closeSession(sessionId: string): Promise<void> {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) {
      return;
    }

    await adapter.shutdown();
    this.sessions.delete(sessionId);

    const closedEvent: PairingEvent = { event: "session:closed", sessionId };
    this.stateTracker.trackEvent(sessionId, closedEvent);
    this.broadcast(sessionId, closedEvent);
    this.stateTracker.removeSession(sessionId);
    this.buffers.delete(sessionId);
  }

  listSessions(): Session[] {
    return [...this.sessions.values()].map((adapter) => ({ ...adapter.session }));
  }

  async shutdown(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map((sessionId) => this.closeSession(sessionId)));
  }

  getSessionSnapshot(sessionId: string): SessionState | null {
    return this.stateTracker.getSessionState(sessionId);
  }

  getSessionSummaries(): SessionSummary[] {
    return this.stateTracker.getAllSessionSummaries();
  }

  onEvent(listener: (event: SequencedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replay(sessionId: string, afterSeq: number): SequencedEvent[] {
    return this.buffers.get(sessionId)?.replay(afterSeq) ?? [];
  }

  currentSeq(sessionId: string): number {
    return this.buffers.get(sessionId)?.currentSeq() ?? 0;
  }

  oldestBufferedSeq(sessionId: string): number {
    return this.buffers.get(sessionId)?.oldestSeq() ?? 0;
  }

  private broadcast(sessionId: string, event: PairingEvent): void {
    const seq = this.ensureBuffer(sessionId).push(event);
    const sequenced: SequencedEvent = {
      seq,
      event,
      timestamp: Date.now(),
    };

    for (const listener of this.listeners) {
      listener(sequenced);
    }
  }

  private detectBranch(cwd: string | undefined): string | undefined {
    try {
      const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: cwd ?? process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode === 0) {
        return new TextDecoder().decode(result.stdout).trim();
      }
    } catch {
      // Not a git repo or git unavailable.
    }

    return undefined;
  }

  private findApprovalVersion(sessionId: string, turnId: string, blockId: string): number | null {
    const snapshot = this.stateTracker.getSessionState(sessionId);
    if (!snapshot) {
      return null;
    }

    const turn = snapshot.turns.find((candidate) => candidate.id === turnId);
    if (!turn) {
      return null;
    }

    const blockState = turn.blocks.find((candidate) => candidate.block.id === blockId);
    if (!blockState || blockState.block.type !== "action") {
      return null;
    }

    return blockState.block.action.approval?.version ?? null;
  }

  private ensureBuffer(sessionId: string): OutboundBuffer {
    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      buffer = new OutboundBuffer(this.config.bufferCapacity);
      this.buffers.set(sessionId, buffer);
    }
    return buffer;
  }
}
