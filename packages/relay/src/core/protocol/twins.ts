export interface TwinInvocation {
  task: string;
  context?: Record<string, unknown>;
}

export interface TwinFeedback {
  summary?: string;
  progress?: number;
  confidence?: number;
  handoffState?: string;
  updatedAt: number;
}

export interface TwinStatusSnapshot {
  twinId: string;
  state: "offline" | "idle" | "active" | "waiting" | "degraded";
  feedback?: TwinFeedback;
  lastActiveAt?: number;
  pendingWork?: string[];
}

export interface TwinSubscription {
  unsubscribe(): void;
}

export interface Twin {
  invoke(task: string, context?: Record<string, unknown>): Promise<void>;
  send(message: string): Promise<void>;
  status(): Promise<TwinStatusSnapshot>;
  summarize(scope?: string): Promise<string>;
  remember(fact: string): Promise<void>;
  tick(reason: string): Promise<void>;
  subscribe(listener: (status: TwinStatusSnapshot) => void): TwinSubscription;
}

export interface ProjectTwin extends Twin {
  kind: "project";
  projectRoot: string;
  protocol: string;
}

export interface ProjectTwinRecord {
  twinId: string;
  kind: "project";
  runtime: "tmux-claude";
  protocol: "relay";
  harness: TwinHarnessId;
  sessionAdapter: TwinSessionAdapterId;
  agentEngine: TwinAgentEngineId;
  project: string;
  projectRoot: string;
  tmuxSession: string;
  cwd: string;
  startedAt: number;
  systemPrompt?: string;
}

export interface ProjectTwinRuntimeEntry extends ProjectTwinRecord {
  alive: boolean;
  uptimeSeconds: number;
}

export interface ProjectTwinStartOptions {
  hub: string;
  projectPath: string;
  twinName: string;
  task?: string;
}

export interface ProjectTwinStartResult {
  status: "started" | "already_running";
  record: ProjectTwinRecord;
}

export interface ProjectTwinInvokeOptions {
  asker: string;
  task: string;
  context?: Record<string, unknown>;
  timeoutSeconds?: number;
}

export interface ProjectTwinInvokeResult {
  twin: ProjectTwinRecord;
  flightId: string;
  response: string;
  respondedAt: number;
}

export interface ProjectTwinStopResult {
  status: "stopped" | "already_stopped" | "not_found";
  twinName: string;
  record?: ProjectTwinRecord;
}

export interface ProjectTwinRuntime {
  loadTwins(): Promise<Record<string, ProjectTwinRecord>>;
  isTwinAlive(twinName: string): Promise<boolean>;
  startProjectTwin(options: ProjectTwinStartOptions): Promise<ProjectTwinStartResult>;
  invokeProjectTwin(twinName: string, options: ProjectTwinInvokeOptions): Promise<ProjectTwinInvokeResult>;
  tickProjectTwin(twinName: string, reason: string): Promise<boolean>;
  stopProjectTwin(twinName: string): Promise<ProjectTwinStopResult>;
  stopAllProjectTwins(): Promise<ProjectTwinStopResult[]>;
  listProjectTwins(): Promise<ProjectTwinRuntimeEntry[]>;
  cleanupDeadTwins(): Promise<string[]>;
}
import type {
  TwinAgentEngineId,
  TwinHarnessId,
  TwinSessionAdapterId,
} from "./runtime-matrix.js";
