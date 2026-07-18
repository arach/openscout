import {
  SessionRegistry,
  type AdapterFactory,
  type SessionState,
} from "@openscout/agent-sessions";

import type { RuntimeTimer } from "./portable-types.js";
import { RequesterWaitTimeoutError, isRequesterWaitTimeoutError } from "./requester-timeout.js";

export interface AcpAgentInvocationOptions {
  adapterType: string;
  createAdapter: AdapterFactory;
  label: string;
  sessionId: string;
  cwd: string;
  prompt: string;
  name?: string;
  timeoutMs?: number;
  hardCeilingMs?: number;
}

export interface AcpAgentInvocationResult {
  output: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_ACP_HARD_CEILING_MS = 30 * 60_000;

function completedText(snapshot: SessionState | null, label: string): string {
  const turn = snapshot?.turns.at(-1);
  if (!turn) {
    return `The ${label} session completed without an observable turn.`;
  }

  const text = turn.blocks
    .map(({ block }) => block.type === "text" ? block.text.trim() : "")
    .filter(Boolean)
    .join("\n\n");

  return text || `The ${label} session completed without a text reply.`;
}

export async function invokeAcpAgent(
  options: AcpAgentInvocationOptions,
): Promise<AcpAgentInvocationResult> {
  const registry = new SessionRegistry({
    adapters: {
      [options.adapterType]: options.createAdapter,
    },
  });
  const session = await registry.createSession(options.adapterType, {
    sessionId: options.sessionId,
    name: options.name ?? options.label,
    cwd: options.cwd,
  });
  const turn = runAcpTurn(registry, session.id, options);

  try {
    return await waitForRequesterResult(turn, options.timeoutMs, options.label);
  } catch (error) {
    if (isRequesterWaitTimeoutError(error)) {
      // The caller's wait budget is not the harness execution budget. Keep the
      // per-invocation ACP session alive until the turn reaches a terminal
      // event or the hard execution ceiling.
      turn.catch(() => undefined);
    }
    throw error;
  }
}

async function runAcpTurn(
  registry: SessionRegistry,
  sessionId: string,
  options: AcpAgentInvocationOptions,
): Promise<AcpAgentInvocationResult> {
  try {
    await new Promise<void>((resolve, reject) => {
      let unsubscribe = () => {};
      let settled = false;
      const hardCeilingMs = options.hardCeilingMs ?? DEFAULT_ACP_HARD_CEILING_MS;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(hardCeiling);
        unsubscribe();
        if (error) reject(error);
        else resolve();
      };
      const hardCeiling = setTimeout(() => {
        finish(new Error(`${options.label} exceeded the ${hardCeilingMs}ms hard ceiling.`));
      }, hardCeilingMs);
      hardCeiling.unref?.();

      unsubscribe = registry.onEvent(({ event }) => {
        if ("sessionId" in event && event.sessionId !== sessionId) return;
        if (event.event === "turn:end") {
          finish();
          return;
        }
        if (event.event === "turn:error") {
          finish(new Error(event.message || `${options.label} turn failed.`));
        }
      });

      Promise.resolve(registry.send({ sessionId, text: options.prompt })).catch((error) => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });
    });

    const snapshot = registry.getSessionSnapshot(sessionId);
    return {
      output: completedText(snapshot, options.label),
      sessionId,
      metadata: {
        adapterType: options.adapterType,
        providerMeta: snapshot?.session.providerMeta,
      },
    };
  } finally {
    await registry.closeSession(sessionId).catch(() => undefined);
  }
}

function requesterTimeoutMs(timeoutMs: number | undefined): number | null {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return null;
  }
  return Math.floor(timeoutMs);
}

async function waitForRequesterResult<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string,
): Promise<T> {
  const effectiveTimeoutMs = requesterTimeoutMs(timeoutMs);
  if (effectiveTimeoutMs === null) return await promise;

  let timer: RuntimeTimer | null = null;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new RequesterWaitTimeoutError({ label, timeoutMs: effectiveTimeoutMs }));
    }, effectiveTimeoutMs);
    timer.unref?.();
  });

  return await Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
