/**
 * Types served to the iOS app via the bridge router.
 *
 * These shapes intentionally mirror what the mobile client expects so the
 * bridge can fulfil reads from SQLite without round-tripping the broker.
 */

export type MobileAgentSummary = {
  id: string;
  title: string;
  selector: string | null;
  defaultSelector: string | null;
  workspaceRoot: string | null;
  harness: string | null;
  transport: string | null;
  state: "offline" | "available" | "working";
  statusLabel: string;
  sessionId: string | null;
  /// The broker conversation the phone should open for this agent — its operator
  /// DM if one exists, else the most-recent thread it actually posted in (an
  /// ask/`c.…` conversation), else the canonical `dm.operator.<id>` it'll be
  /// created under on first send. Routing taps by this (not `sessionId`, which is
  /// only ever the operator-DM id and misses ask threads) is what makes the
  /// transcript load. snapshot/live-events/send all key off this id.
  conversationId: string | null;
  lastActiveAt: number | null;
};

export type MobileSessionSummary = {
  id: string;
  kind: string;
  title: string;
  alias?: string | null;
  naturalKey?: string | null;
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

export type MobileWorkspaceSummary = {
  id: string;
  title: string;
  projectName: string;
  root: string;
  sourceRoot: string;
  relativePath: string;
  registrationKind: string;
  defaultHarness: string;
  harnesses: Array<{
    harness: string;
    source: "manifest" | "marker" | "default" | "endpoint";
    detail: string;
    readinessState: "ready" | "configured" | "installed" | "missing" | null;
    readinessDetail: string | null;
  }>;
};

export type MobileAgentDetail = MobileAgentSummary & {
  cwd: string | null;
  wakePolicy: string | null;
  capabilities: string[];
  branch: string | null;
  role: string | null;
  model: string | null;
  activeFlights: Array<{
    id: string;
    state: string;
    summary: string | null;
    startedAt: number | null;
  }>;
  recentActivity: Array<{
    id: string;
    kind: string;
    ts: number;
    title: string | null;
    summary: string | null;
  }>;
  messageCount: number;
};
