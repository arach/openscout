import type {
  LocalAgentEngineId,
  LocalAgentHarnessId,
  LocalAgentSessionAdapterId,
} from "./runtime-matrix.js";

export interface LocalAgentInvocation {
  task: string;
  context?: Record<string, unknown>;
}

export interface LocalAgentFeedback {
  summary?: string;
  progress?: number;
  confidence?: number;
  handoffState?: string;
  updatedAt: number;
}

export interface LocalAgentStatusSnapshot {
  agentId: string;
  state: "offline" | "idle" | "active" | "waiting" | "degraded";
  feedback?: LocalAgentFeedback;
  lastActiveAt?: number;
  pendingWork?: string[];
}

export interface LocalAgentSubscription {
  unsubscribe(): void;
}

export interface LocalAgentHandle {
  invoke(task: string, context?: Record<string, unknown>): Promise<void>;
  send(message: string): Promise<void>;
  status(): Promise<LocalAgentStatusSnapshot>;
  summarize(scope?: string): Promise<string>;
  remember(fact: string): Promise<void>;
  tick(reason: string): Promise<void>;
  subscribe(listener: (status: LocalAgentStatusSnapshot) => void): LocalAgentSubscription;
}

export interface LocalAgent extends LocalAgentHandle {
  kind: "project";
  projectRoot: string;
  protocol: string;
}

export interface LocalAgentRecord {
  agentId: string;
  kind: "project";
  runtime: "tmux-claude";
  protocol: "relay";
  harness: LocalAgentHarnessId;
  sessionAdapter: LocalAgentSessionAdapterId;
  agentEngine: LocalAgentEngineId;
  project: string;
  projectRoot: string;
  tmuxSession: string;
  cwd: string;
  startedAt: number;
  systemPrompt?: string;
}

export interface LocalAgentRuntimeEntry extends LocalAgentRecord {
  alive: boolean;
  uptimeSeconds: number;
}

export interface LocalAgentStartOptions {
  hub: string;
  projectPath: string;
  agentName: string;
  task?: string;
}

export interface LocalAgentStartResult {
  status: "started" | "already_running";
  record: LocalAgentRecord;
}

export interface LocalAgentInvokeOptions {
  asker: string;
  task: string;
  context?: Record<string, unknown>;
  timeoutSeconds?: number;
}

export interface LocalAgentInvokeResult {
  localAgent: LocalAgentRecord;
  flightId: string;
  response: string;
  respondedAt: number;
}

export interface LocalAgentStopResult {
  status: "stopped" | "already_stopped" | "not_found";
  agentName: string;
  record?: LocalAgentRecord;
}

export interface LocalAgentRuntime {
  loadLocalAgents(): Promise<Record<string, LocalAgentRecord>>;
  isLocalAgentAlive(agentName: string): Promise<boolean>;
  startLocalAgent(options: LocalAgentStartOptions): Promise<LocalAgentStartResult>;
  invokeLocalAgent(agentName: string, options: LocalAgentInvokeOptions): Promise<LocalAgentInvokeResult>;
  tickLocalAgent(agentName: string, reason: string): Promise<boolean>;
  stopLocalAgent(agentName: string): Promise<LocalAgentStopResult>;
  stopAllLocalAgents(): Promise<LocalAgentStopResult[]>;
  listLocalAgents(): Promise<LocalAgentRuntimeEntry[]>;
  cleanupDeadLocalAgents(): Promise<string[]>;
}
