import type { WakePolicy } from "./actors.js";
import type { AdvertiseScope, DeliveryTransport, ScoutId } from "./common.js";

export type ScoutDispatchKind = "ambiguous" | "unknown" | "unparseable" | "unavailable";

export type ScoutCandidateEndpointState = "online" | "offline" | "unknown";

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
