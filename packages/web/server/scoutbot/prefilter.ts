import type {
  ScoutBrokerAgentRecord,
  ScoutBrokerEndpointRecord,
  ScoutBrokerFlightRecord,
  ScoutBrokerMessageRecord,
  ScoutBrokerSnapshot,
} from "../core/broker/service.ts";

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
  };
};

export function prefilterHandle(
  prompt: string,
  brokerSnapshot: ScoutbotBrokerSnapshot,
  now = Date.now(),
): ScoutbotPrefilterReply | null {
  const normalized = prompt.trim();
  if (!normalized) return null;

  const slash = normalized.match(/^\/(\w+)(?:\s+(.+))?$/);
  if (slash) {
    const command = slash[1]?.toLowerCase() ?? "";
    const arg = slash[2]?.trim() ?? "";
    switch (command) {
      case "help":
        return reply("slash.help", now, renderHelp());
      case "agents":
        return reply("slash.agents", now, renderAgents(brokerSnapshot));
      case "status":
        return reply("slash.status", now, renderStatus(brokerSnapshot));
      case "recent":
        return reply("slash.recent", now, renderRecent(brokerSnapshot, arg));
      case "doing":
        return reply("slash.doing", now, renderDoing(brokerSnapshot, arg));
      case "flight":
        return reply("slash.flight", now, renderFlight(brokerSnapshot, arg));
      default:
        return null;
    }
  }

  const whoOnline = normalized.match(/^who\s+is\s+online\??$/i);
  if (whoOnline) {
    return reply("status.who_online", now, renderAgents(brokerSnapshot));
  }

  const doing = normalized.match(/^what\s+is\s+@?([A-Za-z0-9._-]+)\s+doing\??$/i);
  if (doing?.[1]) {
    return reply("status.agent_doing", now, renderDoing(brokerSnapshot, doing[1]));
  }

  const blocked = normalized.match(/^is\s+@?([A-Za-z0-9._-]+)\s+blocked\??$/i);
  if (blocked?.[1]) {
    return reply("status.agent_blocked", now, renderBlocked(brokerSnapshot, blocked[1]));
  }

  const recent = normalized.match(/^recent\s+from\s+@?([A-Za-z0-9._-]+)\??$/i);
  if (recent?.[1]) {
    return reply("status.recent_from", now, renderRecent(brokerSnapshot, recent[1]));
  }

  const lastSaid = normalized.match(/^what\s+did\s+@?([A-Za-z0-9._-]+)\s+say\s+last\??$/i);
  if (lastSaid?.[1]) {
    return reply("status.last_said", now, renderRecent(brokerSnapshot, lastSaid[1], 1));
  }

  return null;
}

function reply(matchedRule: string, snapshotAt: number, body: string): ScoutbotPrefilterReply {
  return {
    body: `${body.trim()}\n\n_matched_rule: ${matchedRule}; snapshot_at: ${snapshotAt}_`,
    metadata: {
      matched_rule: matchedRule,
      snapshot_at: snapshotAt,
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

function renderStatus(snapshot: ScoutbotBrokerSnapshot): string {
  const flights = Object.values(snapshot.flights ?? {});
  const active = flights.filter((flight) => !isTerminalFlight(flight.state));
  const online = Object.values(snapshot.endpoints ?? {}).filter((endpoint) => endpoint.state === "active" || endpoint.state === "idle" || endpoint.state === "waiting");
  const activeLines = active.slice(0, 10).map((flight) => `- ${flight.id}: ${flight.targetAgentId} — ${flight.state}${flight.summary ? ` (${flight.summary})` : ""}`);
  return [
    `${online.length} endpoint${online.length === 1 ? "" : "s"} online/waiting.`,
    `${active.length} active flight${active.length === 1 ? "" : "s"}.`,
    ...(activeLines.length ? ["", ...activeLines] : []),
  ].join("\n");
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

function compact(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function isTerminalFlight(state: string | undefined): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}
