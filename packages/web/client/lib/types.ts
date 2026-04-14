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
};

export type Message = {
  id: string;
  conversationId: string;
  actorName: string;
  body: string;
  createdAt: number;
  class: string;
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
  state: string;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
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
  currentBranch: string | null;
  preview: string | null;
  messageCount: number;
  lastMessageAt: number | null;
  workspaceRoot: string | null;
};

/** Mesh status report from the broker. */
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
  nodes: Record<string, {
    id: string;
    name: string;
    meshId?: string;
    hostName?: string;
    advertiseScope?: string;
    brokerUrl?: string;
    registeredAt?: number;
  }>;
  tailscale: {
    available: boolean;
    onlineCount: number;
    peers: Array<{ id: string; name: string; hostName?: string; addresses: string[]; online: boolean; os?: string }>;
  };
  warnings: string[];
};

export type Route =
  | { view: "inbox" }
  | { view: "conversation"; conversationId: string }
  | { view: "agent-info"; conversationId: string }
  | { view: "agents"; agentId?: string }
  | { view: "sessions" }
  | { view: "mesh" }
  | { view: "activity" }
  | { view: "settings" };
