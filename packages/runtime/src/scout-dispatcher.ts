import { resolve } from "node:path";

import {
  constructAgentIdentity,
  diagnoseAgentIdentity,
  formatMinimalAgentIdentity,
  OPENSCOUT_COORDINATOR_AGENT_ID,
  parseAgentIdentity,
  SCOUT_DISPATCHER_AGENT_ID,
  type AgentDefinition,
  type AgentEndpoint,
  type AgentIdentity,
  type AgentIdentityCandidate,
  type AgentIdentityDiagnosis,
  type ScoutCandidateEndpointState,
  type ScoutDispatchCandidate,
  type ScoutDispatchEnvelope,
  type ScoutDispatchKind,
  type ScoutRoutePolicy,
  type ScoutRouteTarget,
} from "@openscout/protocol";

import type { createInMemoryControlRuntime } from "./broker.js";

export type RuntimeSnapshot = ReturnType<ReturnType<typeof createInMemoryControlRuntime>["snapshot"]>;

export type BrokerLabelResolution =
  | { kind: "resolved"; agent: AgentDefinition }
  | { kind: "ambiguous"; label: string; candidates: AgentDefinition[] }
  | { kind: "unparseable"; label: string }
  | { kind: "unknown"; label: string };

export interface BrokerRouteTargetInput {
  target?: ScoutRouteTarget | null;
  targetAgentId?: string | null;
  targetSessionId?: string | null;
  targetLabel?: string | null;
  routePolicy?: ScoutRoutePolicy | null;
}

export type BrokerAgentCandidate = AgentIdentityCandidate & {
  agentId: string;
  agent: AgentDefinition;
};

export interface DispatcherHelpers {
  isStale: (agent: AgentDefinition | undefined) => boolean;
  homeEndpointFor: (snapshot: RuntimeSnapshot, agentId: string) => AgentEndpoint | null;
}

function normalizedRouteTargetValue(target: ScoutRouteTarget | null | undefined): string | undefined {
  if (!target) {
    return undefined;
  }
  const direct = target.kind === "agent_id"
    ? target.agentId
    : target.kind === "agent_label"
    ? target.label
    : target.kind === "session_id"
    ? target.sessionId
    : target.kind === "binding_ref"
    ? target.ref
    : target.kind === "project_path"
    ? target.projectPath
    : target.kind === "channel"
    ? target.channel
    : target.value;
  const trimmed = direct?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function askedLabelForRouteTarget(input: BrokerRouteTargetInput): string {
  return normalizedRouteTargetValue(input.target)
    ?? input.targetSessionId?.trim()
    ?? input.targetLabel?.trim()
    ?? input.targetAgentId?.trim()
    ?? "";
}

export function routeChannelForTarget(input: BrokerRouteTargetInput): string | undefined {
  const target = input.target;
  if (!target) {
    return undefined;
  }
  if (target.kind === "broadcast") {
    return "shared";
  }
  if (target.kind !== "channel") {
    return undefined;
  }
  return normalizedRouteTargetValue(target);
}

function metadataStringValue(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isReservedProductIdentity(definitionId: string): boolean {
  return definitionId === SCOUT_DISPATCHER_AGENT_ID
    || definitionId === OPENSCOUT_COORDINATOR_AGENT_ID;
}

function isBareReservedProductIdentity(identity: AgentIdentity): boolean {
  return isReservedProductIdentity(identity.definitionId)
    && !identity.nodeQualifier
    && !identity.workspaceQualifier
    && !identity.profile
    && !identity.harness
    && !identity.model;
}

export function buildAgentLabelCandidates(
  snapshot: RuntimeSnapshot,
  helpers: Pick<DispatcherHelpers, "isStale">,
  options: { includeStale?: boolean } = {},
): BrokerAgentCandidate[] {
  return Object.values(snapshot.agents)
    .filter((agent) => options.includeStale || !helpers.isStale(agent))
    .map((agent) => buildAgentLabelCandidate(snapshot, agent));
}

function preferredEndpointForAgent(
  snapshot: RuntimeSnapshot,
  agentId: string,
): AgentEndpoint | undefined {
  const endpoints = Object.values(snapshot.endpoints ?? {}).filter(
    (endpoint) => endpoint.agentId === agentId,
  );
  return endpoints.find((endpoint) => endpoint.state === "active")
    ?? endpoints.find((endpoint) => endpoint.state === "idle" || endpoint.state === "waiting")
    ?? endpoints[0];
}

function projectRootForAgent(
  snapshot: RuntimeSnapshot,
  agent: AgentDefinition,
): string | undefined {
  const endpoint = preferredEndpointForAgent(snapshot, agent.id);
  return endpoint?.projectRoot?.trim()
    || metadataStringValue(agent.metadata, "projectRoot")
    || endpoint?.cwd?.trim();
}

function normalizeProjectPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? resolve(trimmed) : undefined;
}

function buildAgentLabelCandidate(
  snapshot: RuntimeSnapshot,
  agent: AgentDefinition,
): BrokerAgentCandidate {
  const metadata = agent.metadata ?? {};
  const endpoint = preferredEndpointForAgent(snapshot, agent.id);
  const aliases = [
    agent.selector,
    agent.defaultSelector,
    metadataStringValue(metadata, "selector"),
    metadataStringValue(metadata, "defaultSelector"),
  ].filter((value): value is string => Boolean(value));
  const definitionId = agent.definitionId ?? metadataStringValue(metadata, "definitionId") ?? agent.id;

  return {
    agentId: agent.id,
    agent,
    definitionId,
    nodeQualifier: agent.nodeQualifier ?? metadataStringValue(metadata, "nodeQualifier"),
    workspaceQualifier: agent.workspaceQualifier ?? metadataStringValue(metadata, "workspaceQualifier"),
    harness: endpoint?.harness
      ?? metadataStringValue(endpoint?.metadata, "harness")
      ?? metadataStringValue(metadata, "harness")
      ?? metadataStringValue(metadata, "defaultHarness"),
    profile: metadataStringValue(metadata, "profile"),
    model: metadataStringValue(endpoint?.metadata, "model")
      ?? metadataStringValue(metadata, "model"),
    aliases,
  };
}

function stripHarnessQualifier(identity: AgentIdentity): AgentIdentity | null {
  if (!identity.harness) {
    return null;
  }

  return constructAgentIdentity({
    definitionId: identity.definitionId,
    workspaceQualifier: identity.workspaceQualifier,
    profile: identity.profile,
    model: identity.model,
    nodeQualifier: identity.nodeQualifier,
  });
}

function resolutionFromDiagnosis(
  diagnosis: AgentIdentityDiagnosis<BrokerAgentCandidate>,
  label: string,
): BrokerLabelResolution | null {
  if (diagnosis.kind === "resolved") {
    return { kind: "resolved", agent: diagnosis.match.agent };
  }
  if (diagnosis.kind === "ambiguous") {
    return {
      kind: "ambiguous",
      label,
      candidates: diagnosis.candidates.map((candidate) => candidate.agent),
    };
  }
  return null;
}

export function resolveAgentLabel(
  snapshot: RuntimeSnapshot,
  label: string,
  options: { preferLocalNodeId?: string; helpers: Pick<DispatcherHelpers, "isStale"> },
): BrokerLabelResolution {
  const trimmed = label.trim();
  if (!trimmed) {
    return { kind: "unparseable", label };
  }

  const identity = parseAgentIdentity(trimmed.startsWith("@") ? trimmed : `@${trimmed}`);
  if (!identity) {
    return { kind: "unparseable", label };
  }
  if (isBareReservedProductIdentity(identity)) {
    return { kind: "unknown", label: identity.label };
  }

  const candidates = buildAgentLabelCandidates(snapshot, options.helpers);
  const diagnosis = diagnoseAgentIdentity(identity, candidates);
  const harnessAgnosticIdentity = stripHarnessQualifier(identity);

  if (diagnosis.kind === "resolved") {
    return { kind: "resolved", agent: diagnosis.match.agent };
  }

  if (diagnosis.kind === "unknown") {
    if (harnessAgnosticIdentity) {
      const agnosticResolution = resolutionFromDiagnosis(
        diagnoseAgentIdentity(harnessAgnosticIdentity, candidates),
        identity.label,
      );
      if (agnosticResolution) {
        return agnosticResolution;
      }
    }
    return { kind: "unknown", label: identity.label };
  }

  const preferLocal = options.preferLocalNodeId?.trim();
  if (preferLocal) {
    const localOnly = diagnosis.candidates.filter(
      (candidate) => candidate.agent.authorityNodeId === preferLocal,
    );
    if (localOnly.length === 1) {
      return { kind: "resolved", agent: localOnly[0].agent };
    }
    if (localOnly.length > 1 && localOnly.length < diagnosis.candidates.length) {
      return {
        kind: "ambiguous",
        label: identity.label,
        candidates: localOnly.map((candidate) => candidate.agent),
      };
    }
  }

  return {
    kind: "ambiguous",
    label: identity.label,
    candidates: diagnosis.candidates.map((candidate) => candidate.agent),
  };
}

function endpointRank(endpoint: AgentEndpoint | undefined): number {
  switch (endpoint?.state) {
    case "active":
      return 40;
    case "idle":
      return 30;
    case "waiting":
      return 20;
    case "offline":
      return 0;
    default:
      return 10;
  }
}

function projectCandidateRank(
  snapshot: RuntimeSnapshot,
  agent: AgentDefinition,
  preferLocalNodeId: string | undefined,
): number {
  const endpoint = preferredEndpointForAgent(snapshot, agent.id);
  const nodeRank = preferLocalNodeId && agent.authorityNodeId === preferLocalNodeId ? 100 : 0;
  return nodeRank + endpointRank(endpoint);
}

function resolveProjectPathTarget(
  snapshot: RuntimeSnapshot,
  projectPath: string,
  options: { preferLocalNodeId?: string; helpers: Pick<DispatcherHelpers, "isStale"> },
): BrokerLabelResolution {
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  if (!normalizedProjectPath) {
    return { kind: "unparseable", label: projectPath };
  }

  const candidates = Object.values(snapshot.agents)
    .filter((agent) => !options.helpers.isStale(agent))
    .filter((agent) => normalizeProjectPath(projectRootForAgent(snapshot, agent)) === normalizedProjectPath)
    .map((agent) => ({
      agent,
      rank: projectCandidateRank(snapshot, agent, options.preferLocalNodeId),
    }))
    .sort((left, right) => {
      const rankDelta = right.rank - left.rank;
      if (rankDelta !== 0) return rankDelta;
      return left.agent.id.localeCompare(right.agent.id);
    });

  if (candidates.length === 0) {
    return { kind: "unknown", label: projectPath };
  }

  const first = candidates[0]!;
  const second = candidates[1];
  if (!second || first.rank > second.rank) {
    return { kind: "resolved", agent: first.agent };
  }

  return {
    kind: "ambiguous",
    label: projectPath,
    candidates: candidates
      .filter((candidate) => candidate.rank === first.rank)
      .map((candidate) => candidate.agent),
  };
}

function endpointMatchesSessionId(endpoint: AgentEndpoint, sessionId: string): boolean {
  return endpoint.sessionId?.trim() === sessionId || endpoint.id === sessionId;
}

function resolveSessionTarget(
  snapshot: RuntimeSnapshot,
  sessionId: string,
  options: { helpers: Pick<DispatcherHelpers, "isStale"> },
): BrokerLabelResolution {
  const candidates = Object.values(snapshot.endpoints)
    .filter((endpoint) => endpointMatchesSessionId(endpoint, sessionId))
    .map((endpoint) => snapshot.agents[endpoint.agentId])
    .filter((agent): agent is AgentDefinition => Boolean(agent))
    .map((agent) => agent);
  const unique = [...new Map(candidates.map((agent) => [agent.id, agent])).values()];
  if (unique.length === 0) {
    return { kind: "unknown", label: `session:${sessionId}` };
  }
  if (unique.length === 1) {
    return { kind: "resolved", agent: unique[0]! };
  }
  return {
    kind: "ambiguous",
    label: `session:${sessionId}`,
    candidates: unique,
  };
}

export function resolveBrokerRouteTarget(
  snapshot: RuntimeSnapshot,
  input: BrokerRouteTargetInput,
  options: { preferLocalNodeId?: string; helpers: Pick<DispatcherHelpers, "isStale"> },
): BrokerLabelResolution {
  const policy = input.routePolicy;
  const routeTarget = input.target;
  const preferLocalNodeId = policy?.preferLocalNodeId?.trim() || options.preferLocalNodeId;
  const directId = routeTarget?.kind === "agent_id"
    ? normalizedRouteTargetValue(routeTarget)
    : input.targetAgentId?.trim();

  const directSessionId = routeTarget?.kind === "session_id"
    ? normalizedRouteTargetValue(routeTarget)
    : input.targetSessionId?.trim();
  if (directSessionId) {
    return resolveSessionTarget(snapshot, directSessionId, {
      helpers: options.helpers,
    });
  }

  if (directId) {
    const agent = snapshot.agents[directId];
    if (agent && (policy?.allowStaleDirectId ?? true)) {
      return { kind: "resolved", agent };
    }
    if (agent && !options.helpers.isStale(agent)) {
      return { kind: "resolved", agent };
    }
  }

  const bindingRef = routeTarget?.kind === "binding_ref"
    ? normalizedRouteTargetValue(routeTarget)
    : input.targetLabel?.trim().startsWith("ref:")
    ? input.targetLabel.trim().slice("ref:".length)
    : "";
  if (bindingRef) {
    const normalizedRef = bindingRef.toLowerCase();
    const matches = Object.values(snapshot.flights ?? {}).filter((flight) =>
      flight.id.toLowerCase() === normalizedRef
      || flight.id.toLowerCase().endsWith(normalizedRef)
      || String(flight.metadata?.["bindingRef"] ?? "").toLowerCase() === normalizedRef
    );
    if (matches.length === 1) {
      const agent = snapshot.agents[matches[0]!.targetAgentId];
      return agent ? { kind: "resolved", agent } : { kind: "unknown", label: `ref:${bindingRef}` };
    }
    if (matches.length > 1) {
      return {
        kind: "ambiguous",
        label: `ref:${bindingRef}`,
        candidates: matches
          .map((flight) => snapshot.agents[flight.targetAgentId])
          .filter((agent): agent is AgentDefinition => Boolean(agent)),
      };
    }
    return { kind: "unknown", label: `ref:${bindingRef}` };
  }

  const projectPath = routeTarget?.kind === "project_path"
    ? normalizedRouteTargetValue(routeTarget)
    : "";
  if (projectPath) {
    return resolveProjectPathTarget(snapshot, projectPath, {
      preferLocalNodeId,
      helpers: options.helpers,
    });
  }

  const label = routeTarget?.kind === "agent_label"
    ? normalizedRouteTargetValue(routeTarget) ?? ""
    : input.targetLabel?.trim() || directId || "";
  if (!label) {
    return { kind: "unparseable", label: "" };
  }

  return resolveAgentLabel(snapshot, label, {
    preferLocalNodeId,
    helpers: options.helpers,
  });
}

function normalizeEndpointState(state: AgentEndpoint["state"] | undefined): ScoutCandidateEndpointState {
  if (state === "active" || state === "idle" || state === "waiting") {
    return "online";
  }
  if (state === "offline") {
    return "offline";
  }
  return "unknown";
}

export function summarizeDispatchCandidate(
  agent: AgentDefinition,
  snapshot: RuntimeSnapshot,
  helpers: Pick<DispatcherHelpers, "homeEndpointFor">,
  label: string,
): ScoutDispatchCandidate {
  const endpoint = helpers.homeEndpointFor(snapshot, agent.id);
  return {
    agentId: agent.id,
    displayName: agent.displayName ?? agent.id,
    label,
    authorityNodeId: agent.authorityNodeId,
    homeNodeId: agent.homeNodeId,
    advertiseScope: agent.advertiseScope,
    selector: metadataStringValue(agent.metadata, "selector") ?? null,
    defaultSelector: metadataStringValue(agent.metadata, "defaultSelector") ?? null,
    workspace: metadataStringValue(agent.metadata, "workspaceQualifier") ?? null,
    node: metadataStringValue(agent.metadata, "nodeQualifier") ?? null,
    projectRoot: endpoint?.projectRoot
      ?? endpoint?.cwd
      ?? metadataStringValue(agent.metadata, "projectRoot")
      ?? null,
    endpointState: normalizeEndpointState(endpoint?.state),
    transport: endpoint?.transport ?? null,
  };
}

export function buildDispatchEnvelope(
  resolution: Exclude<BrokerLabelResolution, { kind: "resolved" }>,
  askedLabel: string,
  dispatcherNodeId: string,
  snapshot: RuntimeSnapshot,
  helpers: Pick<DispatcherHelpers, "homeEndpointFor">,
): ScoutDispatchEnvelope {
  const kind: ScoutDispatchKind = resolution.kind;
  const dispatchedAt = Date.now();
  const trimmedAsked = askedLabel.trim();

  if (resolution.kind === "unparseable") {
    return {
      kind,
      askedLabel: trimmedAsked,
      detail: trimmedAsked
        ? `could not parse "${trimmedAsked}" as an agent reference`
        : "no target agent provided",
      candidates: [],
      dispatchedAt,
      dispatcherNodeId,
    };
  }

  if (resolution.kind === "unknown") {
    return {
      kind,
      askedLabel: resolution.label,
      detail: `no agent matches ${resolution.label}`,
      candidates: [],
      dispatchedAt,
      dispatcherNodeId,
    };
  }

  const candidates = resolution.candidates.map((agent) =>
    buildAgentLabelCandidate(snapshot, agent)
  );

  return {
    kind,
    askedLabel: resolution.label,
    detail: `${resolution.label} matches ${resolution.candidates.length} agents; pick one`,
    candidates: resolution.candidates.map((agent, index) =>
      summarizeDispatchCandidate(
        agent,
        snapshot,
        helpers,
        formatMinimalAgentIdentity(candidates[index]!, candidates),
      ),
    ),
    dispatchedAt,
    dispatcherNodeId,
  };
}
