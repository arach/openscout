import type { ScoutAgentCard } from "@openscout/protocol";

export function renderScoutAgentCard(card: ScoutAgentCard): string {
  const lines = [
    `${card.displayName} [@${card.handle}]`,
    `Agent: ${card.agentId}`,
    `Project: ${card.projectRoot}`,
    `Runtime: ${card.harness} via ${card.transport}${card.sessionId ? ` (${card.sessionId})` : ""}`,
  ];

  if (card.description) {
    lines.push(`About: ${card.description}`);
  }
  if (card.selector) {
    lines.push(`Selector: ${card.selector}`);
  }
  if (card.defaultSelector) {
    lines.push(`Default: ${card.defaultSelector}`);
  }
  if (card.branch) {
    lines.push(`Branch: ${card.branch}`);
  }
  lines.push(`Broker: ${card.brokerRegistered ? "registered" : "offline"}`);
  if (card.inboxConversationId) {
    lines.push(`Inbox: ${card.inboxConversationId}`);
  }
  if (card.returnAddress.conversationId) {
    lines.push(`Reply-To: ${card.returnAddress.conversationId}`);
  }
  if (card.skills && card.skills.length > 0) {
    lines.push(`Skills: ${card.skills.map((skill) => skill.name).join(", ")}`);
  }
  if (card.documentationUrl) {
    lines.push(`Docs: ${card.documentationUrl}`);
  }

  return lines.join("\n");
}
