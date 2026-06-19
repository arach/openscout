import type { AgentHarness } from "./actors.js";
import type { MetadataMap, ScoutId } from "./common.js";
import type { ScoutPermissionProfile } from "./permission-policy.js";

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

export type InvocationSessionPolicy =
  | "new"
  | "reuse"
  | "existing"
  | "fork"
  /** @deprecated use reuse */
  | "any";

export type InvocationForkSourceKind =
  | "native_thread_clone"
  | "scout_state_snapshot";

export interface InvocationForkContextOptions {
  maxMessages?: number;
  maxBytes?: number;
  includeBrokerRecords?: boolean;
  includeObservedHarnessMaterial?: boolean;
}

export interface InvocationSessionLineage {
  parentSessionId?: ScoutId;
  parentHarnessThreadId?: string;
  forkSourceKind?: InvocationForkSourceKind;
  forkSourceId?: ScoutId | string;
  forkedAt?: number;
  metadata?: MetadataMap;
}

export interface InvocationExecutionPreference {
  harness?: AgentHarness;
  model?: string;
  permissionProfile?: ScoutPermissionProfile;
  /**
   * Controls whether work should enter fresh model context, opportunistically
   * reuse a warm compatible session, continue one exact session, or fork a new
   * execution session from prior state. The legacy "any" value is a
   * compatibility alias for "reuse"; exact continuation requires targetSessionId.
   */
  session?: InvocationSessionPolicy;
  targetSessionId?: ScoutId;
  forkFromStateId?: ScoutId;
  forkFromSessionId?: ScoutId;
  forkContext?: InvocationForkContextOptions;
  lineage?: InvocationSessionLineage;
}

export interface InvocationRequest {
  id: ScoutId;
  requesterId: ScoutId;
  requesterNodeId: ScoutId;
  targetAgentId: ScoutId;
  targetNodeId?: ScoutId;
  action: InvocationAction;
  task: string;
  collaborationRecordId?: ScoutId;
  conversationId?: ScoutId;
  messageId?: ScoutId;
  context?: MetadataMap;
  execution?: InvocationExecutionPreference;
  ensureAwake: boolean;
  stream: boolean;
  timeoutMs?: number;
  labels?: string[];
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
  labels?: string[];
  metadata?: MetadataMap;
}

export function normalizeInvocationSessionPolicy(
  policy: InvocationSessionPolicy | string | null | undefined,
): InvocationSessionPolicy | undefined {
  switch (policy) {
    case "new":
    case "reuse":
    case "existing":
    case "fork":
    case "any":
      return policy;
    default:
      return undefined;
  }
}

export function effectiveInvocationSessionPolicy(
  execution: Pick<
    InvocationExecutionPreference,
    "session" | "targetSessionId" | "forkFromStateId" | "forkFromSessionId"
  > | null | undefined,
): Exclude<InvocationSessionPolicy, "any"> {
  if (!execution) return "new";
  if (execution.forkFromStateId || execution.forkFromSessionId || execution.session === "fork") {
    return "fork";
  }
  if (execution.targetSessionId || execution.session === "existing") {
    return "existing";
  }
  if (execution.session === "reuse" || execution.session === "any") {
    return "reuse";
  }
  return "new";
}

export function validateInvocationExecutionPreference(
  execution: InvocationExecutionPreference | null | undefined,
): string[] {
  if (!execution) return [];

  const errors: string[] = [];
  const policy = effectiveInvocationSessionPolicy(execution);

  if (policy === "existing" && !execution.targetSessionId) {
    errors.push("session existing requires targetSessionId");
  }
  if (policy === "fork" && !execution.forkFromStateId && !execution.forkFromSessionId) {
    errors.push("session fork requires forkFromStateId or forkFromSessionId");
  }
  if (execution.session === "new" && execution.targetSessionId) {
    errors.push("session new cannot target an existing session");
  }
  if (execution.session === "new" && (execution.forkFromStateId || execution.forkFromSessionId)) {
    errors.push("session new cannot include fork source ids");
  }

  return errors;
}
