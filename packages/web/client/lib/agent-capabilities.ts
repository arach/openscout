import type { Agent, AgentChannelMembership } from "./types.ts";
import { formatLabel } from "./text.ts";

export function formatAgentTransportLabel(transport: string | null | undefined): string | null {
  if (!transport) {
    return null;
  }
  if (transport === "claude_channel") {
    return "mesh channel";
  }
  return formatLabel(transport) ?? transport;
}

export function formatChannelMembershipLabel(membership: AgentChannelMembership): string {
  return membership.channel;
}

export function formatChannelMemberships(agent: Agent): string | null {
  if (agent.channelMemberships.length === 0) {
    return null;
  }
  return agent.channelMemberships.map(formatChannelMembershipLabel).join(", ");
}
