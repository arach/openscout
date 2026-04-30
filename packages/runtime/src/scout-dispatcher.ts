import {
  diagnoseAgentIdentity,
  formatMinimalAgentIdentity,
  OPENSCOUT_COORDINATOR_AGENT_ID,
  parseAgentIdentity,
  SCOUT_DISPATCHER_AGENT_ID,
  type AgentDefinition,
  type AgentEndpoint,
  type AgentIdentityCandidate,
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
    : target.kind === "binding_ref"
    ? target.ref
    : target.kind === "channel"
    ? target.channel
    : target.value;
  const trimmed = direct?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function askedLabelForRouteTarget(input: BrokerRouteTargetInput): string {
  return normalizedRouteTargetValue(input.target)
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

function replacementForStaleAgent(
  snapshot: RuntimeSnapshot,
  agent: AgentDefinition,
  helpers: Pick<DispatcherHelpers, "isStale">,
): AgentDefinition | undefined {
  if (!helpers.isStale(agent)) {
    return undefined;
  }
  const replacementAgentId = metadataStringValue(agent.metadata, "replacedByAgentId");
  if (!replacementAgentId || replacementAgentId === agent.id) {
    return undefined;
  }
  const replacement = snapshot.agents[replacementAgentId];
  if (!replacement || helpers.isStale(replacement)) {
    return undefined;
  }
  return replacement;
}

function isReservedProductIdentity(definitionId: string): boolean {
  return definitionId === SCOUT_DISPATCHER_AGENT_ID
    || definitionId === OPENSCOUT_COORDINATOR_AGENT_ID;
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
  if (isReservedProductIdentity(identity.definitionId)) {
    return { kind: "unknown", label: identity.label };
  }

  const candidates = buildAgentLabelCandidates(snapshot, options.helpers);
  const diagnosis = diagnoseAgentIdentity(identity, candidates);

  if (diagnosis.kind === "resolved") {
    return { kind: "resolved", agent: diagnosis.match.agent };
  }

  if (diagnosis.kind === "unknown") {
    const fallbackCandidates = buildAgentLabelCandidates(snapshot, options.helpers, {
      includeStale: true,
    });
    const fallbackDiagnosis = diagnoseAgentIdentity(identity, fallbackCandidates);
    if (fallbackDiagnosis.kind === "resolved") {
      return {
        kind: "resolved",
        agent: replacementForStaleAgent(
          snapshot,
          fallbackDiagnosis.match.agent,
          options.helpers,
        ) ?? fallbackDiagnosis.match.agent,
      };
    }
    if (fallbackDiagnosis.kind === "ambiguous") {
      return {
        kind: "ambiguous",
        label: identity.label,
        candidates: fallbackDiagnosis.candidates.map((candidate) => candidate.agent),
      };
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

  if (directId) {
    const agent = snapshot.agents[directId];
    if (agent) {
      const replacement = replacementForStaleAgent(snapshot, agent, options.helpers);
      if (replacement) {
        return { kind: "resolved", agent: replacement };
      }
    }
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
