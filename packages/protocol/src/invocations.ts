import type { MetadataMap, ScoutId } from "./common.js";

export type InvocationAction =
  | "consult"
  | "execute"
  | "summarize"
  | "status"
  | "wake";

export type FlightState =
  | "queued"
  | "waking"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface InvocationRequest {
  id: ScoutId;
  requesterId: ScoutId;
  targetAgentId: ScoutId;
  action: InvocationAction;
  task: string;
  conversationId?: ScoutId;
  messageId?: ScoutId;
  context?: MetadataMap;
  ensureAwake: boolean;
  stream: boolean;
  timeoutMs?: number;
  createdAt: number;
  metadata?: MetadataMap;
}

export interface FlightRecord {
  id: ScoutId;
  invocationId: ScoutId;
  requesterId: ScoutId;
  targetAgentId: ScoutId;
  state: FlightState;
  summary?: string;
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  metadata?: MetadataMap;
}
