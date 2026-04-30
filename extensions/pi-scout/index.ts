import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { FlightRecord, ScoutDeliverResponse } from "@openscout/protocol";
import { brokerClient } from "./broker/client.ts";
import { createScoutSendTool } from "./tools/send.ts";
import { createScoutAskTool } from "./tools/ask.ts";
import { createScoutWhoTool } from "./tools/who.ts";
import { AgentPickerOverlay } from "./ui/agent-picker.ts";
import { ComposeOverlay } from "./ui/compose.ts";
import { loadConfig } from "./config.ts";
import { createScoutRuntime } from "./runtime.ts";
import type { AgentInfo, BrokerSnapshot, ComposeResult, PickerResult } from "./types.ts";

export default function registerPiScoutExtension(pi: ExtensionAPI) {
  const runtime = createScoutRuntime(pi);

  // ─── Tools ──────────────────────────────────────────────────────────────
  pi.registerTool(createScoutSendTool(runtime));
  pi.registerTool(createScoutAskTool(runtime));
  pi.registerTool(createScoutWhoTool(runtime));

  // ─── Commands ───────────────────────────────────────────────────────────
  pi.registerCommand("scout", {
    description: "Scout coordination: send, ask, who",
    async handler(args, extCtx) {
      runtime.noteContext(extCtx);
      const trimmed = args.trim();
      const [subcommand, ...rest] = trimmed ? trimmed.split(/\s+/) : [];
      const restStr = rest.join(" ");

      await runtime.ensureEngaged(extCtx);

      if (subcommand === "who") {
        const snapshot = await brokerClient.getSnapshot();
        const text = formatAgents(listAgents(snapshot));
        extCtx.ui.notify(text, "info");
        return;
      }

      if (subcommand === "send") {
        await handleSendAsk("send", restStr, extCtx);
        return;
      }

      if (subcommand === "ask") {
        await handleSendAsk("ask", restStr, extCtx);
        return;
      }

      await handleSendAsk("send", trimmed, extCtx);
    },
  });
}

async function handleSendAsk(
  mode: "send" | "ask",
  rawArgs: string,
  ctx: ExtensionCommandContext,
) {
  const parsed = parseTargetAndBody(rawArgs);

  if (parsed?.body) {
    const text = mode === "send"
      ? await sendScoutMessage(parsed.target, parsed.body)
      : await askScoutAgent(parsed.target, parsed.body, ctx.signal);
    ctx.ui.notify(text, "info");
    return;
  }

  if (!ctx.hasUI) {
    ctx.ui.notify(
      mode === "send"
        ? "Usage: /scout send @agent <message>"
        : "Usage: /scout ask @agent <message>",
      "warning",
    );
    return;
  }

  let target = parsed?.target;

  if (!target) {
    const snapshot = await brokerClient.getSnapshot();
    const agents = listAgents(snapshot);
    const result = await ctx.ui.custom<PickerResult | undefined>(
      (_tui, theme, kb, done) => new AgentPickerOverlay(theme, kb, agents, done),
      { overlay: true },
    );

    if (!result?.selected) {
      return;
    }

    target = result.selected.label ?? result.selected.id;
  }

  const composeResult = await ctx.ui.custom<ComposeResult | undefined>(
    (_tui, theme, kb, done) => new ComposeOverlay(theme, kb, target, done),
    { overlay: true },
  );

  if (!composeResult?.confirmed || composeResult.cancelled) {
    return;
  }

  const text = mode === "send"
    ? await sendScoutMessage(target, composeResult.body)
    : await askScoutAgent(target, composeResult.body, ctx.signal);
  ctx.ui.notify(text, "info");
}

function listAgents(snapshot: BrokerSnapshot): AgentInfo[] {
  return Object.entries(snapshot.agents).map(([id, agent]) => {
    const endpoints = Object.values(snapshot.endpoints).filter((endpoint) => endpoint.agentId === id);
    return {
      id,
      label: agent.selector ?? agent.defaultSelector ?? id,
      state: endpoints[0]?.state ?? "offline",
      harness: endpoints[0]?.harness,
      nodeId: agent.authorityNodeId,
    };
  });
}

function formatAgents(agents: AgentInfo[]): string {
  if (agents.length === 0) return "No agents found.";
  return agents
    .map((agent) => `${agent.label} · ${agent.state}${agent.harness ? ` · ${agent.harness}` : ""}`)
    .join("\n");
}

function parseTargetAndBody(
  rawArgs: string,
): { target: string; body?: string } | null {
  const trimmed = rawArgs.trim();
  if (!trimmed) return null;

  const [first, ...rest] = trimmed.split(/\s+/);
  if (!first || !isLikelyTarget(first)) return null;

  return {
    target: first,
    body: rest.join(" ").trim() || undefined,
  };
}

function isLikelyTarget(value: string): boolean {
  return value.startsWith("@") || value.includes(":");
}

function resolveTarget(target: string) {
  return target.includes(":")
    ? { kind: "agent_id" as const, id: target }
    : { kind: "agent_label" as const, label: target.replace(/^@/, "") };
}

async function sendScoutMessage(
  target: string,
  body: string,
): Promise<string> {
  const response = await brokerClient.deliver({
    intent: "tell",
    body,
    target: resolveTarget(target),
  });

  if (response.kind === "delivery") {
    return `Message queued for ${target}`;
  }

  return describeFailedDelivery(target, response);
}

async function askScoutAgent(
  target: string,
  body: string,
  signal?: AbortSignal,
): Promise<string> {
  const config = loadConfig();
  const replyMode = config.defaultReplyMode;
  const response = await brokerClient.deliver({
    intent: "consult",
    body,
    target: resolveTarget(target),
  });

  if (response.kind !== "delivery") {
    return describeFailedDelivery(target, response);
  }

  if (replyMode === "none") {
    return response.flight ? `Ask queued for ${target}` : `Ask sent to ${target}`;
  }

  if (replyMode === "notify") {
    return response.flight
      ? `Ask queued for ${target}. You'll be notified when it's done.`
      : `Ask sent to ${target}`;
  }

  if (!response.flight) {
    return `Ask sent to ${target}`;
  }

  const result = await brokerClient.waitForFlight(response.flight.id, {
    signal,
    timeoutMs: 300_000,
  });

  return describeFlightResult(result);
}

function describeFailedDelivery(
  target: string,
  response: Exclude<ScoutDeliverResponse, { kind: "delivery" }>,
): string {
  if (response.kind === "question") {
    return response.remediation?.detail ?? `Target ${target} is unavailable right now.`;
  }

  return response.remediation?.detail ?? `Could not reach ${target}: ${response.reason.replaceAll("_", " ")}`;
}

function describeFlightResult(result: FlightRecord): string {
  return result.output ?? result.summary ?? result.error ?? "Done.";
}
