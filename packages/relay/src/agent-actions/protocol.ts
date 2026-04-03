export type AgentActionKind = "consult" | "execute" | "status" | "summarize" | "tick";

export type AgentActionMode = "persistent" | "ephemeral";

export interface AgentActionRequest {
  agentId: string;
  action: AgentActionKind;
  mode?: AgentActionMode;
  input?: string;
  context?: Record<string, unknown>;
  actor?: string;
  timeoutSeconds?: number;
}

export interface AgentActionResult {
  agentId: string;
  action: AgentActionKind;
  mode: AgentActionMode;
  ok: boolean;
  output: string;
  respondedAt: number;
  runner: string;
  transport: "relay";
  flightId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentActionRunner {
  invokeAgentAction(request: AgentActionRequest): Promise<AgentActionResult>;
}
