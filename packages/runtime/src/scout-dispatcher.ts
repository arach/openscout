import {
  diagnoseAgentIdentity,
  formatMinimalAgentIdentity,
  parseAgentIdentity,
  type AgentDefinition,
  type AgentEndpoint,
  type AgentIdentityCandidate,
  type ScoutCandidateEndpointState,
  type ScoutDispatchCandidate,
  type ScoutDispatchEnvelope,
  type ScoutDispatchKind,
} from "@openscout/protocol";

import type { createInMemoryControlRuntime } from "./broker.js";

export type RuntimeSnapshot = ReturnType<ReturnType<typeof createInMemoryControlRuntime>["snapshot"]>;

export type BrokerLabelResolution =
  | { kind: "resolved"; agent: AgentDefinition }
  | { kind: "ambiguous"; label: string; candidates: AgentDefinition[] }
  | { kind: "unparseable"; label: string }
  | { kind: "unknown"; label: string };

export type BrokerAgentCandidate = AgentIdentityCandidate & {
  agentId: string;
  agent: AgentDefinition;
};

export interface DispatcherHelpers {
  isStale: (agent: AgentDefinition | undefined) => boolean;
  homeEndpointFor: (snapshot: RuntimeSnapshot, agentId: string) => AgentEndpoint | null;
}

function metadataStringValue(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function buildAgentLabelCandidates(
  snapshot: RuntimeSnapshot,
  helpers: Pick<DispatcherHelpers, "isStale">,
): BrokerAgentCandidate[] {
  return Object.values(snapshot.agents)
    .filter((agent) => !helpers.isStale(agent))
    .map((agent) => buildAgentLabelCandidate(snapshot, agent));
}

function buildAgentLabelCandidate(
  _snapshot: RuntimeSnapshot,
  agent: AgentDefinition,
): BrokerAgentCandidate {
  const metadata = agent.metadata ?? {};
  const aliases = [
    metadataStringValue(metadata, "selector"),
    metadataStringValue(metadata, "defaultSelector"),
  ].filter((value): value is string => Boolean(value));

  return {
    agentId: agent.id,
    agent,
    definitionId: metadataStringValue(metadata, "definitionId") ?? agent.id,
    nodeQualifier: metadataStringValue(metadata, "nodeQualifier"),
    workspaceQualifier: metadataStringValue(metadata, "workspaceQualifier"),
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

  const candidates = buildAgentLabelCandidates(snapshot, options.helpers);
  const diagnosis = diagnoseAgentIdentity(identity, candidates);

  if (diagnosis.kind === "resolved") {
    return { kind: "resolved", agent: diagnosis.match.agent };
  }

  if (diagnosis.kind === "unknown") {
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
