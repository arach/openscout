import type { AgentEndpoint, NodeDefinition } from "@openscout/protocol";
import { buildTmuxAttachCommand, isDebugTransportAttachable, type AgentEndpointDebugTransport } from "@openscout/protocol";

import type { RuntimeRegistrySnapshot } from "./registry.js";

export const SCOUT_VANTAGE_PLAN_SCHEMA = "scout.vantage.plan.v1" as const;
export const HUDSON_VANTAGE_SETUP_KIND = "hudson.vantage.setup" as const;
export const HUDSON_VANTAGE_SCHEMA_VERSION = 1 as const;

export type TmuxSession = {
  name: string;
  createdAt: number | null;
};

export type ScoutVantageBrokerContext = {
  baseUrl: string;
  node: NodeDefinition;
  snapshot: RuntimeRegistrySnapshot;
};

export type ScoutVantagePlanInput = {
  currentDirectory: string;
  broker?: ScoutVantageBrokerContext | null;
  brokerSnapshot?: RuntimeRegistrySnapshot | null;
  brokerNode?: NodeDefinition | null;
  tmuxSessions?: readonly TmuxSession[];
  focusAgentId?: string | null;
  now?: Date;
};

export type ScoutVantagePlanEnvelope = {
  schema: typeof SCOUT_VANTAGE_PLAN_SCHEMA;
  createdAt: string;
  currentDirectory: string;
  broker: ScoutVantageBrokerState;
  manifest: HudsonVantageSetupManifest;
  diagnostics: ScoutVantagePlanDiagnostic[];
};

export type ScoutVantagePlan = ScoutVantagePlanEnvelope;

export type HudsonVantageSetupManifest = {
  kind: typeof HUDSON_VANTAGE_SETUP_KIND;
  schemaVersion: typeof HUDSON_VANTAGE_SCHEMA_VERSION;
  source: "openscout";
  generatedAt: string;
  currentDirectory: string;
  broker: ScoutVantageBrokerSummary | null;
  focus: ScoutVantageFocus | null;
  selection: string[];
  focusedNodeId: string | null;
  nodes: ScoutVantageNode[];
};

export type ScoutVantageFocus = {
  agentId?: string;
};

export type ScoutVantageBrokerSummary = {
  baseUrl: string | null;
  nodeId: string | null;
  nodeName: string | null;
  counts: {
    nodes: number;
    agents: number;
    endpoints: number;
  };
};

export type ScoutVantageBrokerState = {
  reachable: boolean;
  baseUrl: string | null;
  nodeId: string | null;
};

export type ScoutVantageNode = ScoutVantageTmuxNode;

export type ScoutVantageTmuxNode = {
  id: string;
  runtimeKind: "tmux";
  source: "broker-endpoint" | "tmux-session";
  title: string;
  target: string;
  layout: ScoutVantageNodeLayout;
  tmux: {
    sessionName: string;
    paneTarget?: string;
    createdAt: number | null;
    command: ["tmux", "attach-session", "-t", string];
    terminalRelay: {
      backend: "tmux";
      tmuxSession: string;
    };
  };
  endpoint?: {
    id: string;
    agentId: string;
    nodeId: string;
    harness: AgentEndpoint["harness"];
    transport: AgentEndpoint["transport"];
    state: AgentEndpoint["state"];
  };
  cwd: string | null;
  projectRoot: string | null;
};

export type ScoutVantageNodeLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScoutVantagePlanDiagnostic = {
  code:
    | "broker_context_missing"
    | "broker_snapshot_missing"
    | "endpoint_not_attachable"
    | "endpoint_tmux_target_duplicate"
    | "endpoint_tmux_session_missing"
    | "focus_agent_missing"
    | "tmux_sessions_missing"
    | "vantage_nodes_missing";
  severity: "info" | "warning";
  message: string;
  endpointId?: string;
  sessionName?: string;
  agentId?: string;
};

type EndpointTmuxTarget = {
  sessionName: string;
  paneTarget?: string;
  cwd: string | null;
  attachable: boolean;
  detail: string | null;
};

const NODE_WIDTH = 560;
const NODE_HEIGHT = 360;
const NODE_GAP_X = 40;
const NODE_GAP_Y = 40;
const NODES_PER_ROW = 2;

export function buildScoutVantagePlan(input: ScoutVantagePlanInput): ScoutVantagePlanEnvelope {
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const brokerSnapshot = input.broker?.snapshot ?? input.brokerSnapshot ?? null;
  const brokerNode = input.broker?.node ?? input.brokerNode ?? null;
  const tmuxSessions = [...(input.tmuxSessions ?? [])].sort(compareTmuxSessions);
  const tmuxSessionByName = new Map(tmuxSessions.map((session) => [session.name, session]));
  const focusAgentId = input.focusAgentId?.trim() || null;
  const diagnostics: ScoutVantagePlanDiagnostic[] = [];
  const nodes: ScoutVantageNode[] = [];
  const representedTmuxTargets = new Set<string>();
  const representedTmuxSessions = new Set<string>();

  if (!input.broker) {
    diagnostics.push({
      code: "broker_context_missing",
      severity: "info",
      message: "No active Scout broker context was provided.",
    });
  }

  if (!brokerSnapshot) {
    diagnostics.push({
      code: "broker_snapshot_missing",
      severity: "info",
      message: "No Scout broker snapshot was provided.",
    });
  }

  if (tmuxSessions.length === 0) {
    diagnostics.push({
      code: "tmux_sessions_missing",
      severity: "info",
      message: "No tmux sessions were provided.",
    });
  }

  for (const endpoint of sortedEndpoints(brokerSnapshot)) {
    const target = endpointTmuxTarget(endpoint);
    if (!target) {
      continue;
    }

    if (!target.attachable) {
      diagnostics.push({
        code: "endpoint_not_attachable",
        severity: "warning",
        message: target.detail
          ? `Endpoint ${endpoint.id} has a tmux target but is not attachable: ${target.detail}`
          : `Endpoint ${endpoint.id} has a tmux target but is not attachable.`,
        endpointId: endpoint.id,
        sessionName: target.sessionName,
      });
      continue;
    }

    const tmuxSession = tmuxSessionByName.get(target.sessionName);
    if (!tmuxSession) {
      diagnostics.push({
        code: "endpoint_tmux_session_missing",
        severity: "warning",
        message: `Endpoint ${endpoint.id} points at tmux session ${target.sessionName}, but that session was not provided.`,
        endpointId: endpoint.id,
        sessionName: target.sessionName,
      });
      continue;
    }

    const targetKey = tmuxTargetKey(target);
    if (representedTmuxTargets.has(targetKey)) {
      diagnostics.push({
        code: "endpoint_tmux_target_duplicate",
        severity: "info",
        message: `Endpoint ${endpoint.id} points at tmux target ${target.paneTarget ?? target.sessionName}, which is already represented in the Vantage plan.`,
        endpointId: endpoint.id,
        sessionName: target.sessionName,
      });
      continue;
    }

    representedTmuxTargets.add(targetKey);
    representedTmuxSessions.add(target.sessionName);
    nodes.push(buildEndpointTmuxNode(endpoint, target, tmuxSession));
  }

  for (const tmuxSession of tmuxSessions) {
    if (representedTmuxSessions.has(tmuxSession.name)) {
      continue;
    }
    nodes.push(buildStandaloneTmuxNode(tmuxSession));
  }

  nodes.sort(compareNodes);
  nodes.forEach((node, index) => {
    node.layout = layoutForIndex(index);
  });

  const focusedNodeId = focusAgentId
    ? nodes.find((node) => node.endpoint?.agentId === focusAgentId)?.id ?? null
    : null;
  if (focusAgentId && !focusedNodeId) {
    diagnostics.push({
      code: "focus_agent_missing",
      severity: "info",
      message: `No Vantage node matched focus agent ${focusAgentId}.`,
      agentId: focusAgentId,
    });
  }

  if (nodes.length === 0) {
    diagnostics.push({
      code: "vantage_nodes_missing",
      severity: "warning",
      message: "No Vantage nodes could be built from the provided broker and tmux data.",
    });
  }

  return {
    schema: SCOUT_VANTAGE_PLAN_SCHEMA,
    createdAt: generatedAt,
    currentDirectory: input.currentDirectory,
    broker: {
      reachable: Boolean(input.broker),
      baseUrl: input.broker?.baseUrl ?? null,
      nodeId: brokerNode?.id ?? null,
    },
    manifest: {
      kind: HUDSON_VANTAGE_SETUP_KIND,
      schemaVersion: HUDSON_VANTAGE_SCHEMA_VERSION,
      source: "openscout",
      generatedAt,
      currentDirectory: input.currentDirectory,
      broker: buildBrokerSummary(input.broker?.baseUrl ?? null, brokerNode, brokerSnapshot),
      focus: focusAgentId ? { agentId: focusAgentId } : null,
      selection: focusedNodeId ? [focusedNodeId] : [],
      focusedNodeId,
      nodes,
    },
    diagnostics,
  };
}

function buildBrokerSummary(
  baseUrl: string | null,
  node: NodeDefinition | null,
  snapshot: RuntimeRegistrySnapshot | null,
): ScoutVantageBrokerSummary | null {
  if (!baseUrl && !node && !snapshot) {
    return null;
  }

  return {
    baseUrl,
    nodeId: node?.id ?? null,
    nodeName: node?.name ?? null,
    counts: {
      nodes: snapshot ? Object.keys(snapshot.nodes ?? {}).length : 0,
      agents: snapshot ? Object.keys(snapshot.agents ?? {}).length : 0,
      endpoints: snapshot ? Object.keys(snapshot.endpoints ?? {}).length : 0,
    },
  };
}

function sortedEndpoints(snapshot: RuntimeRegistrySnapshot | null): AgentEndpoint[] {
  return Object.values(snapshot?.endpoints ?? {}).sort((left, right) => left.id.localeCompare(right.id));
}

function endpointTmuxTarget(endpoint: AgentEndpoint): EndpointTmuxTarget | null {
  const debugTransport = endpointDebugTransport(endpoint);
  if (debugTransport) {
    return {
      sessionName: debugTransport.sessionName,
      paneTarget: debugTransport.paneTarget,
      cwd: debugTransport.cwd ?? endpoint.cwd ?? null,
      attachable: isDebugTransportAttachable(debugTransport),
      detail: debugTransport.detail ?? null,
    };
  }

  if (endpoint.transport !== "tmux") {
    return null;
  }

  const sessionName = endpoint.sessionId ?? metadataString(endpoint, "tmuxSession");
  if (!sessionName) {
    return null;
  }

  return {
    sessionName,
    paneTarget: endpoint.pane,
    cwd: endpoint.cwd ?? null,
    attachable: endpoint.state !== "offline",
    detail: endpoint.state === "offline" ? "endpoint is offline" : null,
  };
}

function endpointDebugTransport(endpoint: AgentEndpoint): AgentEndpointDebugTransport | null {
  const value = endpoint.metadata?.debugTransport;
  if (!isRecord(value) || value.kind !== "tmux" || typeof value.sessionName !== "string" || value.sessionName.length === 0) {
    return null;
  }

  return {
    kind: "tmux",
    state: debugTransportState(value.state),
    sessionName: value.sessionName,
    paneTarget: typeof value.paneTarget === "string" ? value.paneTarget : undefined,
    cwd: typeof value.cwd === "string" ? value.cwd : undefined,
    attachable: value.attachable === true,
    multiAttach: value.multiAttach === true,
    lastProbeAt: typeof value.lastProbeAt === "number" ? value.lastProbeAt : 0,
    lastAttachAt: typeof value.lastAttachAt === "number" ? value.lastAttachAt : undefined,
    lastDetachAt: typeof value.lastDetachAt === "number" ? value.lastDetachAt : undefined,
    activeClients: typeof value.activeClients === "number" ? value.activeClients : undefined,
    detail: typeof value.detail === "string" ? value.detail : undefined,
  };
}

function debugTransportState(value: unknown): AgentEndpointDebugTransport["state"] {
  return value === "ready" || value === "starting" || value === "missing" || value === "stale" || value === "error"
    ? value
    : "error";
}

function buildEndpointTmuxNode(
  endpoint: AgentEndpoint,
  target: EndpointTmuxTarget,
  tmuxSession: TmuxSession,
): ScoutVantageTmuxNode {
  return {
    id: stableNodeId("endpoint", endpoint.id),
    runtimeKind: "tmux",
    source: "broker-endpoint",
    title: endpointTitle(endpoint, target.sessionName),
    target: target.paneTarget ?? target.sessionName,
    layout: layoutForIndex(0),
    tmux: {
      sessionName: target.sessionName,
      paneTarget: target.paneTarget,
      createdAt: tmuxSession.createdAt,
      command: buildTmuxAttachCommand(target.sessionName),
      terminalRelay: {
        backend: "tmux",
        tmuxSession: target.sessionName,
      },
    },
    endpoint: {
      id: endpoint.id,
      agentId: endpoint.agentId,
      nodeId: endpoint.nodeId,
      harness: endpoint.harness,
      transport: endpoint.transport,
      state: endpoint.state,
    },
    cwd: target.cwd,
    projectRoot: endpoint.projectRoot ?? null,
  };
}

function buildStandaloneTmuxNode(tmuxSession: TmuxSession): ScoutVantageTmuxNode {
  return {
    id: stableNodeId("tmux", tmuxSession.name),
    runtimeKind: "tmux",
    source: "tmux-session",
    title: tmuxSession.name,
    target: tmuxSession.name,
    layout: layoutForIndex(0),
    tmux: {
      sessionName: tmuxSession.name,
      createdAt: tmuxSession.createdAt,
      command: buildTmuxAttachCommand(tmuxSession.name),
      terminalRelay: {
        backend: "tmux",
        tmuxSession: tmuxSession.name,
      },
    },
    cwd: null,
    projectRoot: null,
  };
}

function endpointTitle(endpoint: AgentEndpoint, sessionName: string): string {
  const agentName = metadataString(endpoint, "agentName") ?? metadataString(endpoint, "definitionId") ?? endpoint.agentId;
  return `${agentName} (${sessionName})`;
}

function layoutForIndex(index: number): ScoutVantageNodeLayout {
  const column = index % NODES_PER_ROW;
  const row = Math.floor(index / NODES_PER_ROW);
  return {
    x: column * (NODE_WIDTH + NODE_GAP_X),
    y: row * (NODE_HEIGHT + NODE_GAP_Y),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  };
}

function compareNodes(left: ScoutVantageNode, right: ScoutVantageNode): number {
  const sourceRank = left.source.localeCompare(right.source);
  if (sourceRank !== 0) {
    return sourceRank;
  }
  return left.id.localeCompare(right.id);
}

function compareTmuxSessions(left: TmuxSession, right: TmuxSession): number {
  return left.name.localeCompare(right.name);
}

function tmuxTargetKey(target: Pick<EndpointTmuxTarget, "sessionName" | "paneTarget">): string {
  return `${target.sessionName}\t${target.paneTarget ?? ""}`;
}

function stableNodeId(kind: "endpoint" | "tmux", value: string): string {
  return `vantage.${kind}.${slugify(value)}.${fnv1a(value)}`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "node";
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function metadataString(endpoint: AgentEndpoint, key: string): string | null {
  const value = endpoint.metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
