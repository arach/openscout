/**
 * HUD mock data — single source of truth.
 *
 * The interactive playground and the locked per-size study pages all
 * import from here so the screens stay in lockstep instead of drifting
 * across three hand-written copies.
 */

import type {
  ActivityBucket,
  ActivityCategory,
  ActivityKind,
  AgentSession,
  FirehoseEvent,
  FirehoseKind,
  FleetAgent,
  ObserveBucket,
  ScoutThreadMessage,
} from "./types";

// ─── Agents (formerly "fleet") ──────────────────────────────────────

export const AGENTS: FleetAgent[] = [
  {
    id: "hudson",
    name: "Hudson",
    handle: "@hudson",
    state: "working",
    stateLabel: "WORKING",
    pulse: [4, 5, 6, 7, 8, 7, 6, 7],
    work: "Reviewing PR #214 — inspector atom rollout",
    lastAction:
      "Pulled AgentRow into a shared atom — three call sites updated",
    lastActionAgo: "12s",
    ago: "12s",
    selected: true,
    isWorking: true,
    capabilities: ["edit", "review", "test"],
    recentActions: [
      "Pulled AgentRow into a shared atom",
      "Updated three call sites",
      "Opened PR #214",
    ],
    recentActionAgos: ["12s", "1m", "3m"],
    lastTurnText:
      "Walked the audit-trail emit calls across the four sign-in paths. Magic-link and SSO are clean; password reset is missing a `reason` field on the failure branch. Drafting the patch before I flag it.",
    turnBufferPosition: 5,
    turnBufferTotal: 5,
    branch: "feat/audit-trail",
    cwd: "control-plane",
    model: "opus-4-7",
  },
  // QB: spike then flatline → waiting on the operator
  {
    id: "qb",
    name: "QB",
    handle: "@qb",
    state: "needs-attention",
    stateLabel: "NEEDS ATTENTION",
    pulse: [2, 3, 5, 7, 8, 1, 0, 0],
    work: "Decide push of flight 0c8fee to staging",
    lastAction:
      "Replied: awaiting your call on whether the schema migration runs on deploy",
    lastActionAgo: "1m",
    ago: "1m",
    capabilities: ["plan", "ask", "deploy"],
    recentActions: [
      "Drafted deploy plan",
      "Asked: run migration on deploy?",
      "Paused for operator input",
    ],
    recentActionAgos: ["1m", "2m", "3m"],
    lastTurnText:
      "Flight 0c8fee is ready, but the deploy will trigger the schema migration on apply. I need your call on whether to roll the migration with the deploy or hold it for a separate window. Two PRs are queued behind this decision.",
    turnBufferPosition: 3,
    turnBufferTotal: 5,
    branch: "deploy/0c8fee",
    cwd: "control-plane",
    model: "opus-4-7",
  },
  {
    id: "scout",
    name: "Scout",
    handle: "@scout",
    state: "available",
    stateLabel: "AVAILABLE",
    pulse: [0, 0, 0, 0, 0, 0, 0, 0],
    work: "idle, ready to dispatch",
    lastAction: null,
    lastActionAgo: null,
    ago: "4m",
    capabilities: ["dispatch", "search", "index"],
    recentActions: ["Indexed 14 new files", "Idle"],
    recentActionAgos: ["4m", "4m"],
    lastTurnText:
      "Index refresh covered the new inspector atoms surface — fourteen files picked up. Search readiness reports green across the board. Holding here, ready to dispatch on the next request.",
    turnBufferPosition: 2,
    turnBufferTotal: 5,
    branch: "main",
    cwd: "openscout",
    model: "haiku-4-7",
  },
  {
    id: "atlas",
    name: "Atlas",
    handle: "@atlas",
    state: "idle",
    stateLabel: "WAITING",
    pulse: [1, 2, 1, 2, 1, 1, 2, 1],
    work: "holding on broker reply",
    lastAction: "Sent: needs the migration file when you're done",
    lastActionAgo: "4m",
    ago: "11m",
    capabilities: ["chat", "broker"],
    recentActions: [
      "Sent: needs the migration file",
      "Idle, awaiting reply",
    ],
    recentActionAgos: ["4m", "11m"],
    lastTurnText:
      "Pinged Drover for the migration file the moment it lands — I want to verify the audit trail spans both schemas before signing off. Holding on the broker reply; no code in flight on my end.",
    turnBufferPosition: 4,
    turnBufferTotal: 5,
    branch: "feat/broker-link",
    cwd: "control-plane",
    model: "sonnet-4-7",
  },
  // Drover: a run that wound down — strong activity then flatline
  {
    id: "drover",
    name: "Drover",
    handle: "@drover",
    state: "available",
    stateLabel: "DONE",
    pulse: [6, 7, 8, 6, 4, 2, 0, 0],
    work: "Finished migration sweep",
    lastAction: "Touched 6 files in atoms/inspector-section",
    lastActionAgo: "32m",
    ago: "32m",
    capabilities: ["migrate", "edit", "sweep"],
    recentActions: [
      "Started migration sweep",
      "Touched 6 files",
      "Finished sweep",
    ],
    recentActionAgos: ["32m", "28m", "1h"],
    lastTurnText:
      "Migration sweep through atoms/inspector-section is done — six files rewritten, all type-checks green. Handed the diff back to the queue. Standing down unless something flagged on the trail downstream.",
    turnBufferPosition: 5,
    turnBufferTotal: 5,
    branch: "infra/sessions-split",
    cwd: "control-plane",
    model: "opus-4-7",
  },
  // Cobalt: trailing-off — last hour faintly, then nothing
  {
    id: "cobalt",
    name: "Cobalt",
    handle: "@cobalt",
    state: "offline",
    stateLabel: "OFFLINE",
    pulse: [3, 2, 1, 0, 0, 0, 0, 0],
    work: "last seen on design/atlas-iconography",
    lastAction: "Last seen working on design/atlas-iconography",
    lastActionAgo: "2h",
    ago: "2h",
    dim: true,
    capabilities: ["design", "icon"],
    recentActions: [
      "Worked on design/atlas-iconography",
      "Went offline",
    ],
    recentActionAgos: ["2h", "2h"],
    lastTurnText:
      "Last work session ended mid-pass on the atlas iconography sweep — three glyphs left to redraw before the set is consistent at 14/18/24. No code in flight, no files dirty. Will resume when summoned.",
    turnBufferPosition: 1,
    turnBufferTotal: 5,
    branch: "design/atlas-iconography",
    cwd: "design/studio",
    model: "sonnet-4-7",
  },
];

export const FLEET = AGENTS;

// ─── Activity (structured event ledger) ─────────────────────────────

export const ACTIVITY: ActivityBucket[] = [
  {
    eyebrow: "LEDGER · JUST NOW",
    headline: "Just now",
    events: [
      {
        id: "e1",
        ago: "12s",
        at: "14:32",
        agent: "Hudson",
        handle: "@hudson",
        kind: "turn",
        category: "work",
        title: "Hudson advanced PR #214",
        summary:
          "Pulled AgentRow into a shared atom; three call sites updated.",
        flightId: "0c8fee",
        detail:
          "Extracted AgentRow into atoms/agent-row and rewired the three call sites in inspector. PR #214 opened against main.",
      },
      {
        id: "e2",
        ago: "48s",
        at: "14:31",
        agent: "QB",
        handle: "@qb",
        kind: "ask",
        category: "coordination",
        title: "QB asked the operator a question",
        summary:
          "Push flight 0c8fee to staging? Schema migration runs on deploy.",
        emphasized: true,
        flightId: "0c8fee",
        detail:
          "Awaiting operator approval. Deploy will trigger the schema migration on apply. Two linked PRs queued behind this decision.",
      },
      {
        id: "e3",
        ago: "2m",
        at: "14:30",
        agent: "Scout",
        handle: "@scout",
        kind: "wire",
        category: "system",
        title: "Scout refreshed the index",
        summary:
          "Indexed 14 new files under packages/web/client/scout/inspector.",
        detail:
          "Fresh index covers the inspector atoms surface; search readiness reported green.",
      },
    ],
  },
  {
    eyebrow: "LEDGER · 60 MIN",
    headline: "Last hour",
    events: [
      {
        id: "e4",
        ago: "18m",
        at: "14:14",
        agent: "Drover",
        handle: "@drover",
        kind: "start",
        category: "work",
        title: "Drover started migration sweep",
        summary:
          "Six file targets queued in atoms/inspector-section.",
        flightId: "a912b3",
        detail:
          "Migration sweep kicked off with six file targets in atoms/inspector-section.",
      },
      {
        id: "e5",
        ago: "37m",
        at: "13:55",
        agent: "Pike",
        handle: "@pike",
        kind: "fail",
        category: "work",
        title: "Pike's build failed on macos-arm64",
        summary:
          "Missing entitlement com.apple.security.screen-capture.",
        emphasized: true,
        flightId: "f1d220",
        detail:
          "Build failed on macos-arm64. Missing entitlement com.apple.security.screen-capture. Last green build was 4h ago at f1d11c.",
      },
      {
        id: "e6",
        ago: "52m",
        at: "13:40",
        agent: "Atlas",
        handle: "@atlas",
        kind: "wire",
        category: "delivery",
        title: "Atlas messaged Drover",
        summary:
          "Asked for the migration file when the sweep lands.",
        detail:
          "Direct DM to @drover. No response yet; Atlas is idle pending reply.",
      },
    ],
  },
];

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  turn: "TURN",
  wire: "WIRE",
  ask: "ASK",
  start: "START",
  fail: "FAIL",
};

export const OBSERVE: ObserveBucket[] = ACTIVITY.map((bucket) => ({
  eyebrow: bucket.eyebrow,
  headline: bucket.headline,
  events: bucket.events.map((event) => ({
    id: event.id,
    ago: event.ago,
    at: event.at,
    agent: event.agent,
    handle: event.handle,
    kind: event.kind,
    line: event.title,
    meta: event.summary,
    summary: event.detail ?? event.summary,
    emphasized: event.emphasized,
    flightId: event.flightId,
  })),
}));

export const OBSERVE_KIND_LABEL = ACTIVITY_KIND_LABEL;

export const ACTIVITY_CATEGORY_LABEL: Record<ActivityCategory, string> = {
  presence: "PRESENCE",
  work: "EXECUTION",
  delivery: "DELIVERY",
  coordination: "COORDINATION",
  system: "SYSTEM",
};

// ─── Tail (firehose) ─────────────────────────────────────────────────
//
// Dense raw event stream. Newest at top. Mix of tool calls, messages,
// edits, lifecycle, prompts, broker pings, errors.

export const FIREHOSE: FirehoseEvent[] = [
  {
    id: "f01",
    at: "14:32:14",
    kind: "EDT",
    source: "hudson",
    line: "atoms/agent-row.tsx · +42 -18",
  },
  {
    id: "f02",
    at: "14:32:09",
    kind: "TOL",
    source: "hudson",
    line: "Edit(atoms/agent-row.tsx)",
  },
  {
    id: "f03",
    at: "14:32:02",
    kind: "TUR",
    source: "hudson",
    line: "Pulled AgentRow into a shared atom — three call sites updated.",
  },
  {
    id: "f04",
    at: "14:31:48",
    kind: "BRK",
    source: "broker",
    line: "ping · 14 agents · 3 live · rtt 9ms",
  },
  {
    id: "f05",
    at: "14:31:31",
    kind: "ASK",
    source: "qb",
    line: "Push flight 0c8fee to staging? Schema migration runs on deploy.",
    emphasized: true,
  },
  {
    id: "f06",
    at: "14:31:12",
    kind: "MSG",
    source: "qb",
    line: "→ @arach: awaiting your call on the schema migration",
  },
  {
    id: "f07",
    at: "14:30:54",
    kind: "TOL",
    source: "scout",
    line: "Grep(packages/web/client/scout/inspector, '*.tsx')",
  },
  {
    id: "f08",
    at: "14:30:41",
    kind: "TUR",
    source: "scout",
    line: "Indexed 14 new files under packages/web/client/scout/inspector.",
  },
  {
    id: "f09",
    at: "14:30:18",
    kind: "PMT",
    source: "hudson",
    line: "system · refactor inspector atoms (12.4k tokens)",
  },
  {
    id: "f10",
    at: "14:29:56",
    kind: "EDT",
    source: "hudson",
    line: "atoms/inspector-section.tsx · +6 -2",
  },
  {
    id: "f11",
    at: "14:29:33",
    kind: "TOL",
    source: "drover",
    line: "Bash(swift build -c release)",
  },
  {
    id: "f12",
    at: "14:28:50",
    kind: "MSG",
    source: "atlas",
    line: "→ @drover: needs the migration file when you're done",
  },
  {
    id: "f13",
    at: "14:28:12",
    kind: "LIF",
    source: "scout",
    line: "wake · idle → available",
  },
  {
    id: "f14",
    at: "14:27:44",
    kind: "BRK",
    source: "broker",
    line: "ping · 14 agents · 3 live · rtt 11ms",
  },
  {
    id: "f15",
    at: "14:26:31",
    kind: "ERR",
    source: "pike",
    line: "exit 65 · code signing failed — entitlements missing",
    emphasized: true,
  },
  {
    id: "f16",
    at: "14:26:09",
    kind: "TOL",
    source: "pike",
    line: "Bash(xcodebuild -scheme Grab -configuration Release)",
  },
  {
    id: "f17",
    at: "14:25:48",
    kind: "LIF",
    source: "pike",
    line: "start · macos-build worker spawned",
  },
  {
    id: "f18",
    at: "14:24:22",
    kind: "EDT",
    source: "drover",
    line: "atoms/inspector-section/header.tsx · +18 -4",
  },
  {
    id: "f19",
    at: "14:23:58",
    kind: "TUR",
    source: "drover",
    line: "Started migration sweep on atoms/inspector-section.",
  },
  {
    id: "f20",
    at: "14:23:11",
    kind: "MSG",
    source: "qb",
    line: "→ @hudson: do you want this on the deploy or held?",
  },
  {
    id: "f21",
    at: "14:22:47",
    kind: "BRK",
    source: "broker",
    line: "ping · 14 agents · 4 live · rtt 8ms",
  },
  {
    id: "f22",
    at: "14:21:30",
    kind: "PMT",
    source: "qb",
    line: "system · deploy approval flow (3.1k tokens)",
  },
  {
    id: "f23",
    at: "14:20:18",
    kind: "TOL",
    source: "atlas",
    line: "Read(packages/runtime/broker/migrations/0042.sql)",
  },
  {
    id: "f24",
    at: "14:19:55",
    kind: "LIF",
    source: "cobalt",
    line: "stop · went offline (idle 2h)",
  },
  {
    id: "f25",
    at: "14:18:22",
    kind: "EDT",
    source: "drover",
    line: "atoms/inspector-section/row.tsx · +12 -6",
  },
  {
    id: "f26",
    at: "14:17:49",
    kind: "TOL",
    source: "scout",
    line: "Glob(packages/**/inspector*)",
  },
  {
    id: "f27",
    at: "14:16:31",
    kind: "MSG",
    source: "hudson",
    line: "→ @qb: pulling AgentRow into shared atom first, then push",
  },
];

export const FIREHOSE_KIND_LABEL: Record<FirehoseKind, string> = {
  TUR: "TUR",
  MSG: "MSG",
  TOL: "TOL",
  EDT: "EDT",
  ERR: "ERR",
  LIF: "LIF",
  PMT: "PMT",
  BRK: "BRK",
  ASK: "ASK",
};

// ─── Sessions (agent run sessions) ──────────────────────────────────
//
// The working sessions of broker agents — mirrors the OpsScreen session
// ledger. NOT local tmux/iTerm sessions. Each row carries an agent
// identity, harness, status, message count, lifecycle timestamps.

export const SESSIONS: AgentSession[] = [
  {
    id: "sess-hudson-214",
    refId: "0c8fee21",
    agentName: "Hudson",
    agentHandle: "@hudson",
    harness: "claude-code",
    status: "running",
    statusLabel: "RUNNING",
    project: "openscout",
    branch: "feat/audit-trail",
    model: "opus-4-7",
    messages: 47,
    startedAgo: "1h 12m",
    startedAt: "13:20",
    endedAgo: null,
    duration: "1h 12m",
    lastTurn:
      "Pulled AgentRow into a shared atom — three call sites updated.",
    ago: "12s",
  },
  {
    id: "sess-qb-deploy",
    refId: "a912b340",
    agentName: "QB",
    agentHandle: "@qb",
    harness: "claude-code",
    status: "running",
    statusLabel: "AWAITING",
    project: "control-plane",
    branch: "deploy/0c8fee",
    model: "opus-4-7",
    messages: 23,
    startedAgo: "42m",
    startedAt: "13:50",
    endedAgo: null,
    duration: "42m",
    lastTurn:
      "Awaiting your call on whether the schema migration runs on deploy.",
    ago: "1m",
  },
  {
    id: "sess-scout-idx",
    refId: "b7c19f04",
    agentName: "Scout",
    agentHandle: "@scout",
    harness: "scout",
    status: "idle",
    statusLabel: "IDLE",
    project: "openscout",
    branch: "main",
    model: "haiku-4-7",
    messages: 9,
    startedAgo: "2h 04m",
    startedAt: "12:28",
    endedAgo: null,
    duration: "2h 04m",
    lastTurn:
      "Indexed 14 new files under packages/web/client/scout/inspector.",
    ago: "4m",
  },
  {
    id: "sess-drover-sweep",
    refId: "f1d220bb",
    agentName: "Drover",
    agentHandle: "@drover",
    harness: "codex",
    status: "ended",
    statusLabel: "ENDED",
    project: "control-plane",
    branch: "infra/sessions-split",
    model: "opus-4-7",
    messages: 38,
    startedAgo: "1h 48m",
    startedAt: "12:44",
    endedAgo: "32m",
    duration: "1h 16m",
    lastTurn:
      "Migration sweep through atoms/inspector-section is done — six files rewritten.",
    ago: "32m",
  },
  {
    id: "sess-atlas-broker",
    refId: "33aa8d11",
    agentName: "Atlas",
    agentHandle: "@atlas",
    harness: "cursor",
    status: "idle",
    statusLabel: "WAITING",
    project: "control-plane",
    branch: "feat/broker-link",
    model: "sonnet-4-7",
    messages: 14,
    startedAgo: "1h 28m",
    startedAt: "13:04",
    endedAgo: null,
    duration: "1h 28m",
    lastTurn:
      "Pinged Drover for the migration file — holding for broker reply.",
    ago: "11m",
  },
  {
    id: "sess-pike-build",
    refId: "f1d11c02",
    agentName: "Pike",
    agentHandle: "@pike",
    harness: "raw",
    status: "ended",
    statusLabel: "FAILED",
    project: "openscout",
    branch: "ci/macos-arm64",
    model: "sonnet-4-7",
    messages: 5,
    startedAgo: "44m",
    startedAt: "13:48",
    endedAgo: "37m",
    duration: "7m",
    lastTurn:
      "Build failed on macos-arm64 — missing entitlement for screen capture.",
    ago: "37m",
  },
  {
    id: "sess-cobalt-icons",
    refId: "55ccdd9e",
    agentName: "Cobalt",
    agentHandle: "@cobalt",
    harness: "claude-code",
    status: "ended",
    statusLabel: "ENDED",
    project: "design/studio",
    branch: "design/atlas-iconography",
    model: "sonnet-4-7",
    messages: 31,
    startedAgo: "4h 12m",
    startedAt: "10:20",
    endedAgo: "2h",
    duration: "2h 12m",
    lastTurn:
      "Three glyphs left to redraw before the set is consistent at 14/18/24.",
    ago: "2h",
  },
];

// ─── Assistant thread (slot 5) ──────────────────────────────────────
//
// A short morning thread to seed the playground. Mixes prose, a slash
// command, a @mention, and a file path — enough to exercise every
// inline span renderer in HudAssistant.

export const SCOUT_THREAD: ScoutThreadMessage[] = [
  {
    id: "m1",
    source: "scout",
    at: "09:14",
    body: [
      { kind: "text", text: "Morning. Five agents under broker, one on you — " },
      { kind: "mention", text: "@hudson" },
      { kind: "text", text: " is idle on a compile error. Want a status pass, or you driving?" },
    ],
  },
  {
    id: "m2",
    source: "operator",
    at: "09:14",
    body: [{ kind: "cmd", text: "/find hudson" }],
  },
  {
    id: "m3",
    source: "scout",
    at: "09:14",
    body: [
      { kind: "mention", text: "@hudson" },
      { kind: "text", text: " is on branch " },
      { kind: "code", text: "feature/migration-rename" },
      { kind: "text", text: ", idle for 7 min. Last turn flagged a compile error in " },
      { kind: "path", text: "Sources/Mesh/PresenceCache.swift" },
      { kind: "text", text: " at line 142. Open the file?" },
    ],
  },
  {
    id: "m4",
    source: "operator",
    at: "09:15",
    body: [{ kind: "text", text: "yes — and remind me what we said about the rename order yesterday" }],
  },
  {
    id: "m5",
    source: "scout",
    at: "09:15",
    body: [
      { kind: "text", text: "Opened. On the rename — you parked it: index split first, the foreign-key rename collapses to a six-line patch. Reverse order rebuilds the index." },
    ],
  },
];
