import type { AgentHarness } from "@openscout/protocol";

export type ScoutAskWorkspace = "same" | "new_worktree";
export type ScoutAskSession = "reuse" | "new" | "fork";

export type ScoutAskSenderContext = {
  agentId?: string;
  project?: string;
  cwd?: string;
  worktree?: "same" | "isolated" | "unknown";
  lastTargetId?: string;
};

type ScoutAskCommandBase = {
  senderId: string;
  body: string;
  harness?: AgentHarness;
  workspace?: ScoutAskWorkspace;
  session?: ScoutAskSession;
  forkFromStateId?: string;
  senderContext?: ScoutAskSenderContext;
  workItem?: {
    title: string;
    summary?: string;
    priority?: "low" | "normal" | "high" | "urgent";
    labels?: string[];
    parentId?: string;
    acceptanceState?: "none" | "pending" | "accepted" | "reopened";
    metadata?: Record<string, unknown>;
  };
  labels?: string[];
  replyToSessionId?: string;
  channel?: string;
  shouldSpeak?: boolean;
  currentDirectory?: string;
  source?: string;
};

type ScoutAskTargetInput =
  | { to: string; projectPath?: never }
  | { to?: never; projectPath: string }
  | { to?: undefined; projectPath?: undefined };

export type ScoutAskCommand = ScoutAskCommandBase & ScoutAskTargetInput;

export type ScoutAskState =
  | "queued"
  | "completed"
  | "failed"
  | "ambiguous";

export type ScoutAskNextCall = {
  tool: "agents_resolve" | "agents_search" | "agents_start";
  arguments: Record<string, unknown>;
  reason: string;
};

export type ScoutAskError = {
  code: "broker_unreachable" | "invalid_request";
  message: string;
};

export type ScoutAskReceipt = {
  ok: boolean;
  state: ScoutAskState;
  ids: {
    targetAgentId?: string;
    invocationId?: string;
    flightId?: string;
    conversationId?: string;
    messageId?: string;
    workId?: string;
    bindingRef?: string;
    sessionAlias?: string;
  };
  delivery?: "none" | "inline" | "mcp_notification";
  notification?: {
    method: "notifications/scout/reply";
    status: "scheduled" | "not_scheduled";
  };
  next?: ScoutAskNextCall;
  error?: ScoutAskError;
};
