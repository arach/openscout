export type TwinHarnessId = "relay-native" | "pi";
export type TwinSessionAdapterId = "tmux" | "host" | "daemon";
export type TwinAgentEngineId = "claude" | "codex" | "unknown";

export interface TwinRuntimeDescriptor {
  harness: TwinHarnessId;
  sessionAdapter: TwinSessionAdapterId;
  agentEngine: TwinAgentEngineId;
}
