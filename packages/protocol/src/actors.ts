import type {
  ActorKind,
  AdvertiseScope,
  AgentState,
  MetadataMap,
  ScoutId,
} from "./common.js";

export type AgentClass =
  | "general"
  | "builder"
  | "reviewer"
  | "researcher"
  | "operator"
  | "bridge"
  | "system";

export type AgentCapability =
  | "chat"
  | "invoke"
  | "deliver"
  | "speak"
  | "listen"
  | "bridge"
  | "summarize"
  | "review"
  | "execute";

export type AgentHarness =
  | "codex"
  | "claude"
  | "native"
  | "worker"
  | "bridge"
  | "http";

export type WakePolicy = "manual" | "on_demand" | "keep_warm";

export interface ActorIdentity {
  id: ScoutId;
  kind: ActorKind;
  displayName: string;
  handle?: string;
  labels?: string[];
  metadata?: MetadataMap;
}

export interface AgentDefinition extends ActorIdentity {
  kind: "agent";
  agentClass: AgentClass;
  capabilities: AgentCapability[];
  wakePolicy: WakePolicy;
  homeNodeId: ScoutId;
  authorityNodeId: ScoutId;
  advertiseScope: AdvertiseScope;
  ownerId?: ScoutId;
}

export interface HelperDefinition extends ActorIdentity {
  kind: "helper";
  ownerId: ScoutId;
  nodeId: ScoutId;
  engine: AgentHarness;
  capabilities: AgentCapability[];
}

export interface AgentEndpoint {
  id: ScoutId;
  agentId: ScoutId;
  nodeId: ScoutId;
  harness: AgentHarness;
  transport: "local_socket" | "http" | "websocket" | "codex_exec" | "claude_resume" | "tmux";
  state: AgentState;
  address?: string;
  sessionId?: string;
  pane?: string;
  cwd?: string;
  projectRoot?: string;
  metadata?: MetadataMap;
}
