import { spawn } from "node:child_process";
import { sendTmuxPrompt } from "@openscout/runtime/local-agents";

import { readProjectedRelayAgentSessions } from "../core/projections/agents.js";
import { createTmuxClaudeLocalAgentRuntime } from "../core/local-agents/tmux-claude-local-agent-runtime.js";

export type RelayTargetDeliveryStatus = "delivered" | "nudged" | "queued";

export async function deliverRelayMessageToTarget(
  hub: string,
  name: string,
  from: string,
  message: string,
  channel?: string,
  messageId?: string,
): Promise<RelayTargetDeliveryStatus> {
  const localAgentRuntime = createTmuxClaudeLocalAgentRuntime(hub);

  try {
    const agents = await readProjectedRelayAgentSessions(hub);
    const agent = agents[name];
    if (agent?.sessionId) {
      const replyCmd = channel === "voice" ? "speak" : "send";
      const idRef = messageId ? ` (message: ${messageId})` : "";
      const nudge = `You have a new relay message from ${from}${idRef}. Check the channel and respond.\n\nRead recent: openscout relay read -n 5 --as ${name}\nReply via: openscout relay ${replyCmd} --as ${name} "@${from} <your response>"`;
      const child = spawn("claude", ["--resume", agent.sessionId, "--print", nudge], {
        cwd: agent.cwd || process.cwd(),
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      return "delivered";
    }

    if (agent?.pane) {
      const preview = message.length > 80 ? `${message.slice(0, 80)}…` : message;
      sendTmuxPrompt(agent.pane, `[relay] ${from}: ${preview}`);
      return "delivered";
    }
  } catch {
    // fall through to localAgent tick
  }

  const idRef = messageId ? ` (message: ${messageId})` : "";
  const agentTicked = await localAgentRuntime.tickLocalAgent(
    name,
    `new relay message from ${from}${idRef}`,
  );
  if (agentTicked) {
    return "nudged";
  }

  return "queued";
}
