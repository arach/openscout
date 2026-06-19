import type {
  AgentDefinition,
  AgentEndpoint,
  ScoutCandidateEndpointState,
} from "@openscout/protocol";

import { isA2AHttpEndpoint } from "./a2a-http-endpoint.js";
import { isBrokerRunnableLocalAgentTransport } from "./local-agent-transports.js";
import type { RuntimeRegistrySnapshot } from "./registry.js";

export const ENDPOINT_SESSION_ALIAS_METADATA_KEYS = [
  "sessionId",
  "externalSessionId",
  "threadId",
  "nativeSessionId",
  "runtimeSessionId",
  "runtimeInstanceId",
  "tmuxSession",
  "pairingSessionId",
] as const;

function metadataStringValue(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function endpointStartedAt(endpoint: AgentEndpoint): number {
  const value = endpoint.metadata?.lastStartedAt;
  return typeof value === "number" ? value : 0;
}

export function endpointTerminalAt(endpoint: AgentEndpoint): number {
  const completedAt = endpoint.metadata?.lastCompletedAt;
  const failedAt = endpoint.metadata?.lastFailedAt;
  return Math.max(
    typeof completedAt === "number" ? completedAt : 0,
    typeof failedAt === "number" ? failedAt : 0,
  );
}

export function endpointLifecycleAt(endpoint: AgentEndpoint): number {
  return Math.max(endpointStartedAt(endpoint), endpointTerminalAt(endpoint));
}

export type EndpointStateLike =
  | AgentEndpoint["state"]
  | "working"
  | "registered"
  | "attaching"
  | "waking"
  | "unreachable"
  | "failed"
  | "superseded"
  | "stopped"
  | undefined;

export function isEndpointOnlineState(state: EndpointStateLike): boolean {
  return state === "active" || state === "idle" || state === "waiting" || state === "working";
}

export function endpointCandidateState(
  state: EndpointStateLike,
): ScoutCandidateEndpointState {
  if (isEndpointOnlineState(state)) {
    return "online";
  }
  if (state === "offline") {
    return "offline";
  }
  if (
    state === "unreachable"
    || state === "failed"
    || state === "superseded"
    || state === "stopped"
  ) {
    return "offline";
  }
  return "unknown";
}

export function endpointAvailabilityScore(endpoint: { state?: EndpointStateLike } | null | undefined): number {
  switch (endpoint?.state) {
    case "active":
    case "working":
      return 40;
    case "idle":
      return 30;
    case "waiting":
      return 20;
    case "registered":
    case "attaching":
    case "waking":
      return 10;
    case "offline":
    case "unreachable":
    case "failed":
    case "superseded":
    case "stopped":
      return 0;
    default:
      return endpoint ? 10 : 0;
  }
}

export type EndpointClassification = {
  candidateState: ScoutCandidateEndpointState;
  reachable: boolean;
  runnable: boolean;
  attachable: boolean;
  wakeable: boolean;
  busy: boolean;
  supportedTransport: boolean;
  reasons: string[];
  score: number;
};

export function classifyEndpoint(
  endpoint: AgentEndpoint | null | undefined,
  options: {
    agent?: AgentDefinition;
    alive?: boolean;
  } = {},
): EndpointClassification {
  const candidateState = endpointCandidateState(endpoint?.state);
  const onlineState = isEndpointOnlineState(endpoint?.state);
  const stale = !endpoint || endpoint.metadata?.staleLocalRegistration === true;
  const busy = endpoint?.state === "active" || endpoint?.state === "waiting";
  const supportedTransport = Boolean(
    endpoint
      && (
        endpoint.transport === "pairing_bridge"
        || isA2AHttpEndpoint(endpoint)
        || isBrokerRunnableLocalAgentTransport(endpoint.transport)
      ),
  );
  const alive = options.alive ?? onlineState;
  const reachable = Boolean(endpoint && !stale && alive && candidateState === "online");
  const attachable = Boolean(endpoint && !stale && supportedTransport && (reachable || endpoint.state !== "offline"));
  const runnable = Boolean(reachable && supportedTransport && !busy);
  const wakeable = options.agent?.wakePolicy !== "manual";
  const reasons: string[] = [];
  if (!endpoint) reasons.push("missing_endpoint");
  if (stale) reasons.push("stale_registration");
  if (!alive) reasons.push("not_alive");
  if (!supportedTransport && endpoint) reasons.push("unsupported_transport");
  if (busy) reasons.push("busy");

  return {
    candidateState,
    reachable,
    runnable,
    attachable,
    wakeable,
    busy,
    supportedTransport,
    reasons,
    score: endpointAvailabilityScore(endpoint),
  };
}

export function latestEndpointForAgent(
  snapshot: RuntimeRegistrySnapshot,
  agentId: string,
): AgentEndpoint | null {
  const candidates = Object.values(snapshot.endpoints).filter((endpoint) => endpoint.agentId === agentId);
  return [...candidates].sort((left, right) => endpointLifecycleAt(right) - endpointLifecycleAt(left))[0] ?? null;
}

export function isRetiredLocalAgent(agent: AgentDefinition | undefined): boolean {
  return agent?.metadata?.retiredFromFleet === true;
}

export function isInactiveLocalAgent(agent: AgentDefinition | undefined): boolean {
  return isRetiredLocalAgent(agent) || agent?.metadata?.staleLocalRegistration === true;
}

export function isStaleLocalEndpoint(
  snapshot: RuntimeRegistrySnapshot,
  endpoint: AgentEndpoint | null,
): boolean {
  if (!endpoint || endpoint.metadata?.staleLocalRegistration === true) {
    return true;
  }

  return isInactiveLocalAgent(snapshot.agents[endpoint.agentId]);
}

export function homeEndpointForAgent(
  snapshot: RuntimeRegistrySnapshot,
  agentId: string,
): AgentEndpoint | null {
  const candidates = Object.values(snapshot.endpoints).filter((endpoint) => (
    endpoint.agentId === agentId && !isStaleLocalEndpoint(snapshot, endpoint)
  ));
  return [...candidates].sort(compareHomeEndpointPreference)[0] ?? null;
}

export function endpointSessionAliasValues(endpoint: AgentEndpoint): string[] {
  const values = [
    endpoint.id,
    endpoint.sessionId,
    ...ENDPOINT_SESSION_ALIAS_METADATA_KEYS.map((key) => metadataStringValue(endpoint.metadata, key)),
  ];
  const aliases = values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(aliases)];
}

export function endpointMatchesTargetSession(endpoint: AgentEndpoint, sessionId: string): boolean {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return false;
  }
  return endpointSessionAliasValues(endpoint).includes(normalizedSessionId);
}

export function localEndpointPreferenceRank(endpoint: AgentEndpoint): number {
  if (endpoint.transport === "tmux") {
    return 0;
  }
  if (endpoint.transport === "claude_stream_json") {
    return 50;
  }
  return 10;
}

export function compareLocalEndpointPreference(left: AgentEndpoint, right: AgentEndpoint): number {
  const rankDelta = localEndpointPreferenceRank(left) - localEndpointPreferenceRank(right);
  if (rankDelta !== 0) {
    return rankDelta;
  }
  return endpointLifecycleAt(right) - endpointLifecycleAt(left);
}

function homeEndpointStateRank(state: EndpointStateLike): number {
  switch (state) {
    case "active":
    case "working":
      return 0;
    case "idle":
      return 1;
    case "waiting":
      return 2;
    case "attaching":
    case "waking":
      return 3;
    case "registered":
      return 4;
    case "offline":
    case "unreachable":
    case "failed":
    case "superseded":
    case "stopped":
      return 6;
    default:
      return 5;
  }
}

function compareHomeEndpointPreference(left: AgentEndpoint, right: AgentEndpoint): number {
  const leftPreferred = left.metadata?.preferred === true;
  const rightPreferred = right.metadata?.preferred === true;
  if (leftPreferred !== rightPreferred) {
    return leftPreferred ? -1 : 1;
  }
  const stateDelta = homeEndpointStateRank(left.state) - homeEndpointStateRank(right.state);
  if (stateDelta !== 0) {
    return stateDelta;
  }
  return endpointLifecycleAt(right) - endpointLifecycleAt(left);
}
