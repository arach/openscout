import { homedir } from "node:os";
import { basename, resolve } from "node:path";

import {
  constructAgentIdentity,
  diagnoseAgentIdentity,
  formatMinimalAgentIdentity,
  OPENSCOUT_COORDINATOR_AGENT_ID,
  parseAgentIdentity,
  SCOUT_DISPATCHER_AGENT_ID,
  type AgentDefinition,
  type AgentEndpoint,
  type AgentHarness,
  type AgentIdentity,
  type AgentIdentityCandidate,
  type AgentIdentityDiagnosis,
  type ScoutDispatchCandidate,
  type ScoutDispatchEnvelope,
  type ScoutDispatchKind,
  type ScoutId,
  type ScoutRoutePolicy,
  type ScoutRouteTarget,
  normalizeAgentSelectorSegment,
} from "@openscout/protocol";

import type { createInMemoryControlRuntime } from "./broker.js";
import {
  endpointAvailabilityScore,
  endpointLifecycleAt,
  endpointCandidateState,
  endpointMatchesTargetSession,
  homeEndpointForAgent,
  isStaleLocalEndpoint,
  localEndpointPreferenceRank,
} from "./broker-endpoint-selection.js";

export type RuntimeSnapshot = ReturnType<ReturnType<typeof createInMemoryControlRuntime>["snapshot"]>;

/**
 * Addressable target for a cardless session (SCO-070). Carries no
 * AgentDefinition: the session resolves to a live endpoint directly, so the
 * dispatch path must read identity/label off this shape instead of `agent`.
 */
export interface ResolvedSessionTarget {
  /** The session id the caller addressed. */
  sessionId: string;
  /** Session-kind actor id occupying the identity slot (== endpoint.agentId marker). */
  actorId: ScoutId;
  /** Live endpoint to dispatch through. */
  endpoint: AgentEndpoint;
  /** Display label, e.g. `<cwd-basename>:<short-session>`. */
  label: string;
  /** endpoint.nodeId — the cross-node forwarding key. */
  nodeId: ScoutId;
}

export type BrokerLabelResolution =
  | { kind: "resolved"; agent: AgentDefinition }
  | { kind: "resolved_session"; session: ResolvedSessionTarget }
  | { kind: "ambiguous"; label: string; candidates: AgentDefinition[] }
  | { kind: "unparseable"; label: string }
  | { kind: "unknown"; label: string; detail?: string; candidates?: AgentDefinition[] };

export interface BrokerRouteTargetInput {
  target?: ScoutRouteTarget | null;
  targetAgentId?: string | null;
  targetSessionId?: string | null;
  targetLabel?: string | null;
  routePolicy?: ScoutRoutePolicy | null;
  execution?: { harness?: AgentHarness } | null;
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

function sessionRouteLabel(sessionId: string, harness?: AgentHarness): string {
  return harness ? `session:${harness}:${sessionId}` : `session:${sessionId}`;
}

function endpointMatchesSessionRouteScope(
  endpoint: AgentEndpoint,
  options: { harness?: AgentHarness },
): boolean {
  return !options.harness || endpoint.harness === options.harness;
}

function sessionActorHandleAliases(
  snapshot: RuntimeSnapshot,
  actorId: string,
): string[] {
  const actor = snapshot.actors[actorId];
  const endpoint = homeEndpointForAgent(snapshot, actorId);
  return [
    actor?.handle,
    metadataStringValue(actor?.metadata, "handle"),
    metadataStringValue(endpoint?.metadata, "handle"),
    actorId,
  ].filter((value): value is string => Boolean(value));
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

function projectRootForAgent(
  snapshot: RuntimeSnapshot,
  agent: AgentDefinition,
): string | undefined {
  const endpoint = homeEndpointForAgent(snapshot, agent.id);
  return endpoint?.projectRoot?.trim()
    || metadataStringValue(agent.metadata, "projectRoot")
    || endpoint?.cwd?.trim();
}

function normalizeProjectPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const home = process.env.HOME?.trim() || homedir();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return resolve(home, trimmed.slice(2));
  return resolve(trimmed);
}

function buildAgentLabelCandidate(
  snapshot: RuntimeSnapshot,
  agent: AgentDefinition,
): BrokerAgentCandidate {
  const metadata = agent.metadata ?? {};
  const endpoint = homeEndpointForAgent(snapshot, agent.id);
  const aliases = [
    agent.handle,
    metadataStringValue(metadata, "handle"),
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

function stripModelQualifier(identity: AgentIdentity): AgentIdentity | null {
  if (!identity.model) {
    return null;
  }

  return constructAgentIdentity({
    definitionId: identity.definitionId,
    workspaceQualifier: identity.workspaceQualifier,
    profile: identity.profile,
    harness: identity.harness,
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

function unknownModelQualifiedResolution(
  identity: AgentIdentity,
  candidates: BrokerAgentCandidate[],
): BrokerLabelResolution | null {
  if (!identity.model) {
    return null;
  }

  const modelAgnosticIdentity = stripModelQualifier(identity);
  if (!modelAgnosticIdentity) {
    return null;
  }

  const modelAgnosticDiagnosis = diagnoseAgentIdentity(modelAgnosticIdentity, candidates);
  const matches = modelAgnosticDiagnosis.kind === "resolved"
    ? [modelAgnosticDiagnosis.match]
    : modelAgnosticDiagnosis.kind === "ambiguous"
    ? modelAgnosticDiagnosis.candidates
    : [];
  if (matches.length === 0) {
    return null;
  }

  const missingModelCount = matches.filter((candidate) => !candidate.model).length;
  const mismatchCount = matches.length - missingModelCount;
  const reason = missingModelCount === matches.length
    ? "matching candidates do not advertise a model"
    : mismatchCount === matches.length
    ? "matching candidates advertise a different model"
    : "matching candidates do not advertise the requested model";

  return {
    kind: "unknown",
    label: identity.label,
    detail: `no exact agent matches ${identity.label}; requested model:${identity.model}, but ${reason}`,
    candidates: matches.map((candidate) => candidate.agent),
  };
}

function resolveSessionHandleLabel(
  snapshot: RuntimeSnapshot,
  identity: AgentIdentity,
  options: { helpers: Pick<DispatcherHelpers, "isStale"> },
): BrokerLabelResolution | null {
  if (
    identity.workspaceQualifier
    || identity.nodeQualifier
    || identity.profile
    || identity.harness
    || identity.model
  ) {
    return null;
  }

  const handle = normalizeAgentSelectorSegment(identity.definitionId);
  if (!handle) {
    return null;
  }

  const matches = Object.values(snapshot.actors)
    .filter((actor) => actor.kind === "session")
    .filter((actor) => (
      sessionActorHandleAliases(snapshot, actor.id)
        .map((alias) => normalizeAgentSelectorSegment(alias))
        .includes(handle)
    ))
    .map((actor) => {
      const endpoint = Object.values(snapshot.endpoints)
        .filter((candidate) => candidate.agentId === actor.id)
        .filter((candidate) => !isStaleLocalEndpoint(snapshot, candidate))
        .sort((left, right) => localEndpointPreferenceRank(left) - localEndpointPreferenceRank(right))[0];
      return endpoint ? { actor, endpoint } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (matches.length === 0) {
    return null;
  }

  const { actor, endpoint } = [...matches].sort((left, right) => (
    endpointAvailabilityScore(right.endpoint) - endpointAvailabilityScore(left.endpoint)
    || endpointLifecycleAt(right.endpoint) - endpointLifecycleAt(left.endpoint)
    || right.actor.id.localeCompare(left.actor.id)
  ))[0]!;
  const sessionId = actor.id;
  return {
    kind: "resolved_session",
    session: {
      sessionId,
      actorId: actor.id,
      endpoint,
      label: actor.displayName || sessionTargetLabel(endpoint, sessionId),
      nodeId: endpoint.nodeId,
    },
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
    const session = resolveSessionHandleLabel(snapshot, identity, options);
    if (session) {
      return session;
    }

    const bareHandle = normalizeAgentSelectorSegment(identity.definitionId);
    if (bareHandle && !bareHandle.startsWith("project-")) {
      const prefixed = parseAgentIdentity(`@project-${bareHandle}`);
      if (prefixed) {
        const prefixedSession = resolveSessionHandleLabel(snapshot, prefixed, options);
        if (prefixedSession) {
          return prefixedSession;
        }
      }
    }

    const modelQualifiedResolution = unknownModelQualifiedResolution(identity, candidates);
    if (modelQualifiedResolution) {
      return modelQualifiedResolution;
    }

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

function projectCandidateRank(
  snapshot: RuntimeSnapshot,
  agent: AgentDefinition,
  preferLocalNodeId: string | undefined,
): number {
  const endpoint = homeEndpointForAgent(snapshot, agent.id);
  const nodeRank = preferLocalNodeId && agent.authorityNodeId === preferLocalNodeId ? 100 : 0;
  return nodeRank + endpointAvailabilityScore(endpoint);
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

function sessionTargetLabel(endpoint: AgentEndpoint, sessionId: string): string {
  const shortId = sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
  const root = endpoint.cwd?.trim() || endpoint.projectRoot?.trim();
  return root ? `${basename(root)}:${shortId}` : `session:${sessionId}`;
}

function resolveSessionTarget(
  snapshot: RuntimeSnapshot,
  sessionId: string,
  options: { helpers: Pick<DispatcherHelpers, "isStale">; harness?: AgentHarness },
): BrokerLabelResolution {
  const label = sessionRouteLabel(sessionId, options.harness);
  const matching = Object.values(snapshot.endpoints)
    .filter((endpoint) => endpointMatchesTargetSession(endpoint, sessionId))
    .filter((endpoint) => endpointMatchesSessionRouteScope(endpoint, options));
  if (matching.length === 0) {
    return { kind: "unknown", label };
  }

  // Card path (semantics unchanged from before SCO-070): if any matching endpoint
  // is backed by an agent card, resolve to it — with NO staleness pre-filter, so
  // the downstream unavailable check still surfaces "session not attachable" for a
  // session whose card has gone stale.
  const carded = [
    ...new Map(
      matching
        .map((endpoint) => snapshot.agents[endpoint.agentId])
        .filter((agent): agent is AgentDefinition => Boolean(agent))
        .map((agent) => [agent.id, agent] as const),
    ).values(),
  ];
  if (carded.length === 1) {
    return { kind: "resolved", agent: carded[0]! };
  }
  if (carded.length > 1) {
    return { kind: "ambiguous", label, candidates: carded };
  }

  // Cardless path (SCO-070): no backing AgentDefinition on any matching endpoint.
  // Drop stale/terminal endpoints (staleLocalRegistration is authoritative) and
  // collapse to the preferred live endpoint — multiple endpoints sharing a session
  // id is a transport choice, not an identity ambiguity.
  const live = matching.filter((endpoint) => !isStaleLocalEndpoint(snapshot, endpoint));
  if (live.length === 0) {
    return { kind: "unknown", label };
  }
  const endpoint = [...live].sort(
    (left, right) => localEndpointPreferenceRank(left) - localEndpointPreferenceRank(right),
  )[0]!;
  return {
    kind: "resolved_session",
    session: {
      sessionId,
      actorId: endpoint.agentId,
      endpoint,
      label: sessionTargetLabel(endpoint, sessionId),
      nodeId: endpoint.nodeId,
    },
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
    const directSessionHarness = routeTarget?.kind === "session_id"
      ? routeTarget.harness
      : input.execution?.harness;
    return resolveSessionTarget(snapshot, directSessionId, {
      helpers: options.helpers,
      harness: directSessionHarness,
    });
  }

  if (directId) {
    const agent = snapshot.agents[directId];
    if (agent && (policy?.allowHistoricalDirectId ?? policy?.allowStaleDirectId ?? true)) {
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
      const flight = matches[0]!;
      const agent = snapshot.agents[flight.targetAgentId];
      if (agent) {
        return { kind: "resolved", agent };
      }
      return resolveSessionTarget(snapshot, flight.targetAgentId, {
        helpers: options.helpers,
      });
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
    endpointState: endpointCandidateState(endpoint?.state),
    transport: endpoint?.transport ?? null,
  };
}

export function buildDispatchEnvelope(
  resolution: Exclude<BrokerLabelResolution, { kind: "resolved" } | { kind: "resolved_session" }>,
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
    const candidates = (resolution.candidates ?? []).map((agent) =>
      buildAgentLabelCandidate(snapshot, agent)
    );
    return {
      kind,
      askedLabel: resolution.label,
      detail: resolution.detail ?? `no agent matches ${resolution.label}`,
      candidates: (resolution.candidates ?? []).map((agent, index) =>
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
