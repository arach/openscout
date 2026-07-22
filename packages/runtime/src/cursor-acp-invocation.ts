import { createCursorAcpAdapter } from "@openscout/agent-sessions";

import { invokeAcpAgent, type AcpAgentInvocationResult } from "./acp-agent-invocation.js";

export interface CursorAcpInvocationOptions {
  sessionId: string;
  externalSessionId?: string;
  cwd: string;
  prompt: string;
  name?: string;
  timeoutMs?: number;
}

export type CursorAcpInvocationResult = AcpAgentInvocationResult;

export async function invokeCursorAcpAgent(
  options: CursorAcpInvocationOptions,
): Promise<CursorAcpInvocationResult> {
  return await invokeAcpAgent({
    ...options,
    adapterType: "cursor-acp",
    createAdapter: createCursorAcpAdapter,
    label: "Cursor ACP",
    adapterOptions: {
      cursorExtensions: true,
      cursorInteractionMode: "safe_reject",
      permissionMode: "safe_reject",
    },
  });
}
