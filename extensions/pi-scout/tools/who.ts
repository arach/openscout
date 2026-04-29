import { brokerClient } from "../broker/client.ts";
import type { AgentInfo } from "../types.ts";

export const scoutWhoTool = {
  name: "scout_who",
  label: "Scout Who",
  description:
    "List known Scout agents registered with the local broker. " +
    "Shows agent ID, label, state, and harness type.",

  parameters: {},

  async execute(
    _id: string,
    _params: Record<string, never>,
    _signal: AbortSignal,
    _onUpdate: (update: unknown) => void,
    _ctx: unknown,
  ) {
    const snapshot = await brokerClient.getSnapshot();

    const agents: AgentInfo[] = Object.entries(snapshot.agents).map(
      ([id, agent]) => {
        const endpoints = Object.values(snapshot.endpoints).filter(
          (e) => e.agentId === id,
        );
        return {
          id,
          label: agent.selector ?? id,
          state: endpoints[0]?.state ?? "offline",
          harness: endpoints[0]?.harness,
          nodeId: agent.authorityNodeId,
        };
      },
    );

    if (agents.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No agents found." }],
        details: { agents: [] },
      };
    }

    const lines = agents.map(
      (a) =>
        `${a.label} · ${a.state}${a.harness ? ` · ${a.harness}` : ""}`,
    );

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { agents },
    };
  },
};
