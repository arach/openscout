import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { brokerClient } from "../broker/client.ts";
import type { AgentInfo } from "../types.ts";
import type { ScoutRuntime } from "../runtime.ts";

export function createScoutWhoTool(runtime: ScoutRuntime) {
  return {
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
      ctx: ExtensionContext,
    ) {
      await runtime.ensureEngaged(ctx);
      const snapshot = await brokerClient.getSnapshot();

      const agents: AgentInfo[] = Object.entries(snapshot.agents).map(
        ([id, agent]) => {
          const endpoints = Object.values(snapshot.endpoints).filter(
            (e) => e.agentId === id,
          );
          return {
            id,
            label: agent.selector ?? agent.defaultSelector ?? id,
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
}
