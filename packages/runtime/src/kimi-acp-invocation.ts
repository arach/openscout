import { createKimiAcpAdapter } from "@openscout/agent-sessions";

import {
  invokeAcpAgent,
  type AcpAgentInvocationResult,
} from "./acp-agent-invocation.js";

export interface KimiAcpInvocationOptions {
  sessionId: string;
  externalSessionId?: string;
  cwd: string;
  prompt: string;
  name?: string;
  timeoutMs?: number;
}

export type KimiAcpInvocationResult = AcpAgentInvocationResult;

export async function invokeKimiAcpAgent(
  options: KimiAcpInvocationOptions,
): Promise<KimiAcpInvocationResult> {
  return await invokeAcpAgent({
    ...options,
    adapterType: "kimi-acp",
    createAdapter: createKimiAcpAdapter,
    label: "Kimi Code ACP",
  });
}
