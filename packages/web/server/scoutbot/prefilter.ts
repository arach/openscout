import type {
  ScoutBrokerAgentRecord,
  ScoutBrokerEndpointRecord,
  ScoutBrokerFlightRecord,
  ScoutBrokerMessageRecord,
  ScoutBrokerSnapshot,
} from "../core/broker/service.ts";
import {
  parseScoutbotDirectives,
  scoutbotDirectiveMetadata,
  type ScoutbotDirectiveParseResult,
} from "./directives.ts";
import { SCOUTBOT_AGENT_ID } from "./role.ts";

export type ScoutbotBrokerSnapshot = ScoutBrokerSnapshot & {
  endpoints?: Record<string, ScoutBrokerEndpointRecord>;
  flights?: Record<string, ScoutBrokerFlightRecord>;
  messages?: Record<string, ScoutBrokerMessageRecord>;
};

export type ScoutbotPrefilterReply = {
  body: string;
  metadata: {
    matched_rule: string;
    snapshot_at: number;
    [key: string]: string | number;
  };
};

export function prefilterHandle(
  prompt: string,
  brokerSnapshot: ScoutbotBrokerSnapshot,
  now = Date.now(),
): ScoutbotPrefilterReply | null {
  const parsed = parseScoutbotDirectives(prompt);
  const normalized = parsed.body.trim();
  if (!normalized && !parsed.command) return null;

  if (parsed.command) {
    const arg = parsed.command.args;
    switch (parsed.command.name) {
      case "help":
        return reply("slash.help", now, renderHelp(), parsed);
      case "agents":
        return reply("slash.agents", now, renderAgents(brokerSnapshot), parsed);
      case "status":
        return reply("slash.status", now, renderStatus(brokerSnapshot, arg), parsed);
      case "recent":
        return reply("slash.recent", now, renderRecent(brokerSnapshot, arg), parsed);
      case "doing":
        return reply("slash.doing", now, renderDoing(brokerSnapshot, arg), parsed);
      case "flight":
        return reply("slash.flight", now, renderFlight(brokerSnapshot, arg), parsed);
      case "steer":
        return reply("slash.steer", now, renderSteer(parsed, arg), parsed);
    }
  }

  const whoOnline = normalized.match(/^who\s+is\s+online\??$/i);
  if (whoOnline) {
    return reply("status.who_online", now, renderAgents(brokerSnapshot), parsed);
  }

  const doing = normalized.match(/^what\s+is\s+@?([A-Za-z0-9._-]+)\s+doing\??$/i);
  if (doing?.[1]) {
    return reply("status.agent_doing", now, renderDoing(brokerSnapshot, doing[1]), parsed);
  }

  const blocked = normalized.match(/^is\s+@?([A-Za-z0-9._-]+)\s+blocked\??$/i);
  if (blocked?.[1]) {
    return reply("status.agent_blocked", now, renderBlocked(brokerSnapshot, blocked[1]), parsed);
  }

  const recent = normalized.match(/^recent\s+from\s+@?([A-Za-z0-9._-]+)\??$/i);
  if (recent?.[1]) {
    return reply("status.recent_from", now, renderRecent(brokerSnapshot, recent[1]), parsed);
  }

  const latest = normalized.match(/^(?:what(?:'s| is)\s+)?(?:the\s+)?latest\s+(?:on|from|for)\s+@?([A-Za-z0-9._-]+)\??$/i);
  if (latest?.[1]) {
    return reply("status.latest_agent", now, renderLatest(brokerSnapshot, latest[1]), parsed);
  }

  const lastSaid = normalized.match(/^what\s+did\s+@?([A-Za-z0-9._-]+)\s+say\s+last\??$/i);
  if (lastSaid?.[1]) {
    return reply("status.last_said", now, renderRecent(brokerSnapshot, lastSaid[1], 1), parsed);
  }

  return null;
}

function reply(
  matchedRule: string,
  snapshotAt: number,
  body: string,
  parsed: ScoutbotDirectiveParseResult,
): ScoutbotPrefilterReply {
  return {
    body: body.trim(),
    metadata: {
      matched_rule: matchedRule,
      snapshot_at: snapshotAt,
      ...scoutbotDirectiveMetadata(parsed),
    },
  };
}

function renderHelp(): string {
  return [
    "Scoutbot prefilter commands:",
    "- `/agents` — list known agents/endpoints",
    "- `/status` — summarize active flights and online agents",
    "- `/recent @agent` — latest messages from an agent",
    "- `/doing @agent` — active work for an agent",
    "- `/flight <id>` — flight status by id",
    "- `/steer sid:<session>` — target this ScoutBot thread at a session",
    "",
    "Directives can appear anywhere: `eff:low`, `eff:high`, `sid:<session>`.",
  ].join("\n");
}

function renderAgents(snapshot: ScoutbotBrokerSnapshot): string {
  const agents = Object.values(snapshot.agents ?? {})
    .filter((agent): agent is ScoutBrokerAgentRecord => Boolean(agent?.id))
    .sort((a, b) => agentLabel(a).localeCompare(agentLabel(b)));
  if (agents.length === 0) return "No agents are registered.";

  const endpoints = Object.values(snapshot.endpoints ?? {});
  const lines = agents.slice(0, 30).map((agent) => {
    const agentEndpoints = endpoints.filter((endpoint) => endpoint.agentId === agent.id);
    const states = agentEndpoints.length
      ? agentEndpoints.map((endpoint) => `${endpoint.transport ?? "unknown"}:${endpoint.state ?? "unknown"}`).join(", ")
      : "no endpoint";
    return `- ${agentLabel(agent)} (${agent.id}) — ${states}`;
  });
  const suffix = agents.length > lines.length ? `\n…and ${agents.length - lines.length} more.` : "";
  return `Known agents:\n${lines.join("\n")}${suffix}`;
}

function renderStatus(snapshot: ScoutbotBrokerSnapshot, rawArg = ""): string {
  const agentArg = firstAgentishToken(rawArg);
  if (agentArg) return renderLatest(snapshot, agentArg);

  const flights = Object.values(snapshot.flights ?? {});
  const active = flights
    .filter((flight) => !isTerminalFlight(flight.state))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const scoutbotDirectArtifacts = active.filter(isScoutbotDirectDeliveryArtifact);
  const visibleActive = active.filter((flight) => !isScoutbotDirectDeliveryArtifact(flight));
  const online = Object.values(snapshot.endpoints ?? {}).filter((endpoint) => endpoint.state === "active" || endpoint.state === "idle" || endpoint.state === "waiting");
  const activeLines = visibleActive.slice(0, 10).map((flight) => `- ${flight.id}: ${flight.targetAgentId} — ${flight.state}${flight.summary ? ` (${flight.summary})` : ""}`);
  return [
    `${online.length} endpoint${online.length === 1 ? "" : "s"} online/waiting.`,
    `${visibleActive.length} active flight${visibleActive.length === 1 ? "" : "s"}.`,
    scoutbotDirectArtifacts.length > 0
      ? `${scoutbotDirectArtifacts.length} stale Scoutbot direct deliver${scoutbotDirectArtifacts.length === 1 ? "y" : "ies"} hidden from this summary.`
      : null,
    ...(activeLines.length ? ["", ...activeLines] : []),
  ].filter((line): line is string => line !== null).join("\n");
}

function renderSteer(parsed: ScoutbotDirectiveParseResult, rawArg: string): string {
  const targetSessionId = parsed.directives.targetSessionId ?? firstSessionishToken(rawArg);
  if (!targetSessionId) {
    return "Usage: `/steer sid:<session>`.";
  }
  return `Steering this ScoutBot thread to session ${targetSessionId}.`;
}

function renderDoing(snapshot: ScoutbotBrokerSnapshot, rawAgent: string): string {
  const agentId = normalizeAgent(rawAgent);
  const agent = findAgent(snapshot, agentId);
  if (!agent) return `I do not see an agent matching ${formatAgent(rawAgent)}.`;
  const active = Object.values(snapshot.flights ?? {})
    .filter((flight) => flight.targetAgentId === agent.id && !isTerminalFlight(flight.state))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  if (active.length === 0) return `${agentLabel(agent)} has no active flight in the broker snapshot.`;
  return `${agentLabel(agent)} active work:\n${active.slice(0, 5).map((flight) => `- ${flight.id}: ${flight.state}${flight.summary ? ` — ${flight.summary}` : ""}`).join("\n")}`;
}

function renderBlocked(snapshot: ScoutbotBrokerSnapshot, rawAgent: string): string {
  const agentId = normalizeAgent(rawAgent);
  const agent = findAgent(snapshot, agentId);
  if (!agent) return `I do not see an agent matching ${formatAgent(rawAgent)}.`;
  const blocked = Object.values(snapshot.flights ?? {})
    .filter((flight) => flight.targetAgentId === agent.id && /blocked|waiting|failed/i.test(flight.state))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  if (blocked.length === 0) return `${agentLabel(agent)} does not have a blocked/waiting flight in the broker snapshot.`;
  return `${agentLabel(agent)} possible blockers:\n${blocked.slice(0, 5).map((flight) => `- ${flight.id}: ${flight.state}${flight.error ? ` — ${flight.error}` : flight.summary ? ` — ${flight.summary}` : ""}`).join("\n")}`;
}

function renderRecent(snapshot: ScoutbotBrokerSnapshot, rawAgent: string, limit = 5): string {
  const agentId = normalizeAgent(rawAgent);
  const agent = findAgent(snapshot, agentId);
  if (!agent) return `I do not see an agent matching ${formatAgent(rawAgent)}.`;
  const messages = Object.values(snapshot.messages ?? {})
    .filter((message) => message.actorId === agent.id)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, limit);
  if (messages.length === 0) return `No recent messages from ${agentLabel(agent)} are in the broker snapshot.`;
  return `Recent from ${agentLabel(agent)}:\n${messages.map((message) => `- ${new Date(message.createdAt ?? Date.now()).toLocaleString()}: ${compact(message.body)}`).join("\n")}`;
}

function renderLatest(snapshot: ScoutbotBrokerSnapshot, rawAgent: string): string {
  const agentId = normalizeAgent(rawAgent);
  const agent = findAgent(snapshot, agentId);
  if (!agent) return `I do not see an agent matching ${formatAgent(rawAgent)}.`;

  const active = Object.values(snapshot.flights ?? {})
    .filter((flight) => flight.targetAgentId === agent.id && !isTerminalFlight(flight.state))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const recentMessages = Object.values(snapshot.messages ?? {})
    .filter((message) => message.actorId === agent.id)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 3);

  return [
    `Latest on ${agentLabel(agent)}:`,
    active.length > 0
      ? `- current: ${active[0]!.state}${active[0]!.summary ? ` - ${active[0]!.summary}` : ""}`
      : "- current: no active flight in the broker snapshot",
    ...recentMessages.map((message) => `- recent: ${new Date(message.createdAt ?? Date.now()).toLocaleString()} - ${compact(message.body)}`),
    recentMessages.length === 0 ? "- recent: no recent messages in the broker snapshot" : null,
  ].filter((line): line is string => line !== null).join("\n");
}

function renderFlight(snapshot: ScoutbotBrokerSnapshot, rawFlightId: string): string {
  const id = rawFlightId.trim();
  if (!id) return "Usage: `/flight <id>`.";
  const flight = (snapshot.flights ?? {})[id] ?? Object.values(snapshot.flights ?? {}).find((candidate) => candidate.id.endsWith(id));
  if (!flight) return `I do not see flight ${id}.`;
  return [
    `Flight ${flight.id}`,
    `- target: ${flight.targetAgentId}`,
    `- state: ${flight.state}`,
    flight.summary ? `- summary: ${flight.summary}` : null,
    flight.error ? `- error: ${flight.error}` : null,
    flight.output ? `- output: ${compact(flight.output, 500)}` : null,
  ].filter(Boolean).join("\n");
}

function findAgent(snapshot: ScoutbotBrokerSnapshot, raw: string): ScoutBrokerAgentRecord | null {
  const normalized = normalizeAgent(raw);
  return Object.values(snapshot.agents ?? {}).find((agent) => {
    const labels = [agent.id, agent.handle, agent.selector, agent.defaultSelector, agent.displayName]
      .filter((value): value is string => typeof value === "string")
      .map(normalizeAgent);
    return labels.includes(normalized);
  }) ?? null;
}

function agentLabel(agent: ScoutBrokerAgentRecord): string {
  const selector = agent.defaultSelector ?? agent.selector ?? (agent.handle ? `@${agent.handle}` : null);
  return selector?.startsWith("@") ? selector : selector ? `@${selector}` : agent.displayName || agent.id;
}

function normalizeAgent(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function formatAgent(value: string): string {
  const normalized = normalizeAgent(value);
  return normalized ? `@${normalized}` : "that agent";
}

function firstAgentishToken(value: string): string | null {
  const token = value.trim().split(/\s+/).find(Boolean);
  if (!token) return null;
  return token.replace(/^@/, "").replace(/[.,!?;:]+$/g, "") || null;
}

function firstSessionishToken(value: string): string | null {
  const token = value.trim().split(/\s+/).find(Boolean);
  const normalized = token?.replace(/^sid:/i, "").replace(/[.,!?;]+$/g, "").trim();
  return normalized || null;
}

function compact(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function isTerminalFlight(state: string | undefined): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function isScoutbotDirectDeliveryArtifact(flight: ScoutBrokerFlightRecord): boolean {
  if (flight.targetAgentId !== SCOUTBOT_AGENT_ID) return false;
  if (flight.state !== "queued") return false;
  const metadata = flight.metadata ?? {};
  const source = typeof metadata.source === "string" ? metadata.source : "";
  if (source === "scoutbot") return false;
  const destinationKind = typeof metadata.destinationKind === "string" ? metadata.destinationKind : "";
  const destinationId = typeof metadata.destinationId === "string" ? metadata.destinationId : "";
  const relayTarget = typeof metadata.relayTarget === "string" ? metadata.relayTarget : "";
  return (destinationKind === "direct" && destinationId === SCOUTBOT_AGENT_ID)
    || relayTarget === SCOUTBOT_AGENT_ID;
}
