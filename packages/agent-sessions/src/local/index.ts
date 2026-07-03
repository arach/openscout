import { randomUUID } from "node:crypto";

import { createAdapter as createGrokAcpAdapter } from "../adapters/grok-acp/index.js";
import { createAdapter as createPiAdapter } from "../adapters/pi/index.js";
import type { SequencedEvent } from "../buffer.js";
import type { AdapterFactory, PairingEvent, Session } from "../protocol/index.js";
import { SessionRegistry } from "../registry.js";
import type { SessionState, TurnState } from "../state.js";

export type LocalAgentHarness = "pi" | "grok" | "grok-acp";
export type LocalAgentResolvedHarness = "pi" | "grok";
export type LocalAgentTransport = "pi_rpc" | "grok_acp";
export type LocalAgentWarmth = "warm" | "lazy";

export type LocalAgentUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
};

export type LocalAgentSessionResult = {
  id: string;
  nativeId?: string;
  reused: boolean;
  warm: boolean;
};

export type LocalAgentTurnResult = {
  text: string;
  harness: LocalAgentResolvedHarness;
  transport: LocalAgentTransport;
  session: LocalAgentSessionResult;
  usage?: LocalAgentUsage;
  metadata?: Record<string, unknown>;
};

export type CompleteLocalAgentTurnOptions = {
  harness: LocalAgentHarness;
  transport?: LocalAgentTransport;
  cwd: string;
  systemPrompt?: string;
  input: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type CreateLocalAgentClientOptions = {
  harness: LocalAgentHarness;
  transport?: LocalAgentTransport;
  cwd: string;
  systemPrompt?: string;
  reuseKey?: string;
  warmth?: LocalAgentWarmth;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type LocalAgentClientTurnOptions = {
  input: string;
  systemPrompt?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type LocalAgentClient = {
  turn(input: string | LocalAgentClientTurnOptions): Promise<LocalAgentTurnResult>;
  close(): Promise<void>;
  interrupt?(): void;
};

type LocalAdapterSpec = {
  adapterType: string;
  createAdapter: AdapterFactory;
};

type ActiveLocalSession = {
  registry: SessionRegistry;
  session: Session;
  createdBeforeFirstTurn: boolean;
};

const DEFAULT_LOCAL_AGENT_TIMEOUT_MS = 300_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeHarness(harness: LocalAgentHarness): LocalAgentResolvedHarness {
  return harness === "grok-acp" ? "grok" : harness;
}

function resolveLocalTransport(
  harness: LocalAgentResolvedHarness,
  requested: LocalAgentTransport | undefined,
): LocalAgentTransport {
  const defaultTransport: LocalAgentTransport = harness === "pi" ? "pi_rpc" : "grok_acp";
  const transport = requested ?? defaultTransport;

  if (harness === "pi" && transport !== "pi_rpc") {
    throw new Error(`Local harness pi does not support transport ${transport}.`);
  }
  if (harness === "grok" && transport !== "grok_acp") {
    throw new Error(`Local harness grok does not support transport ${transport}.`);
  }

  return transport;
}

function adapterSpecForTransport(transport: LocalAgentTransport): LocalAdapterSpec {
  if (transport === "pi_rpc") {
    return {
      adapterType: "pi",
      createAdapter: createPiAdapter,
    };
  }

  return {
    adapterType: "grok-acp",
    createAdapter: createGrokAcpAdapter,
  };
}

function localSessionName(harness: LocalAgentResolvedHarness): string {
  return harness === "pi" ? "Local Pi" : "Local Grok ACP";
}

function buildAdapterOptions(options: {
  transport: LocalAgentTransport;
  systemPrompt?: string;
  model?: string;
  reuseKey?: string;
}): Record<string, unknown> {
  if (options.transport === "pi_rpc") {
    return {
      ...(options.model ? { model: options.model } : {}),
      ...(options.systemPrompt ? { appendSystemPrompt: options.systemPrompt } : {}),
      ...(options.reuseKey ? { sessionId: options.reuseKey } : {}),
    };
  }

  return {
    ...(options.reuseKey ? { sessionId: options.reuseKey, sessionMode: "auto" } : {}),
  };
}

function textForTurn(options: {
  input: string;
  turnSystemPrompt?: string;
  sessionSystemPrompt?: string;
  sessionSystemPromptAppliedByAdapter: boolean;
}): string {
  const input = options.input.trim();
  const turnSystemPrompt = options.turnSystemPrompt?.trim();
  const sessionSystemPrompt = options.sessionSystemPromptAppliedByAdapter
    ? undefined
    : options.sessionSystemPrompt?.trim();
  const effectiveSystemPrompt = turnSystemPrompt || sessionSystemPrompt;

  if (!effectiveSystemPrompt) {
    return input;
  }

  return [
    "System instructions:",
    effectiveSystemPrompt,
    "",
    "User input:",
    input,
  ].join("\n");
}

function eventSessionId(event: PairingEvent): string | undefined {
  return "sessionId" in event && typeof event.sessionId === "string" ? event.sessionId : undefined;
}

function terminalTurnEvent(event: PairingEvent, sessionId: string): {
  kind: "resolved" | "rejected";
  turnId?: string;
  message?: string;
} | null {
  if (eventSessionId(event) !== sessionId) {
    return null;
  }

  if (event.event === "turn:error") {
    return {
      kind: "rejected",
      turnId: event.turnId,
      message: event.message || "Local agent turn failed.",
    };
  }

  if (event.event !== "turn:end") {
    return null;
  }

  if (event.status === "failed") {
    return {
      kind: "rejected",
      turnId: event.turnId,
      message: "Local agent turn failed.",
    };
  }

  if (event.status === "stopped") {
    return {
      kind: "rejected",
      turnId: event.turnId,
      message: "Local agent turn was interrupted.",
    };
  }

  return {
    kind: "resolved",
    turnId: event.turnId,
  };
}

function abortError(): Error {
  return new Error("Local agent turn aborted.");
}

function timeoutError(timeoutMs: number): Error {
  return new Error(`Timed out waiting for local agent turn after ${timeoutMs}ms.`);
}

async function waitForTurnEnd(options: {
  registry: SessionRegistry;
  sessionId: string;
  text: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  const { registry, sessionId, text, signal } = options;
  if (signal?.aborted) {
    registry.interrupt(sessionId);
    throw abortError();
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let removeAbortListener: (() => void) | undefined;

  try {
    const completed = new Promise<string | undefined>((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        callback();
      };

      timeout = setTimeout(() => {
        registry.interrupt(sessionId);
        settle(() => reject(timeoutError(options.timeoutMs)));
      }, options.timeoutMs);

      if (signal) {
        const abort = (): void => {
          registry.interrupt(sessionId);
          settle(() => reject(abortError()));
        };
        signal.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", abort);
      }

      unsubscribe = registry.onEvent((entry: SequencedEvent) => {
        const terminal = terminalTurnEvent(entry.event, sessionId);
        if (!terminal) {
          return;
        }

        if (terminal.kind === "rejected") {
          settle(() => reject(new Error(terminal.message ?? "Local agent turn failed.")));
          return;
        }

        settle(() => resolve(terminal.turnId));
      });
    });

    registry.send({ sessionId, text });
    return await completed;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    unsubscribe?.();
    removeAbortListener?.();
  }
}

function textFromTurn(turn: TurnState | undefined): string {
  if (!turn) {
    return "";
  }

  return turn.blocks
    .map(({ block }) => block.type === "text" ? block.text.trim() : "")
    .filter(Boolean)
    .join("\n\n");
}

function findTurn(snapshot: SessionState | null, turnId: string | undefined): TurnState | undefined {
  if (!snapshot) {
    return undefined;
  }
  if (turnId) {
    const matched = snapshot.turns.find((turn) => turn.id === turnId);
    if (matched) {
      return matched;
    }
  }
  return snapshot.turns.at(-1);
}

function nestedRecord(source: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = source?.[key];
  return isRecord(value) ? value : undefined;
}

function nativeSessionId(snapshot: SessionState | null): string | undefined {
  const meta = snapshot?.session.providerMeta;
  return stringValue(meta?.externalSessionId)
    ?? stringValue(meta?.threadId)
    ?? stringValue(nestedRecord(meta, "acp")?.acpSessionId);
}

function readUsageRecord(record: Record<string, unknown> | undefined): LocalAgentUsage | undefined {
  if (!record) {
    return undefined;
  }

  const usage: LocalAgentUsage = {
    inputTokens: numberValue(record.inputTokens)
      ?? numberValue(record.input_tokens)
      ?? numberValue(record.promptTokens)
      ?? numberValue(record.prompt_tokens),
    outputTokens: numberValue(record.outputTokens)
      ?? numberValue(record.output_tokens)
      ?? numberValue(record.completionTokens)
      ?? numberValue(record.completion_tokens),
    cachedInputTokens: numberValue(record.cachedInputTokens)
      ?? numberValue(record.cached_input_tokens),
    totalTokens: numberValue(record.totalTokens)
      ?? numberValue(record.total_tokens),
  };

  return Object.values(usage).some((value) => typeof value === "number") ? usage : undefined;
}

function usageFromSnapshot(snapshot: SessionState | null): LocalAgentUsage | undefined {
  const meta = snapshot?.session.providerMeta;
  return readUsageRecord(nestedRecord(meta, "usage"))
    ?? readUsageRecord(nestedRecord(nestedRecord(meta, "acp"), "usage"))
    ?? readUsageRecord(nestedRecord(meta, "observeUsage"));
}

function metadataFromSnapshot(snapshot: SessionState | null, turn: TurnState | undefined): Record<string, unknown> | undefined {
  if (!snapshot) {
    return undefined;
  }

  return {
    adapterType: snapshot.session.adapterType,
    providerMeta: snapshot.session.providerMeta ?? {},
    ...(turn
      ? {
        turn: {
          id: turn.id,
          status: turn.status,
          startedAt: turn.startedAt,
          endedAt: turn.endedAt,
        },
      }
      : {}),
  };
}

function normalizeTurnInput(input: string | LocalAgentClientTurnOptions): LocalAgentClientTurnOptions {
  return typeof input === "string" ? { input } : input;
}

export async function createLocalAgentClient(
  options: CreateLocalAgentClientOptions,
): Promise<LocalAgentClient> {
  const harness = normalizeHarness(options.harness);
  const transport = resolveLocalTransport(harness, options.transport);
  const spec = adapterSpecForTransport(transport);
  const registry = new SessionRegistry({
    adapters: {
      [spec.adapterType]: spec.createAdapter,
    },
  });
  const sessionId = options.reuseKey?.trim() || randomUUID();
  const sessionSystemPromptAppliedByAdapter = transport === "pi_rpc";
  let active: ActiveLocalSession | null = null;
  let closed = false;
  let turnCount = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const ensureSession = async (turnOptions?: LocalAgentClientTurnOptions): Promise<ActiveLocalSession> => {
    if (closed) {
      throw new Error("Local agent client is closed.");
    }
    if (active) {
      return active;
    }

    const createdBeforeFirstTurn = !turnOptions;
    const model = turnOptions?.model ?? options.model;
    const session = await registry.createSession(spec.adapterType, {
      sessionId,
      name: localSessionName(harness),
      cwd: options.cwd,
      options: buildAdapterOptions({
        transport,
        systemPrompt: options.systemPrompt,
        model,
        reuseKey: options.reuseKey,
      }),
    });
    active = {
      registry,
      session,
      createdBeforeFirstTurn,
    };
    return active;
  };

  if (options.warmth !== "lazy") {
    await ensureSession();
  }

  const runTurn = async (rawInput: string | LocalAgentClientTurnOptions): Promise<LocalAgentTurnResult> => {
    const turnOptions = normalizeTurnInput(rawInput);
    const localSession = await ensureSession(turnOptions);
    const warm = localSession.createdBeforeFirstTurn;
    const reused = turnCount > 0;
    const text = textForTurn({
      input: turnOptions.input,
      turnSystemPrompt: turnOptions.systemPrompt,
      sessionSystemPrompt: options.systemPrompt,
      sessionSystemPromptAppliedByAdapter,
    });
    const turnId = await waitForTurnEnd({
      registry,
      sessionId: localSession.session.id,
      text,
      timeoutMs: Math.max(1, turnOptions.timeoutMs ?? options.timeoutMs ?? DEFAULT_LOCAL_AGENT_TIMEOUT_MS),
      signal: turnOptions.signal ?? options.signal,
    });
    turnCount += 1;

    const snapshot = registry.getSessionSnapshot(localSession.session.id);
    const turn = findTurn(snapshot, turnId);
    return {
      text: textFromTurn(turn),
      harness,
      transport,
      session: {
        id: localSession.session.id,
        nativeId: nativeSessionId(snapshot),
        reused,
        warm,
      },
      usage: usageFromSnapshot(snapshot),
      metadata: metadataFromSnapshot(snapshot, turn),
    };
  };

  return {
    turn(input: string | LocalAgentClientTurnOptions): Promise<LocalAgentTurnResult> {
      const next = queue.then(() => runTurn(input), () => runTurn(input));
      queue = next.then(() => undefined, () => undefined);
      return next;
    },
    async close(): Promise<void> {
      closed = true;
      await registry.shutdown();
      active = null;
    },
    interrupt(): void {
      if (active) {
        registry.interrupt(active.session.id);
      }
    },
  };
}

export async function completeLocalAgentTurn(
  options: CompleteLocalAgentTurnOptions,
): Promise<LocalAgentTurnResult> {
  const client = await createLocalAgentClient({
    harness: options.harness,
    transport: options.transport,
    cwd: options.cwd,
    systemPrompt: options.systemPrompt,
    model: options.model,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    warmth: "lazy",
  });

  try {
    return await client.turn({
      input: options.input,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  } finally {
    await client.close();
  }
}
