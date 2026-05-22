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

export type ScoutVantageNativeSession = {
  id: string;
  source: string;
  sessionId: string | null;
  transcriptPath: string;
  project: string;
  harness: string | null;
  cwd: string | null;
  mtimeMs: number | null;
  tmuxSessionName: string;
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
  nativeSessions?: readonly ScoutVantageNativeSession[];
  focusAgentId?: string | null;
  focusNativeSessionId?: string | null;
  selectedAgentIds?: readonly string[];
  selectedNativeSessionIds?: readonly string[];
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
  workspaceID: string;
  source: "openscout";
  handoffId?: string;
  handoffPath?: string;
  setupPath?: string;
  generatedAt: string;
  currentDirectory: string;
  broker: ScoutVantageBrokerSummary | null;
  presentation?: HudsonVantageSetupPresentation;
  style?: HudsonVantageSetupStyle;
  viewport?: { fit?: boolean };
  layout?: HudsonVantageSetupSurfaceLayout;
  focus: ScoutVantageFocus | null;
  selectedAgentIds: string[];
  selectedNativeSessionIds: string[];
  selection: string[];
  focused: string | null;
  focusedNodeId: string | null;
  nodes: ScoutVantageNode[];
};

export type HudsonVantageSetupPresentation = {
  title?: string;
  subtitle?: string;
  badge?: string;
  cobrand?: string;
  productName?: string;
  hostName?: string;
  theme?: string;
  accent?: string;
};

export type HudsonVantageSetupStyle = {
  preset?: string;
  canvasGridMode?: "dots" | "lines" | "none";
  canvasGridStep?: number;
  focusPadding?: number;
};

export type HudsonVantageSetupSurfaceLayout = {
  canvasTool?: "select" | "hand";
  navigationFilter?: string;
  minimapCollapsed?: boolean;
  inspectorCollapsed?: boolean;
};

export type ScoutVantageFocus = {
  agentId?: string;
  nativeSessionId?: string;
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
  source: "broker-endpoint" | "tmux-session" | "tail-transcript";
  title: string;
  subtitle?: string;
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
  nativeSession?: {
    id: string;
    source: string;
    sessionId: string | null;
    transcriptPath: string;
    project: string;
    harness: string | null;
    mtimeMs: number | null;
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
    | "focus_native_session_missing"
    | "selected_agent_missing"
    | "selected_native_session_missing"
    | "native_tail_tmux_session_missing"
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
  const nativeSessions = [...(input.nativeSessions ?? [])].sort(compareNativeSessions);
  const focusAgentId = input.focusAgentId?.trim() || null;
  const selectedAgentIds = uniqueIds(input.selectedAgentIds ?? []);
  const selectedNativeSessionIds = uniqueIds(input.selectedNativeSessionIds ?? []);
  const focusNativeSessionId = input.focusNativeSessionId?.trim()
    || (!focusAgentId ? selectedNativeSessionIds[0] : null)
    || null;
  const selectedAgentIdSet = new Set(selectedAgentIds);
  const selectedNativeSessionIdSet = new Set(selectedNativeSessionIds);
  const hasExplicitSelection = selectedAgentIds.length > 0 || selectedNativeSessionIds.length > 0;
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
    if (hasExplicitSelection && !selectedAgentIdSet.has(endpoint.agentId)) {
      continue;
    }

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

  for (const nativeSession of nativeSessions) {
    if (selectedNativeSessionIds.length > 0 && !selectedNativeSessionIdSet.has(nativeSession.id)) {
      continue;
    }

    const tmuxSession = tmuxSessionByName.get(nativeSession.tmuxSessionName);
    if (!tmuxSession) {
      diagnostics.push({
        code: "native_tail_tmux_session_missing",
        severity: "warning",
        message: `Native session ${nativeSession.id} points at tmux session ${nativeSession.tmuxSessionName}, but that session was not provided.`,
        sessionName: nativeSession.tmuxSessionName,
      });
      continue;
    }

    representedTmuxSessions.add(nativeSession.tmuxSessionName);
    nodes.push(buildNativeTailTmuxNode(nativeSession, tmuxSession));
  }

  if (!hasExplicitSelection) {
    for (const tmuxSession of tmuxSessions) {
      if (representedTmuxSessions.has(tmuxSession.name)) {
        continue;
      }
      nodes.push(buildStandaloneTmuxNode(tmuxSession));
    }
  }

  for (const agentId of selectedAgentIds) {
    const hasNode = nodes.some((node) => node.endpoint?.agentId === agentId);
    if (!hasNode) {
      diagnostics.push({
        code: "selected_agent_missing",
        severity: "info",
        message: `No Vantage node matched selected agent ${agentId}.`,
        agentId,
      });
    }
  }

  for (const nativeSessionId of selectedNativeSessionIds) {
    const hasNode = nodes.some((node) => node.nativeSession?.id === nativeSessionId);
    if (!hasNode) {
      diagnostics.push({
        code: "selected_native_session_missing",
        severity: "info",
        message: `No Vantage node matched selected native session ${nativeSessionId}.`,
      });
    }
  }

  nodes.sort(compareNodes);
  nodes.forEach((node, index) => {
    node.layout = layoutForIndex(index);
  });

  const focusedNodeId = focusAgentId
    ? nodes.find((node) => node.endpoint?.agentId === focusAgentId)?.id ?? null
    : focusNativeSessionId
      ? nodes.find((node) => node.nativeSession?.id === focusNativeSessionId)?.id ?? null
    : null;
  if (focusAgentId && !focusedNodeId) {
    diagnostics.push({
      code: "focus_agent_missing",
      severity: "info",
      message: `No Vantage node matched focus agent ${focusAgentId}.`,
      agentId: focusAgentId,
    });
  }
  if (!focusAgentId && focusNativeSessionId && !focusedNodeId) {
    diagnostics.push({
      code: "focus_native_session_missing",
      severity: "info",
      message: `No Vantage node matched focus native session ${focusNativeSessionId}.`,
    });
  }

  if (nodes.length === 0) {
    diagnostics.push({
      code: "vantage_nodes_missing",
      severity: "warning",
      message: "No Vantage nodes could be built from the provided broker and tmux data.",
    });
  }

  const selectedNodeIds = hasExplicitSelection
    ? nodes
      .filter((node) =>
        (node.endpoint?.agentId ? selectedAgentIdSet.has(node.endpoint.agentId) : false)
        || (node.nativeSession?.id ? selectedNativeSessionIdSet.has(node.nativeSession.id) : false)
      )
      .map((node) => node.id)
    : [];

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
      workspaceID: workspaceIdFor(input.currentDirectory),
      source: "openscout",
      generatedAt,
      currentDirectory: input.currentDirectory,
      broker: buildBrokerSummary(input.broker?.baseUrl ?? null, brokerNode, brokerSnapshot),
      presentation: {
        title: "Scout Vantage",
        subtitle: "local runtime handoff",
        badge: "runtime",
        cobrand: "OpenScout",
        productName: "Scout",
        hostName: "Hudson Vantage",
        theme: "jade",
        accent: "cyan",
      },
      style: {
        preset: "jade",
        canvasGridMode: "dots",
        canvasGridStep: 18,
        focusPadding: 12,
      },
      viewport: { fit: true },
      layout: {
        canvasTool: "select",
        navigationFilter: "all",
        minimapCollapsed: false,
        inspectorCollapsed: false,
      },
      focus: focusAgentId
        ? { agentId: focusAgentId }
        : focusNativeSessionId ? { nativeSessionId: focusNativeSessionId } : null,
      selectedAgentIds,
      selectedNativeSessionIds,
      selection: hasExplicitSelection ? selectedNodeIds : focusedNodeId ? [focusedNodeId] : [],
      focused: focusedNodeId,
      focusedNodeId,
      nodes,
    },
    diagnostics,
  };
}

function uniqueIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const id = value.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
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

function buildNativeTailTmuxNode(
  nativeSession: ScoutVantageNativeSession,
  tmuxSession: TmuxSession,
): ScoutVantageTmuxNode {
  return {
    id: stableNodeId("native", nativeSession.id),
    runtimeKind: "tmux",
    source: "tail-transcript",
    title: nativeSessionTitle(nativeSession),
    subtitle: `${nativeSession.source} tail · ${nativeSession.project}`,
    target: nativeSession.tmuxSessionName,
    layout: layoutForIndex(0),
    tmux: {
      sessionName: nativeSession.tmuxSessionName,
      createdAt: tmuxSession.createdAt,
      command: buildTmuxAttachCommand(nativeSession.tmuxSessionName),
      terminalRelay: {
        backend: "tmux",
        tmuxSession: nativeSession.tmuxSessionName,
      },
    },
    nativeSession: {
      id: nativeSession.id,
      source: nativeSession.source,
      sessionId: nativeSession.sessionId,
      transcriptPath: nativeSession.transcriptPath,
      project: nativeSession.project,
      harness: nativeSession.harness,
      mtimeMs: nativeSession.mtimeMs,
    },
    cwd: nativeSession.cwd,
    projectRoot: nativeSession.cwd,
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

function compareNativeSessions(left: ScoutVantageNativeSession, right: ScoutVantageNativeSession): number {
  return left.id.localeCompare(right.id);
}

function tmuxTargetKey(target: Pick<EndpointTmuxTarget, "sessionName" | "paneTarget">): string {
  return `${target.sessionName}\t${target.paneTarget ?? ""}`;
}

function stableNodeId(kind: "endpoint" | "tmux" | "native", value: string): string {
  return `vantage.${kind}.${slugify(value)}.${fnv1a(value)}`;
}

function workspaceIdFor(currentDirectory: string): string {
  const lastSegment = currentDirectory
    .split(/[\\/]+/g)
    .filter(Boolean)
    .at(-1) ?? "workspace";
  return `openscout-${slugify(lastSegment)}`;
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

function nativeSessionTitle(nativeSession: ScoutVantageNativeSession): string {
  const session = nativeSession.sessionId ? ` ${nativeSession.sessionId.slice(0, 8)}` : "";
  return `${titleCase(nativeSession.source)}${session}`;
}

function titleCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : "Native";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
