import { createGrokAcpAdapter } from "@openscout/agent-sessions";

import {
  invokeAcpAgent,
  type AcpAgentInvocationResult,
} from "./acp-agent-invocation.js";

export interface GrokAcpInvocationOptions {
  sessionId: string;
  cwd: string;
  prompt: string;
  name?: string;
  timeoutMs?: number;
}

export type GrokAcpInvocationResult = AcpAgentInvocationResult;

export async function invokeGrokAcpAgent(
  options: GrokAcpInvocationOptions,
): Promise<GrokAcpInvocationResult> {
  return await invokeAcpAgent({
    ...options,
    adapterType: "grok-acp",
    createAdapter: createGrokAcpAdapter,
    label: "Grok ACP",
  });
}
