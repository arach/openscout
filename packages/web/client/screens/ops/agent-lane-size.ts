export type AgentLaneSize = "sm" | "md" | "lg";

const LANE_SIZE_SET = new Set<AgentLaneSize>(["sm", "md", "lg"]);

export function readAgentLaneSize(search = window.location.search): AgentLaneSize {
  const params = new URLSearchParams(search);
  const raw = (params.get("lanes") ?? params.get("size"))?.trim().toLowerCase();
  if (raw && LANE_SIZE_SET.has(raw as AgentLaneSize)) {
    return raw as AgentLaneSize;
  }
  return "lg";
}

export function agentLaneSizeClass(size: AgentLaneSize): string {
  return `s-agent-lanes--lane-${size}`;
}