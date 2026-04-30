import { brokerClient } from "./broker/client.ts";
import type { AgentInfo, DeliverParams } from "./types.ts";

export type ScoutTargetInput = string | Pick<AgentInfo, "id" | "label">;

export interface ResolvedScoutTarget {
  routeTarget: DeliverParams["target"];
  displayTarget: string;
}

export async function resolveScoutTarget(
  target: ScoutTargetInput,
): Promise<ResolvedScoutTarget | null> {
  if (typeof target !== "string") {
    const id = target.id.trim();
    if (!id) return null;
    return {
      routeTarget: { kind: "agent_id", agentId: id },
      displayTarget: target.label?.trim() || id,
    };
  }

  const normalized = target.trim();
  if (!normalized || normalized === "@") {
    return null;
  }

  if (normalized.startsWith("@")) {
    return {
      routeTarget: { kind: "agent_label", label: normalized },
      displayTarget: normalized,
    };
  }

  const snapshot = await brokerClient.getSnapshot();
  const exactAgent = snapshot.agents[normalized];
  if (exactAgent) {
    return {
      routeTarget: { kind: "agent_id", agentId: normalized },
      displayTarget: exactAgent.selector ?? exactAgent.defaultSelector ?? normalized,
    };
  }

  return {
    routeTarget: { kind: "agent_label", label: normalized },
    displayTarget: normalized,
  };
}
