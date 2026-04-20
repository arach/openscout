export type AgentDisplayState = "offline" | "available" | "working";

export function normalizeAgentState(state: string | null): AgentDisplayState {
  if (state === "working") {
    return "working";
  }
  if (!state || state === "offline") {
    return "offline";
  }
  return "available";
}

export function isAgentOnline(state: string | null): boolean {
  return normalizeAgentState(state) !== "offline";
}

export function agentStateLabel(state: string | null): string {
  switch (normalizeAgentState(state)) {
    case "working":
      return "Working";
    case "available":
      return "Available";
    default:
      return "Offline";
  }
}
