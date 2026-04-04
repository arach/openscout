export type LocalAgentHarnessId = "relay-native" | "pi";
export type LocalAgentSessionAdapterId = "tmux" | "host" | "daemon";
export type LocalAgentEngineId = "claude" | "codex" | "unknown";

export interface LocalAgentRuntimeDescriptor {
  harness: LocalAgentHarnessId;
  sessionAdapter: LocalAgentSessionAdapterId;
  agentEngine: LocalAgentEngineId;
}
