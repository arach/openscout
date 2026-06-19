import { basename } from "node:path";

import {
  normalizeAgentSelectorSegment,
  parseAgentIdentity,
  type AgentDefinition,
  type AgentHarness,
  type InvocationRequest,
  type ScoutDeliveryReceipt,
  type ScoutDeliveryRemediationAction,
  type ScoutDeliverRequest,
  type ScoutDeliverRouteKind,
  type ScoutDispatchRecord,
  type ScoutProjectAgentSpec,
} from "@openscout/protocol";

import type { ScoutLocalAgentStatus, StartLocalAgentInput, PruneOneTimeLocalAgentCardsInput } from "./local-agents.js";
import { SUPPORTED_SCOUT_HARNESSES } from "./local-agents.js";
import {
  resolveBrokerRouteTarget,
  type BrokerLabelResolution,
  type BrokerRouteTargetInput,
  type RuntimeSnapshot,
} from "./scout-dispatcher.js";

export type InvocationResolution =
  | { kind: "resolved"; agent: AgentDefinition }
  | BrokerLabelResolution;

export type BrokerDeliveryRouterOptions = {
  runtimeSnapshot: () => RuntimeSnapshot;
  nodeId: string;
  implicitProjectCardTtlMs: number;
  isInactiveLocalAgent: (agent: AgentDefinition | undefined) => boolean;
  createId: (prefix: string) => string;
  startLocalAgent: (input: StartLocalAgentInput) => Promise<ScoutLocalAgentStatus>;
  pruneOneTimeLocalAgentCards: (input: PruneOneTimeLocalAgentCardsInput) => Promise<unknown>;
  syncRegisteredLocalAgents: () => Promise<void>;
  clearGitBranchCache: () => void;
  log?: (message: string) => void;
  warn?: (message: string) => void;
};

export function callerContextForDelivery(
  payload: ScoutDeliverRequest,
  defaults: { operatorActorId: string; nodeId: string },
): { requesterId: string; requesterNodeId: string } {
  return {
    requesterId: payload.caller?.actorId?.trim() || payload.requesterId?.trim() || defaults.operatorActorId,
    requesterNodeId: payload.caller?.nodeId?.trim() || payload.requesterNodeId?.trim() || defaults.nodeId,
  };
}

export function agentLabelForRouteParams(payload: Pick<ScoutDeliverRequest, "target" | "targetLabel">): string | undefined {
  if (payload.target?.kind === "agent_label") {
    return payload.target.label;
  }
  if (!payload.target && payload.targetLabel?.trim()) {
    return payload.targetLabel;
  }
  return undefined;
}

export function supportedRouteHarness(value: string | undefined): AgentHarness | undefined {
  const normalized = value?.trim() as AgentHarness | undefined;
  if (normalized && SUPPORTED_SCOUT_HARNESSES.includes(normalized)) {
    return normalized;
  }
  return undefined;
}

export function supportedRouteModel(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function executionWithRouteParams(payload: ScoutDeliverRequest): InvocationRequest["execution"] | undefined {
  const label = agentLabelForRouteParams(payload);
  const identity = label
    ? parseAgentIdentity(label.startsWith("@") ? label : `@${label}`)
    : null;
  const harness = payload.execution?.harness ? undefined : supportedRouteHarness(identity?.harness);
  const model = payload.execution?.model ? undefined : supportedRouteModel(identity?.model);
  if (!harness && !model) {
    return payload.execution;
  }

  return {
    ...(payload.execution ?? {}),
    ...(harness ? { harness } : {}),
    ...(model ? { model } : {}),
  };
}

export function projectPathRouteTarget(input: BrokerRouteTargetInput): string | undefined {
  return input.target?.kind === "project_path"
    ? input.target.projectPath.trim() || undefined
    : undefined;
}

export function implicitProjectAgentName(
  projectPath: string,
  createId: (prefix: string) => string,
): string {
  const base = normalizeAgentSelectorSegment(basename(projectPath)) || "agent";
  return `${base}-card-${createId("one").slice(-8)}`;
}

export function projectAgentPersistence(
  spec: ScoutProjectAgentSpec | undefined,
): "one_time" | "sticky" {
  return spec?.persistence === "sticky" ? "sticky" : "one_time";
}

export function compactProjectAgentName(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function shouldMaterializeProjectAgent(input: {
  projectPath?: string;
  resolved: InvocationResolution;
  persistence: "one_time" | "sticky";
  projectAgent?: ScoutProjectAgentSpec;
  execution?: InvocationRequest["execution"];
}): boolean {
  if (!input.projectPath) {
    return false;
  }

  // Explicit one-time runner requests should not inherit a stable project
  // session. They get a short-lived card even when a sticky agent exists.
  if (input.projectAgent?.persistence === "one_time") {
    return true;
  }

  // Explicit sticky requests may carry profile details that should become the
  // stable project agent config before the ask is routed.
  if (input.projectAgent?.persistence === "sticky") {
    return input.resolved.kind !== "resolved"
      || Boolean(input.projectAgent.agentName?.trim())
      || Boolean(input.projectAgent.displayName?.trim())
      || Boolean(input.execution?.harness)
      || Boolean(input.execution?.model?.trim())
      || Boolean(input.execution?.permissionProfile);
  }

  // Legacy project-path asks keep the old implicit card behavior: only
  // materialize when there is no target or fresh context must disambiguate.
  return input.resolved.kind === "unknown"
    || (input.resolved.kind === "ambiguous" && (input.execution?.session ?? "new") === "new");
}

export function remediationForDispatch(
  dispatch: ScoutDispatchRecord,
): ScoutDeliveryRemediationAction {
  if (dispatch.kind === "ambiguous") {
    return {
      kind: "choose_target",
      detail: dispatch.detail,
      targetLabel: dispatch.askedLabel,
      dispatchId: dispatch.id,
    };
  }
  if (dispatch.kind === "unavailable") {
    return {
      kind: dispatch.target?.reason === "manual_wake_required"
        ? "wake_target"
        : dispatch.target?.reason === "session_reference_not_attachable"
        ? "session_reference_not_attachable"
        : dispatch.target?.reason === "superseded_registration" || dispatch.target?.reason === "stale_registration"
        ? "use_current_registration"
        : "retry_later",
      detail: dispatch.target?.detail ?? dispatch.detail,
      targetAgentId: dispatch.target?.agentId,
      targetLabel: dispatch.askedLabel,
      dispatchId: dispatch.id,
    };
  }
  return {
    kind: dispatch.kind === "unknown" ? "register_target" : "choose_target",
    detail: dispatch.detail,
    targetLabel: dispatch.askedLabel,
    dispatchId: dispatch.id,
  };
}

export function buildDeliveryReceipt(input: {
  requestId: string;
  routeKind: ScoutDeliverRouteKind;
  requesterId: string;
  requesterNodeId: string;
  targetAgentId?: string;
  targetSessionId?: string;
  targetLabel: string;
  bindingRef?: string;
  conversationId: string;
  messageId: string;
  flightId?: string;
}): ScoutDeliveryReceipt {
  return {
    requestId: input.requestId,
    routeKind: input.routeKind,
    requesterId: input.requesterId,
    requesterNodeId: input.requesterNodeId,
    targetAgentId: input.targetAgentId,
    targetSessionId: input.targetSessionId,
    targetLabel: input.targetLabel,
    ...(input.bindingRef ? { bindingRef: input.bindingRef } : {}),
    conversationId: input.conversationId,
    messageId: input.messageId,
    ...(input.flightId ? { flightId: input.flightId } : {}),
    acceptedAt: Date.now(),
  };
}

export function normalizeScoutLabels(labels: string[] | undefined): string[] {
  if (!labels) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export class BrokerDeliveryRouter {
  constructor(private readonly options: BrokerDeliveryRouterOptions) {}

  resolveTarget(input: BrokerRouteTargetInput): InvocationResolution {
    return resolveBrokerRouteTarget(this.options.runtimeSnapshot(), input, {
      preferLocalNodeId: this.options.nodeId,
      helpers: { isStale: this.options.isInactiveLocalAgent },
    });
  }

  async resolveWithImplicitProjectAgent(
    input: BrokerRouteTargetInput & {
      execution?: InvocationRequest["execution"];
      projectAgent?: ScoutProjectAgentSpec;
    },
    resolveOptions: {
      requesterId?: string;
      currentDirectory?: string;
      reason: string;
    },
  ): Promise<InvocationResolution> {
    const resolved = this.resolveTarget(input);
    const projectPath = projectPathRouteTarget(input);
    const persistence = projectAgentPersistence(input.projectAgent);
    if (!shouldMaterializeProjectAgent({
      projectPath,
      resolved,
      persistence,
      projectAgent: input.projectAgent,
      execution: input.execution,
    })) {
      return resolved;
    }
    if (!projectPath) {
      return resolved;
    }

    const createdAt = Date.now();
    const requesterId = resolveOptions.requesterId?.trim();
    const agentName = persistence === "sticky"
      ? compactProjectAgentName(input.projectAgent?.agentName)
      : implicitProjectAgentName(projectPath, this.options.createId);
    const displayName = compactProjectAgentName(input.projectAgent?.displayName);
    const status = await this.options.startLocalAgent({
      projectPath,
      ...(agentName ? { agentName } : {}),
      ...(displayName ? { displayName } : {}),
      currentDirectory: resolveOptions.currentDirectory ?? projectPath,
      harness: input.execution?.harness,
      model: input.execution?.model,
      permissionProfile: input.execution?.permissionProfile,
      ensureOnline: false,
      card: {
        kind: persistence === "sticky" ? "persistent" : "one_time",
        createdAt,
        ...(requesterId ? { createdById: requesterId } : {}),
        ...(persistence === "one_time"
          ? {
              expiresAt: createdAt + this.options.implicitProjectCardTtlMs,
              maxUses: 1,
            }
          : {}),
      },
    }).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`could not create a ${persistence} agent for project ${projectPath}: ${detail}`);
    });

    if (persistence === "one_time") {
      await this.options.pruneOneTimeLocalAgentCards({
        ...(requesterId ? { createdById: requesterId } : {}),
        projectRoot: status.projectRoot,
        excludeAgentIds: [status.agentId],
      }).catch((error) => {
        this.options.warn?.(`[openscout-runtime] implicit project card cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    // Materialized project cards must be visible to the broker before routing.
    // Do a direct sync here instead of relying on mtime/size signature checks,
    // which can be too weak on fast CI filesystems immediately after a write.
    this.options.clearGitBranchCache();
    this.options.log?.(`[openscout-runtime] local agent registry changed (${resolveOptions.reason}); refreshing registered agents`);
    await this.options.syncRegisteredLocalAgents();
    const agent = this.options.runtimeSnapshot().agents[status.agentId];
    if (agent && !this.options.isInactiveLocalAgent(agent)) {
      return { kind: "resolved", agent };
    }

    return this.resolveTarget(input);
  }

  resolveInvocationTarget(
    payload: InvocationRequest & BrokerRouteTargetInput,
  ): Promise<InvocationResolution> {
    return this.resolveWithImplicitProjectAgent({
      target: payload.target,
      targetAgentId: payload.targetAgentId,
      targetSessionId: payload.targetSessionId,
      targetLabel: payload.targetLabel,
      routePolicy: payload.routePolicy,
      execution: payload.execution,
      projectAgent: undefined,
    }, {
      requesterId: payload.requesterId,
      currentDirectory: projectPathRouteTarget(payload),
      reason: "implicit project invocation card",
    });
  }
}
