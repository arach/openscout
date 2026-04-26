/* ── Shared types for the Scout web UI ── */

export type Agent = {
  id: string;
  name: string;
  handle: string | null;
  agentClass: string;
  harness: string | null;
  state: string | null;
  projectRoot: string | null;
  cwd: string | null;
  updatedAt: number | null;
  transport: string | null;
  selector: string | null;
  wakePolicy: string | null;
  capabilities: string[];
  project: string | null;
  branch: string | null;
  role: string | null;
  harnessSessionId: string | null;
  harnessLogPath: string | null;
  conversationId: string;
};

export type Message = {
  id: string;
  conversationId: string;
  actorName: string;
  body: string;
  createdAt: number;
  class: string;
  metadata?: Record<string, unknown> | null;
};

export type ActivityItem = {
  id: string;
  kind: string;
  ts: number;
  actorName: string | null;
  title: string | null;
  summary: string | null;
  conversationId: string | null;
  workspaceRoot: string | null;
};

export type FleetActivity = ActivityItem & {
  actorId: string | null;
  agentId: string | null;
  flightId: string | null;
  invocationId: string | null;
  messageId: string | null;
  recordId: string | null;
  sessionId: string | null;
};

export type FleetAsk = {
  invocationId: string;
  flightId: string | null;
  agentId: string;
  agentName: string | null;
  conversationId: string | null;
  collaborationRecordId: string | null;
  task: string;
  status: "queued" | "working" | "needs_attention" | "completed" | "failed";
  statusLabel: string;
  attention: "silent" | "badge" | "interrupt";
  agentState: "offline" | "available" | "working";
  harness: string | null;
  transport: string | null;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
};

export type FleetAttentionItem = {
  kind: "question" | "work_item";
  recordId: string;
  title: string;
  summary: string | null;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
  state: string;
  acceptanceState: string;
  updatedAt: number;
};

export type FleetState = {
  generatedAt: number;
  totals: {
    active: number;
    recentCompleted: number;
    needsAttention: number;
    activity: number;
  };
  activeAsks: FleetAsk[];
  recentCompleted: FleetAsk[];
  needsAttention: FleetAttentionItem[];
  activity: FleetActivity[];
};

export type PairingSnapshot = {
  qrValue?: string | null;
  expiresAt?: number;
  relay?: string | null;
} | null;

export type TrustedPeer = {
  fingerprint: string;
  name: string | null;
  pairedAtLabel: string;
  lastSeenLabel: string;
};

export type PairingState = {
  status: string;
  statusLabel: string;
  statusDetail: string | null;
  isRunning: boolean;
  commandLabel: string;
  pairing: PairingSnapshot;
  lastUpdatedLabel: string | null;
  relay: string | null;
  secure: boolean;
  identityFingerprint: string | null;
  connectedPeerFingerprint: string | null;
  trustedPeerCount: number;
  trustedPeers: TrustedPeer[];
};

export type Flight = {
  id: string;
  invocationId: string;
  agentId: string;
  agentName: string | null;
  conversationId: string | null;
  collaborationRecordId: string | null;
  state: string;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
};

export type WorkItem = {
  id: string;
  title: string;
  summary: string | null;
  ownerId: string | null;
  ownerName: string | null;
  nextMoveOwnerId: string | null;
  nextMoveOwnerName: string | null;
  conversationId: string | null;
  state: string;
  acceptanceState: string;
  priority: string | null;
  currentPhase: string;
  attention: "silent" | "badge" | "interrupt";
  activeChildWorkCount: number;
  activeFlightCount: number;
  lastMeaningfulAt: number;
  lastMeaningfulSummary: string | null;
};

/** An inbox row: agent + conversation summary merged. */
export type InboxEntry = {
  agent: Agent;
  conversationId: string;
  preview: string | null;
  previewActor: string | null;
  messageCount: number;
  lastMessageAt: number | null;
};

/** A conversation from the sessions list (any kind, not just DMs). */
export type SessionEntry = {
  id: string;
  kind: string;
  title: string;
  participantIds: string[];
  agentId: string | null;
  agentName: string | null;
  harness: string | null;
  harnessSessionId: string | null;
  harnessLogPath: string | null;
  currentBranch: string | null;
  preview: string | null;
  messageCount: number;
  lastMessageAt: number | null;
  workspaceRoot: string | null;
};

export type ObserveEvent = {
  id: string;
  t: number;
  kind: "think" | "tool" | "ask" | "message" | "note" | "system" | "boot";
  text: string;
  tool?: string;
  arg?: string;
  diff?: { add: number; del: number; preview: string };
  result?: Record<string, string | number>;
  stream?: string[];
  live?: boolean;
  to?: string;
  answer?: string;
  answerT?: number;
  detail?: string;
};

export type ObserveFile = {
  path: string;
  state: "read" | "created" | "modified";
  touches: number;
  lastT: number;
};

export type ObserveUsageMeta = {
  assistantMessages?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalTokens?: number;
  contextWindowTokens?: number;
  webSearchRequests?: number;
  webFetchRequests?: number;
  serviceTier?: string;
  speed?: string;
  planType?: string;
};

export type ObserveSessionMeta = {
  adapterType?: string;
  model?: string;
  cwd?: string;
  turnCount?: number;
  externalSessionId?: string;
  threadId?: string;
  threadPath?: string;
  gitBranch?: string;
  cliVersion?: string;
  entrypoint?: string;
  originator?: string;
  source?: string;
  permissionMode?: string;
  approvalPolicy?: string;
  sandbox?: string;
  userType?: string;
  effort?: string;
  modelProvider?: string;
  timezone?: string;
};

export type ObserveMetadata = {
  session?: ObserveSessionMeta;
  usage?: ObserveUsageMeta;
};

export type ObserveData = {
  events: ObserveEvent[];
  files: ObserveFile[];
  contextUsage?: number[];
  live?: boolean;
  metadata?: ObserveMetadata;
};

export type AgentObservePayload = {
  agentId: string;
  source: "history" | "live" | "unavailable";
  fidelity: "timestamped" | "synthetic";
  historyPath: string | null;
  sessionId: string | null;
  updatedAt: number;
  data: ObserveData;
};

export type SessionCatalogEntry = {
  id: string;
  startedAt: number;
  endedAt?: number;
  cwd: string;
};

export type SessionCatalog = {
  activeSessionId: string | null;
  sessions: SessionCatalogEntry[];
};

export type SessionCatalogWithResume = SessionCatalog & {
  agentId: string;
  harness: string | null;
  resumeCommand: string | null;
};

export type InterruptThreshold = "always" | "blocking-only" | "batched" | "never";
export type CommsChannel = "here" | "mobile" | "here+mobile";
export type CommsVerbosity = "terse" | "normal" | "detailed";
export type CommsTone = "direct" | "warm" | "formal";

export type OperatorProfile = {
  name: string;
  handle: string;
  pronouns: string;
  hue: number;
  bio: string;
  timezone: string;
  workingHours: string;
  interruptThreshold: InterruptThreshold;
  batchWindow: number;
  channel: CommsChannel;
  verbosity: CommsVerbosity;
  tone: CommsTone;
  quietHours: string;
};

/** Mesh status report from the broker. */
export type MeshIssue = {
  code:
    | "broker_unreachable"
    | "tailscale_stopped"
    | "local_only"
    | "mesh_loopback"
    | "discovery_unconfigured";
  severity: "warning" | "error";
  title: string;
  summary: string;
  action: string | null;
  actionCommand: string | null;
};

export type MeshStatus = {
  brokerUrl: string;
  health: {
    reachable: boolean;
    ok: boolean;
    nodeId: string | null;
    meshId: string | null;
    error: string | null;
  };
  localNode: {
    id: string;
    name: string;
    meshId?: string;
    hostName?: string;
    advertiseScope?: string;
    brokerUrl?: string;
  } | null;
  meshId: string | null;
  identity: {
    name: string | null;
    nodeId: string | null;
    meshId: string | null;
    modeLabel: string;
    discoverable: boolean;
    announceUrl: string | null;
    discoveryDetail: string;
  };
  nodes: Record<
    string,
    {
      id: string;
      name: string;
      meshId?: string;
      hostName?: string;
      advertiseScope?: string;
      brokerUrl?: string;
      registeredAt?: number;
      lastSeenAt?: number;
    }
  >;
  tailscale: {
    available: boolean;
    running: boolean;
    backendState: string | null;
    health: string[];
    onlineCount: number;
    peers: Array<{
      id: string;
      name: string;
      dnsName?: string;
      hostName?: string;
      addresses: string[];
      online: boolean;
      os?: string;
    }>;
  };
  issues: MeshIssue[];
  warnings: string[];
};

export type WorkTimelineKind =
  | "collaboration_event"
  | "flight_started"
  | "flight_completed"
  | "message";

export type WorkTimelineItem = {
  id: string;
  kind: WorkTimelineKind;
  at: number;
  actorId: string | null;
  actorName: string | null;
  title: string | null;
  summary: string | null;
  detailKind: string | null;
  flightId: string | null;
  messageId: string | null;
  conversationId: string | null;
};

export type WorkDetail = WorkItem & {
  createdAt: number;
  updatedAt: number;
  parentId: string | null;
  parentTitle: string | null;
  childWork: WorkItem[];
  activeFlights: Flight[];
  timeline: WorkTimelineItem[];
};

export type Route =
  | { view: "inbox" }
  | {
      view: "conversation";
      conversationId: string;
      composeMode?: "tell" | "ask";
    }
  | { view: "agent-info"; conversationId: string }
  | {
      view: "agents";
      agentId?: string;
      conversationId?: string;
      tab?: AgentTab;
    }
  | { view: "fleet" }
  | { view: "sessions"; sessionId?: string }
  | { view: "mesh" }
  | { view: "activity" }
  | { view: "work"; workId: string }
  | { view: "settings" }
  | { view: "ops"; mode?: OpsMode }
  | { view: "terminal"; agentId?: string };

export type AgentTab = "profile" | "observe" | "message";
export type OpsMode = "plan" | "conductor" | "warroom" | "mission" | "tail";

/* ── Tail (Ops > Tail) types ── */

export type TailHarness = "scout-managed" | "hudson-managed" | "unattributed";
export type TailEventKind =
  | "user"
  | "assistant"
  | "tool"
  | "tool-result"
  | "system"
  | "other";

export type TailEvent = {
  id: string;
  ts: number;
  source: string;
  sessionId: string;
  pid: number;
  parentPid: number | null;
  project: string;
  cwd: string;
  harness: TailHarness;
  kind: TailEventKind;
  summary: string;
  raw?: unknown;
};

export type TailDiscoveredProcess = {
  pid: number;
  ppid: number;
  command: string;
  etime: string;
  cwd: string | null;
  harness: TailHarness;
  parentChain: { pid: number; command: string }[];
  source: string;
};

export type TailDiscoverySnapshot = {
  generatedAt: number;
  processes: TailDiscoveredProcess[];
  totals: {
    total: number;
    scoutManaged: number;
    hudsonManaged: number;
    unattributed: number;
  };
};

/* ── Ops types (Plan view) ── */

export type MissionBrief = {
  title: string;
  goal: string;
  rationale: string;
  deadline: string;
  confidence: number;
  lastReproposedMinsAgo: number;
};

export type MissionNodeKind = "mission" | "phase" | "task";
export type MissionNodeState =
  | "proposed"
  | "committed"
  | "inflight"
  | "done"
  | "stuck";

export type MissionTreeNode = {
  id: string;
  kind: MissionNodeKind;
  title: string;
  why?: string;
  state: MissionNodeState;
  assignee?: string;
  confidence?: number;
  progress?: number;
  detail?: string;
  stuckMins?: number;
  children?: MissionTreeNode[];
};

export type PlanChange = {
  id: string;
  kind: "split" | "demote" | "promote" | "unassign" | "add";
  summary: string;
  why: string;
  status: "pending" | "accepted";
  minsAgo: number;
};

export type PlanRisk = {
  id: string;
  title: string;
  detail: string;
  severity: "high" | "med" | "low";
};

export type ToolTickerItem = {
  agent: string;
  tool: string;
  result: string;
};
