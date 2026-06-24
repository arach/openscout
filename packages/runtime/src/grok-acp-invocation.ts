import {
  createGrokAcpAdapter,
  SessionRegistry,
  type SessionState,
} from "@openscout/agent-sessions";

export interface GrokAcpInvocationOptions {
  sessionId: string;
  cwd: string;
  prompt: string;
  name?: string;
  timeoutMs?: number;
}

export interface GrokAcpInvocationResult {
  output: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_GROK_ACP_TIMEOUT_MS = 60_000;

function completedText(snapshot: SessionState | null): string {
  const turn = snapshot?.turns.at(-1);
  if (!turn) {
    return "The Grok ACP session completed without an observable turn.";
  }

  const text = turn.blocks
    .map(({ block }) => block.type === "text" ? block.text.trim() : "")
    .filter(Boolean)
    .join("\n\n");

  return text || "The Grok ACP session completed without a text reply.";
}

export async function invokeGrokAcpAgent(
  options: GrokAcpInvocationOptions,
): Promise<GrokAcpInvocationResult> {
  const registry = new SessionRegistry({
    adapters: {
      "grok-acp": createGrokAcpAdapter,
    },
  });
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? DEFAULT_GROK_ACP_TIMEOUT_MS);
  const session = await registry.createSession("grok-acp", {
    sessionId: options.sessionId,
    name: options.name ?? "Grok ACP",
    cwd: options.cwd,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let unsubscribe = () => {};
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for Grok ACP after ${timeoutMs}ms.`));
      }, timeoutMs);

      unsubscribe = registry.onEvent(({ event }) => {
        if (event.event === "turn:end") {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
          return;
        }
        if (event.event === "turn:error") {
          clearTimeout(timeout);
          unsubscribe();
          reject(new Error(event.message || "Grok ACP turn failed."));
        }
      });

      registry.send({
        sessionId: session.id,
        text: options.prompt,
      });
    });

    const snapshot = registry.getSessionSnapshot(session.id);
    return {
      output: completedText(snapshot),
      sessionId: session.id,
      metadata: {
        adapterType: "grok-acp",
        providerMeta: snapshot?.session.providerMeta,
      },
    };
  } finally {
    await registry.closeSession(session.id).catch(() => undefined);
  }
}
