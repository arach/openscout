import {
  invokeAcpAgent,
  type AcpAgentInvocationResult,
} from "./acp-agent-invocation.js";

export interface KimiAcpInvocationOptions {
  sessionId: string;
  poolKey?: string;
  resumeSessionId?: string;
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
    label: "Kimi Code ACP",
  });
}
