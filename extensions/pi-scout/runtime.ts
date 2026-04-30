import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { brokerClient } from "./broker/client.ts";
import { loadConfig } from "./config.ts";
import type { ScoutEvent } from "./types.ts";

type ScoutNotification = {
  message: string;
  type: "info" | "warning" | "error";
};

export interface ScoutRuntime {
  ensureEngaged(ctx: ExtensionContext): Promise<void>;
  noteContext(ctx: ExtensionContext): void;
  dispose(): void;
}

export function createScoutRuntime(pi: ExtensionAPI): ScoutRuntime {
  let currentCtx: ExtensionContext | undefined;
  let currentAgentId: string | undefined;
  let warnedAboutDisconnect = false;
  let sawBrokerEvent = false;
  let engaged = false;
  let subscription: { cancel: () => void } | undefined;

  function noteContext(ctx: ExtensionContext): void {
    currentCtx = ctx;
    currentAgentId = sessionHandleFor(ctx);
  }

  async function ensureEngaged(ctx: ExtensionContext): Promise<void> {
    noteContext(ctx);
    if (engaged) return;
    engaged = true;

    startEventSubscription();

    const config = loadConfig();
    if (!config.autoRegister) return;

    try {
      await brokerClient.upsertAgentCard({
        id: `pi-scout-${currentAgentId}`,
        agentId: currentAgentId!,
        displayName: "pi",
        handle: currentAgentId!,
        harness: "pi",
        transport: "local_socket",
        projectRoot: ctx.cwd,
        currentDirectory: ctx.cwd,
        nodeId: "local",
        sessionId: ctx.sessionManager.getSessionFile() ?? String(Date.now()),
      });
    } catch {
      // Broker may not be running yet.
    }
  }

  function dispose(): void {
    subscription?.cancel();
    subscription = undefined;
  }

  function startEventSubscription(): void {
    if (subscription) return;

    try {
      subscription = brokerClient.subscribeToEvents(
        (event) => {
          sawBrokerEvent = true;
          warnedAboutDisconnect = false;
          const notification = summarizeScoutEvent(event, currentAgentId);
          if (!notification || !currentCtx?.hasUI) return;
          currentCtx.ui.notify(notification.message, notification.type);
        },
        (err) => {
          if (!sawBrokerEvent && isInitialBrokerUnavailableError(err)) {
            return;
          }
          if (warnedAboutDisconnect) return;
          warnedAboutDisconnect = true;

          const message = `Scout SSE disconnected: ${formatError(err)}`;
          if (currentCtx?.hasUI) {
            currentCtx.ui.notify(message, "warning");
          } else {
            console.warn(message);
          }
        },
      );
    } catch {
      // Broker may not be running — stay quiet until an actual Scout action fails.
    }
  }

  pi.on("session_shutdown", async () => {
    dispose();
  });

  return {
    ensureEngaged,
    noteContext,
    dispose,
  };
}

function sessionHandleFor(ctx: ExtensionContext): string {
  const sessionFile = ctx.sessionManager.getSessionFile();
  return sessionFile ? `pi.${sessionFile}` : "pi";
}

function summarizeScoutEvent(
  event: ScoutEvent,
  currentAgentId?: string,
): ScoutNotification | null {
  if (event.kind === "message.posted") {
    const message = event.payload.message;
    const notifyList = message.audience?.notify ?? [];
    const visibleList = message.audience?.visibleTo ?? [];
    if (
      currentAgentId
      && !notifyList.includes(currentAgentId)
      && !visibleList.includes(currentAgentId)
    ) {
      return null;
    }

    return {
      message: `Scout message from ${message.actorId}: ${message.body}`,
      type: "info",
    };
  }

  if (event.kind === "flight.updated") {
    const flight = event.payload.flight;
    if (
      currentAgentId
      && flight.requesterId !== currentAgentId
      && flight.targetAgentId !== currentAgentId
    ) {
      return null;
    }

    if (flight.state === "completed") {
      return {
        message: flight.output ?? flight.summary ?? flight.error ?? "Done.",
        type: "info",
      };
    }

    if (flight.state === "failed") {
      return {
        message: flight.error ?? flight.summary ?? `Scout request ${flight.id} failed.`,
        type: "error",
      };
    }

    if (flight.state === "cancelled") {
      return {
        message: flight.summary ?? `Scout request ${flight.id} was cancelled.`,
        type: "warning",
      };
    }
  }

  return null;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isInitialBrokerUnavailableError(err: unknown): boolean {
  const message = formatError(err);
  return message.includes("ENOENT") || message.includes("ECONNREFUSED");
}
