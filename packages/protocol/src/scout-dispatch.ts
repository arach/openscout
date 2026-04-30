import type { WakePolicy } from "./actors.js";
import type { AdvertiseScope, DeliveryTransport, MetadataMap, ScoutId } from "./common.js";

export type ScoutDispatchKind = "ambiguous" | "unknown" | "unparseable" | "unavailable";

export type ScoutCandidateEndpointState = "online" | "offline" | "unknown";

export type ScoutRouteTargetKind = "agent_id" | "agent_label" | "binding_ref" | "channel" | "broadcast";

export type ScoutRouteAmbiguousPolicy = "reject" | "ask";

export interface ScoutCallerContext {
  actorId?: ScoutId;
  nodeId?: ScoutId;
  displayName?: string;
  handle?: string;
  currentDirectory?: string;
  metadata?: MetadataMap;
}

export type ScoutRouteTarget =
  | { kind: "agent_id"; agentId: ScoutId; value?: string }
  | { kind: "agent_label"; label: string; value?: string }
  | { kind: "binding_ref"; ref: string; value?: string }
  | { kind: "channel"; channel: string; value?: string }
  | { kind: "broadcast"; value?: string };

export interface ScoutRoutePolicy {
  preferLocalNodeId?: ScoutId;
  ambiguous?: ScoutRouteAmbiguousPolicy;
  allowStaleDirectId?: boolean;
}

export type ScoutDispatchUnavailableReason =
  | "manual_wake_required"
  | "retired"
  | "stale_registration"
  | "unknown";

export interface ScoutDispatchCandidate {
  agentId: ScoutId;
  displayName: string;
  label: string;
  authorityNodeId?: ScoutId;
  homeNodeId?: ScoutId;
  advertiseScope?: AdvertiseScope;
  selector?: string | null;
  defaultSelector?: string | null;
  workspace?: string | null;
  node?: string | null;
  projectRoot?: string | null;
  endpointState: ScoutCandidateEndpointState;
  transport?: DeliveryTransport | null;
}

export interface ScoutDispatchUnavailableTarget {
  agentId: ScoutId;
  displayName: string;
  reason: ScoutDispatchUnavailableReason;
  detail: string;
  wakePolicy?: WakePolicy | null;
  endpointState: ScoutCandidateEndpointState;
  transport?: DeliveryTransport | null;
  projectRoot?: string | null;
}

export interface ScoutDispatchEnvelope {
  kind: ScoutDispatchKind;
  askedLabel: string;
  detail: string;
  candidates: ScoutDispatchCandidate[];
  target?: ScoutDispatchUnavailableTarget;
  dispatchedAt: number;
  dispatcherNodeId: ScoutId;
}

export interface ScoutDispatchRecord extends ScoutDispatchEnvelope {
  id: ScoutId;
  invocationId?: ScoutId;
  conversationId?: ScoutId;
  requesterId?: ScoutId;
}
