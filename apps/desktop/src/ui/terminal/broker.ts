import type { ScoutBrokerMessageRecord, ScoutWhoEntry } from "../../core/broker/service.ts";
import { formatScoutTimestamp, normalizeUnixTimestamp } from "../../core/broker/view.ts";

export function renderScoutMessage(message: ScoutBrokerMessageRecord): string {
  const timestamp = normalizeUnixTimestamp(message.createdAt) ?? Math.floor(Date.now() / 1000);
  const body = message.body;
  const type = message.class === "system" || message.class === "status" ? "SYS" : "MSG";
  if (type === "SYS") {
    return `${formatScoutTimestamp(timestamp)} · ${body}`;
  }
  return `${formatScoutTimestamp(timestamp)} ${message.actorId}  ${body}`;
}

export function renderScoutAgentList(entries: ScoutWhoEntry[]): string {
  if (entries.length === 0) {
    return "No agents are known to the broker yet.";
  }

  return entries.map((entry) => {
    const messageLabel = entry.messages === 1 ? "1 message" : `${entry.messages} messages`;
    const lastSeenLabel = entry.lastSeen ? `last seen ${formatScoutTimestamp(entry.lastSeen)}` : "not seen yet";
    const registrationLabel = entry.registrationKind === "discovered" ? "auto-discovered" : null;
    return [
      entry.agentId,
      entry.state,
      messageLabel,
      lastSeenLabel,
      registrationLabel,
    ].filter(Boolean).join(" · ");
  }).join("\n");
}

export function renderScoutMessagePostResult(result: {
  message: string;
  invokedTargets: string[];
  unresolvedTargets: string[];
}): string {
  const lines = [result.message];
  if (result.invokedTargets.length > 0) {
    lines.push(`Routed to: ${result.invokedTargets.join(", ")}`);
  }
  if (result.unresolvedTargets.length > 0) {
    lines.push(`Unresolved: ${result.unresolvedTargets.join(", ")}`);
  }
  return lines.join("\n");
}

export function renderScoutBroadcastResult(result: {
  message: string;
  invokedTargets: string[];
  unresolvedTargets: string[];
}): string {
  const lines = [`Broadcast: ${result.message}`];
  if (result.invokedTargets.length > 0) {
    lines.push(`Routed to ${result.invokedTargets.length} agents`);
  }
  if (result.unresolvedTargets.length > 0) {
    lines.push(`Unresolved: ${result.unresolvedTargets.join(", ")}`);
  }
  return lines.join("\n");
}
