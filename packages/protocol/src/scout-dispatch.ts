import type { AdvertiseScope, DeliveryTransport, ScoutId } from "./common.js";

export type ScoutDispatchKind = "ambiguous" | "unknown" | "unparseable";

export type ScoutCandidateEndpointState = "online" | "offline" | "unknown";

export interface ScoutDispatchCandidate {
  agentId: ScoutId;
  displayName: string;
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

export interface ScoutDispatchEnvelope {
  kind: ScoutDispatchKind;
  askedLabel: string;
  detail: string;
  candidates: ScoutDispatchCandidate[];
  dispatchedAt: number;
  dispatcherNodeId: ScoutId;
}

export interface ScoutDispatchRecord extends ScoutDispatchEnvelope {
  id: ScoutId;
  invocationId?: ScoutId;
  conversationId?: ScoutId;
  requesterId?: ScoutId;
}
