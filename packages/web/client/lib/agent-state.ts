export type AgentDisplayState = "not_ready" | "ready" | "working";
export type AgentVisualState = "unavailable" | "available" | "active";

export function normalizeAgentState(state: string | null): AgentDisplayState {
  const value = state?.trim().toLowerCase();
  if (value === "working" || value === "active") {
    return "working";
  }
  if (
    !value ||
    value === "offline" ||
    value === "not_ready" ||
    value === "unready" ||
    value === "unavailable" ||
    value === "error" ||
    value === "missing"
  ) {
    return "not_ready";
  }
  return "ready";
}

export function agentStateCssToken(state: string | null): AgentVisualState {
  switch (normalizeAgentState(state)) {
    case "working":
      return "active";
    case "ready":
      return "available";
    case "not_ready":
      return "unavailable";
  }
}

export function isAgentOnline(state: string | null): boolean {
  return normalizeAgentState(state) !== "not_ready";
}

export function agentStateLabel(state: string | null): string {
  switch (normalizeAgentState(state)) {
    case "working":
      return "Active";
    case "ready":
      return "";
    case "not_ready":
      return "Unavailable";
  }
}
