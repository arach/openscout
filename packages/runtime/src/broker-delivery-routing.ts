import {
  parseAgentIdentity,
  type AgentDefinition,
  type AgentHarness,
  type InvocationRequest,
  type ScoutDeliveryReceipt,
  type ScoutDeliveryRemediationAction,
  type ScoutDeliverRequest,
  type ScoutDeliverRouteKind,
  type ScoutDispatchRecord,
} from "@openscout/protocol";

import { SUPPORTED_SCOUT_HARNESSES } from "./local-agents.js";
import {
  parseSessionRouteLabel,
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
  isInactiveLocalAgent: (agent: AgentDefinition | undefined) => boolean;
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
  const labelSessionHarness = label ? parseSessionRouteLabel(label)?.harness : undefined;
  const targetHarness = payload.target?.kind === "session_id"
    ? payload.target.harness
    : labelSessionHarness;
  const harness = payload.execution?.harness
    ? undefined
    : targetHarness ?? supportedRouteHarness(identity?.harness);
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

export function shouldMaterializeProjectAgent(input: {
  projectPath?: string;
  resolved: InvocationResolution;
  projectAgent?: unknown;
  execution?: InvocationRequest["execution"];
}): boolean {
  void input;
  // Project paths are route selectors. Delivery must not synthesize agent
  // cards when a path is unknown or ambiguous; callers can target a session id
  // for exact continuation or use explicit session/card APIs when they want a
  // new named identity.
  return false;
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
  sid?: string;
  sessionAlias?: string;
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
    ...(input.sid ? { sid: input.sid } : {}),
    ...(input.sessionAlias ? { sessionAlias: input.sessionAlias } : {}),
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
      projectAgent?: unknown;
    },
    _resolveOptions: {
      requesterId?: string;
      currentDirectory?: string;
      reason: string;
    },
  ): Promise<InvocationResolution> {
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
