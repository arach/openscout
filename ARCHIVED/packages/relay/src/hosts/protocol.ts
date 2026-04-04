import type { AgentActionRequest, AgentActionResult } from "../agent-actions/protocol.js";

export type AgentHostId = "claude" | "codex";

export interface HostAgentActionAdapter {
  host: AgentHostId;
  invokeAgentAction(request: AgentActionRequest): Promise<AgentActionResult>;
}
