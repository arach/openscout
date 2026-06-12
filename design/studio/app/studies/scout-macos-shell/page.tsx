/**
 * Scout macOS Shell — the design direction for the four screens in
 * the Scout macOS app: Comms, Agents, Tail, Repos.
 *
 * Structure:
 *   §1  Projected state.  The design direction — one concrete
 *                         redesign per screen, each addressing an
 *                         open question from the live app.
 *   §2  Current state.    The live app as it ships today, the
 *                         baseline §1 was projected from. Real
 *                         data from the recent screenshots for
 *                         Agents, Repos, and Tail; Comms is
 *                         illustrative.
 *   §3  Shell chrome.     The five pieces every screen shares.
 *   §4  Sections.         The ScoutSection cases mapped to source
 *                         + inspector + dedicated study.
 *   §5  Open questions.   What the projections raise but don't
 *                         answer.
 *
 * The §2 right-rail inspector on each window is the *current*
 * treatment, not the new unified grammar from
 * /studies/inspector-grammar. The port to a shared Swift
 * InspectorFrame is the next step after at least one projection
 * is signed off.
 *
 * Status: draft.
 */

import { EyebrowLabel } from "@/components/EyebrowLabel";

/* ────────────────────────────────────────────────────────────────────
   Mock data — actual rows from the live app's current state.
   Source: screenshots 2026-06-12 00.07.38 (Agents), 00.07.50 (Repos),
   00.07.57 (Tail). When the live app changes, these should follow.
   ──────────────────────────────────────────────────────────────────── */

const COMMS = [
  {
    name: "Dewey",
    preview:
      "Great breakdown. Take both — and surface the active theme in the inspector while you're in the view layer…",
    time: "2m",
    unread: 2,
    group: "now",
    ask: null as null | "pending" | "answered",
  },
  {
    name: "Hudson",
    preview: "On it. Moved resolveStartupTheme() ahead of the composer mount…",
    time: "8m",
    unread: 0,
    group: "now",
    ask: "answered" as const,
  },
  {
    name: "Scout · iOS pairing",
    preview: "QR handoff from iOS. Awaiting the second-device scan.",
    time: "11m",
    unread: 1,
    group: "now",
    ask: "pending" as const,
  },
  {
    name: "Atlas",
    preview: "Dropped the iconography study. Want to walk through it?",
    time: "22m",
    unread: 0,
    group: "today",
    ask: null,
  },
  {
    name: "Preframe",
    preview: "Today's standup is in 5m — I'll bring up the worktree map.",
    time: "1h",
    unread: 0,
    group: "today",
    ask: null,
  },
  {
    name: "Lattices",
    preview: "Pushed a fix for the new-conversation footer button.",
    time: "1d",
    unread: 0,
    group: "earlier",
    ask: null,
  },
];

type AgentRow = {
  name: string;
  role: string;
  harness?: string;
  transport?: string;
  updated: string;
  state: "available" | "working" | "idle" | "needs-attention" | "offline";
  selected?: boolean;
};
type AgentGroup = {
  project: string;
  path?: string;
  count: number;
  agents: AgentRow[];
  expanded?: boolean;
};

const AGENT_GROUPS: AgentGroup[] = [
  {
    project: "Action",
    path: "~/dev/action",
    count: 1,
    expanded: true,
    agents: [
      {
        name: "Action",
        role: "Relay agent",
        harness: "claude",
        transport: "claude_stream_json",
        updated: "1d",
        state: "available",
        selected: true,
      },
    ],
  },
  {
    project: "Art",
    count: 1,
    agents: [
      { name: "Art", role: "Relay agent", updated: "—", state: "offline" },
    ],
  },
  {
    project: "Dewey",
    path: "~/dev/dewey",
    count: 1,
    agents: [
      {
        name: "Dewey",
        role: "Relay agent",
        harness: "claude",
        transport: "claude_stream_json",
        updated: "1d",
        state: "available",
      },
    ],
  },
  {
    project: "Hudson",
    path: "~/dev/hudson",
    count: 4,
    agents: [
      {
        name: "Grok Hudson",
        role: "Relay agent",
        harness: "pi",
        transport: "pi_rpc",
        updated: "1d",
        state: "available",
      },
      {
        name: "Grok Hudson Lite",
        role: "Relay agent",
        harness: "pi",
        transport: "pi_rpc",
        updated: "1d",
        state: "available",
      },
      {
        name: "Grok Hudson None",
        role: "Relay agent",
        harness: "pi",
        transport: "pi_rpc",
        updated: "1d",
        state: "available",
      },
      {
        name: "Hudson",
        role: "Relay agent",
        harness: "claude",
        transport: "claude_stream_json",
        updated: "1d",
        state: "available",
      },
    ],
  },
  {
    project: "Iris",
    path: "~/dev/iris",
    count: 1,
    agents: [
      {
        name: "Iris",
        role: "Relay agent",
        harness: "claude",
        transport: "claude_stream_json",
        updated: "1d",
        state: "available",
      },
    ],
  },
  {
    project: "Lattices",
    path: "~/dev/lattices",
    count: 1,
    agents: [
      {
        name: "Lattices",
        role: "Relay agent",
        harness: "claude",
        transport: "claude_stream_json",
        updated: "1d",
        state: "available",
      },
    ],
  },
  {
    project: "Openscout",
    path: "~/dev/openscout",
    count: 9,
    agents: [
      {
        name: "Claude",
        role: "Relay agent",
        harness: "claude",
        transport: "tmux",
        updated: "10h 15m",
        state: "available",
      },
      {
        name: "Claude",
        role: "Relay agent",
        harness: "claude",
        transport: "tmux",
        updated: "1d",
        state: "available",
      },
      {
        name: "Grok",
        role: "Relay agent",
        harness: "pi",
        transport: "pi_rpc",
        updated: "10h 15m",
        state: "available",
      },
      {
        name: "Openscout",
        role: "Relay agent",
        harness: "codex",
        transport: "codex_app_server",
        updated: "10h 15m",
        state: "available",
      },
      {
        name: "Openscout Card 0 Lxrq1a",
        role: "Relay agent",
        harness: "claude",
        transport: "tmux",
        updated: "10h 15m",
        state: "available",
      },
      {
        name: "Openscout Card 1 J1r3ek",
        role: "Relay agent",
        harness: "claude",
        transport: "tmux",
        updated: "10h 15m",
        state: "available",
      },
      {
        name: "Openscout Card G 1nu9p7",
        role: "Relay agent",
        harness: "claude",
        transport: "tmux",
        updated: "10h 15m",
        state: "available",
      },
      {
        name: "Openscout Grok43",
        role: "Relay agent",
        harness: "pi",
        transport: "pi_rpc",
        updated: "10h 15m",
        state: "available",
      },
      {
        name: "Scout",
        role: "operator-assistant",
        harness: "codex",
        transport: "codex_app_server",
        updated: "10h 15m",
        state: "available",
      },
    ],
  },
  {
    project: "openscout-185",
    path: "~/dev/openscout-185",
    count: 2,
    agents: [
      {
        name: "Openscout 185",
        role: "Relay agent",
        harness: "codex",
        transport: "codex_app_server",
        updated: "1d",
        state: "available",
      },
      {
        name: "Openscout 185 Card X M5xpe7",
        role: "Relay agent",
        harness: "claude",
        transport: "tmux",
        updated: "10h 15m",
        state: "available",
      },
    ],
  },
  {
    project: "Pi Scout",
    path: "~/dev/pi-scout",
    count: 1,
    agents: [
      {
        name: "Pi Scout",
        role: "Relay agent",
        harness: "claude",
        transport: "claude_stream_json",
        updated: "1d",
        state: "available",
      },
    ],
  },
  {
    project: "Preframe",
    path: "~/dev/preframe",
    count: 1,
    agents: [
      {
        name: "Preframe",
        role: "Relay agent",
        harness: "claude",
        transport: "claude_stream_json",
        updated: "1d",
        state: "available",
      },
    ],
  },
  {
    project: "Premotion",
    path: "~/dev/premotion",
    count: 1,
    agents: [
      {
        name: "Premotion",
        role: "Relay agent",
        harness: "claude",
        transport: "claude_stream_json",
        updated: "1d",
        state: "available",
      },
    ],
  },
  {
    project: "talkie",
    path: "~/dev/talkie",
    count: 1,
    agents: [
      {
        name: "Talkie",
        role: "Relay agent",
        harness: "claude",
        transport: "tmux",
        updated: "11h 31m",
        state: "available",
      },
    ],
  },
  {
    project: "Usetalkie Com",
    path: "~/dev/usetalkie.com",
    count: 1,
    agents: [
      {
        name: "Usetalkie Com",
        role: "Relay agent",
        harness: "claude",
        transport: "tmux",
        updated: "10h 15m",
        state: "available",
      },
    ],
  },
];

const STATE_COLOR: Record<AgentRow["state"], string> = {
  available: "var(--status-ok-fg)",
  working: "var(--status-warn-fg)",
  "needs-attention": "var(--status-error-fg)",
  idle: "var(--scout-accent)",
  offline: "var(--studio-ink-faint)",
};

type TailKind = "SYS" | "ASST" | "TOOL" | "OUT";
type TailRow = {
  time: string;
  source: string; // "codex" — brand-colored pill
  agent: string;  // "native" — outlined pill
  name: string;   // "talkie"
  shortId: string;// "019eb9da"
  pid: string;    // "4894"
  kind: TailKind;
  msg: string;
};

const TAIL_ROWS: TailRow[] = [
  { time: "00:01:02", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "tokens · 12462029" },
  { time: "00:01:06", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "[reasoning]" },
  { time: "00:01:07", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "agent_message" },
  { time: "00:01:07", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "ASST", msg: "Both builds succeeded. I'm relaunching TalkieA…" },
  { time: "00:01:10", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "TOOL", msg: 'exec_command({"cmd":"./run.sh TalkieAgent Talk…"})' },
  { time: "00:01:14", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "OUT",  msg: "→ Chunk ID: 51697a Wall time: 4.0798 seconds…" },
  { time: "00:01:14", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "tokens · 12621726" },
  { time: "00:01:25", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "[reasoning]" },
  { time: "00:01:31", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "agent_message" },
  { time: "00:01:31", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "ASST", msg: "The relaunch completed; the agent signing step…" },
  { time: "00:01:31", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "TOOL", msg: 'exec_command({"cmd":"pgrep -fl \\"TalkieAgent[…]" })' },
  { time: "00:01:31", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "TOOL", msg: 'exec_command({"cmd":"git diff --check -- apps/…"})' },
  { time: "00:01:31", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "TOOL", msg: 'exec_command({"cmd":"nl -ba apps/macos/TalkieA…"})' },
  { time: "00:01:32", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "TOOL", msg: 'exec_command({"cmd":"nl -ba apps/macos/TalkieK…"})' },
  { time: "00:01:32", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "OUT",  msg: "→ Chunk ID: ef9e28 Wall time: 0.0000 seconds…" },
  { time: "00:01:32", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "OUT",  msg: "→ Chunk ID: 7cd138 Wall time: 0.0000 seconds…" },
  { time: "00:01:32", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "OUT",  msg: "→ Chunk ID: 5a8cab Wall time: 0.0006 seconds…" },
  { time: "00:01:32", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "OUT",  msg: "→ Chunk ID: 63dd93 Wall time: 0.0000 seconds…" },
  { time: "00:01:32", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "tokens · 12782629" },
  { time: "00:01:35", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "[reasoning]" },
  { time: "00:01:42", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "agent_message" },
  { time: "00:01:42", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "ASST", msg: "Both processes are running again and the final…" },
  { time: "00:01:42", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "TOOL", msg: 'exec_command({"cmd":"nl -ba apps/macos/TalkieA…"})' },
  { time: "00:01:42", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "TOOL", msg: 'exec_command({"cmd":"nl -ba apps/macos/Talkie/…"})' },
  { time: "00:01:42", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "TOOL", msg: 'exec_command({"cmd":"git status --short -- app…"})' },
  { time: "00:01:42", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "OUT",  msg: "→ Chunk ID: 2dcbb4 Wall time: 0.0000 seconds…" },
  { time: "00:01:42", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "OUT",  msg: "→ Chunk ID: d4eb44 Wall time: 0.0000 seconds…" },
  { time: "00:01:42", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "OUT",  msg: "→ Chunk ID: 464bc7 Wall time: 0.0000 seconds…" },
  { time: "00:01:42", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "tokens · 12947398" },
  { time: "00:01:50", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "[reasoning]" },
  { time: "00:01:55", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "agent_message" },
  { time: "00:01:55", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "ASST", msg: "Done. I tightened the selector geometry and qu…" },
  { time: "00:01:55", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "tokens · 13114464" },
  { time: "00:01:55", source: "codex", agent: "native", name: "talkie", shortId: "019eb9da", pid: "4894", kind: "SYS",  msg: "task complete" },
];

/* Live app kind-chip colors. Mapped from the screenshot — the studio
   `scout-tail` study uses a different vocabulary, but this master page
   is showing the *live* app, not the redesign. */
const KIND_COLOR: Record<TailKind, { bg: string; fg: string; bgRaw: string; fgRaw: string }> = {
  SYS:  { bg: "var(--status-info-bg)",  fg: "var(--status-info-fg)",  bgRaw: "oklch(0.70 0.10 220 / 0.18)", fgRaw: "oklch(0.80 0.10 220)" },
  ASST: { bg: "var(--status-info-bg)",  fg: "var(--status-info-fg)",  bgRaw: "oklch(0.70 0.10 220 / 0.18)", fgRaw: "oklch(0.80 0.10 220)" },
  TOOL: { bg: "var(--status-warn-bg)",  fg: "var(--status-warn-fg)",  bgRaw: "oklch(0.72 0.15 85 / 0.18)",  fgRaw: "oklch(0.85 0.15 85)" },
  OUT:  { bg: "var(--status-error-bg)", fg: "var(--status-error-fg)", bgRaw: "oklch(0.72 0.18 25 / 0.18)",  fgRaw: "oklch(0.78 0.17 25)" },
};

type RepoWorktree = {
  branch: string;
  add: number | null;
  del: number | null;
  files: number | null;
  drift: number | null;       // signed; positive = ahead, negative = behind
  agents: string | null;      // e.g. "@hudson @grok-hudson +2"
  touched: string;            // "—" placeholder or timestamp
  highlight?: boolean;        // attention drift (amber bar)
  selected?: boolean;
};
type Repo = {
  name: string;
  path: string;
  agents: number;             // "N idle"
  state: "attention" | "ok";
  worktrees: RepoWorktree[];
  selected?: boolean;
};

const REPOS: Repo[] = [
  {
    name: "lattices",
    path: "~/art/dev/lattices",
    agents: 2,
    state: "attention",
    selected: true,
    worktrees: [
      {
        branch: "main",
        add: 491,
        del: 102,
        files: 2,
        drift: null,
        agents: "@lattices",
        touched: "—",
      },
    ],
  },
  {
    name: "preframe",
    path: "~/art/dev/preframe",
    agents: 1,
    state: "attention",
    worktrees: [
      {
        branch: "main",
        add: 68,
        del: 15,
        files: 10,
        drift: null,
        agents: "@preframe",
        touched: "—",
      },
    ],
  },
  {
    name: "premotion",
    path: "~/art/dev/premotion",
    agents: 1,
    state: "attention",
    worktrees: [
      {
        branch: "master",
        add: 160,
        del: 6,
        files: 33,
        drift: null,
        agents: "@premotion",
        touched: "—",
      },
    ],
  },
  {
    name: "action",
    path: "~/art/dev/action",
    agents: 1,
    state: "attention",
    worktrees: [
      {
        branch: "codex/polished-mira-demo",
        add: 284,
        del: 39,
        files: 27,
        drift: 21,
        agents: "@action",
        touched: "—",
        highlight: true,
      },
    ],
  },
  {
    name: "dewey",
    path: "~/art/dev/dewey",
    agents: 1,
    state: "ok",
    worktrees: [
      {
        branch: "main",
        add: null,
        del: null,
        files: null,
        drift: null,
        agents: "@dewey",
        touched: "—",
      },
    ],
  },
  {
    name: "hudson",
    path: "~/art/dev/hudson",
    agents: 6,
    state: "attention",
    worktrees: [
      {
        branch: "feat/hud-markdown-renderer",
        add: 239,
        del: 57,
        files: 24,
        drift: 35,
        agents: "@hudson @grok-hudson +2",
        touched: "—",
        highlight: true,
      },
      {
        branch: "main",
        add: null,
        del: null,
        files: null,
        drift: -47,
        agents: null,
        touched: "—",
      },
    ],
  },
  {
    name: "openscout",
    path: "~/art/dev/openscout",
    agents: 183,
    state: "attention",
    worktrees: [
      {
        branch: "feat/scout-ios-lan-pairing",
        add: 1534,
        del: 1810,
        files: 42,
        drift: null,
        agents: "@scout @claude +26",
        touched: "—",
      },
      {
        branch: "feat/repo-watch-web-converge",
        add: 1158,
        del: 231,
        files: 27,
        drift: null,
        agents: "@openscout-185 @opensc…",
        touched: "—",
      },
    ],
  },
  {
    name: "pi-scout",
    path: "~/art/dev/pi-scout",
    agents: 1,
    state: "ok",
    worktrees: [
      {
        branch: "main",
        add: null,
        del: null,
        files: null,
        drift: null,
        agents: "@pi-scout",
        touched: "—",
      },
    ],
  },
  {
    name: "talkie",
    path: "~/art/dev/talkie",
    agents: 3,
    state: "attention",
    worktrees: [
      {
        branch: "codex/memo-rollout-agent-permission",
        add: 1359,
        del: 351,
        files: 25,
        drift: null,
        agents: "@talkie",
        touched: "—",
      },
      {
        branch: "codex/screenshot-cursors",
        add: null,
        del: null,
        files: null,
        drift: 48,
        agents: null,
        touched: "—",
      },
    ],
  },
  {
    name: "usetalkie.com",
    path: "~/art/dev/usetalkie.com",
    agents: 1,
    state: "ok",
    worktrees: [
      {
        branch: "main",
        add: null,
        del: null,
        files: null,
        drift: 15,
        agents: "@usetalkie-com",
        touched: "—",
      },
    ],
  },
];

/* Drift bars: a tiny bar showing relative magnitude. The +N from the
   row is the actual signal; the bar is just the visual. */
function DriftBar({ value, attention, max = 50 }: { value: number | null; attention?: boolean; max?: number }) {
  if (value === null) {
    return <span className="font-mono text-[8.5px] text-studio-ink-faint">—</span>;
  }
  const pct = Math.min(100, (Math.abs(value) / max) * 100);
  const color = value < 0
    ? "var(--status-error-fg)"
    : attention
      ? "var(--status-warn-fg)"
      : "var(--status-ok-fg)";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="block h-[3px] rounded-[1px]"
        style={{
          width: `${Math.max(pct, 8)}%`,
          maxWidth: 36,
          background: color,
        }}
      />
      <span
        className="font-mono text-[8.5px] tabular-nums"
        style={{ color }}
      >
        {value > 0 ? `+${value}` : value}
      </span>
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Shared chrome — Scout macOS window frame.
   Titlebar · left nav rail · body · status bar.
   Body is a 2-column flex: [main] [inspector].
   ──────────────────────────────────────────────────────────────────── */

type SectionId = "comms" | "agents" | "tail" | "repos";

function MacOSWindow({
  active,
  children,
  height = 720,
}: {
  active: SectionId;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-[10px] border border-studio-edge-strong bg-studio-canvas shadow-[0_18px_40px_-24px_color-mix(in_oklab,var(--studio-ink)_55%,transparent)]"
      style={{ height }}
    >
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <NavRail active={active} />
        <div className="flex min-w-0 flex-1">{children}</div>
      </div>
      <StatusBar active={active} />
    </div>
  );
}

/* Compact variant for projection mockups — same chrome, smaller height.
   Inspector is narrower so the main area still has room to show the
   change being projected. */
/* Compact variant for projection mockups — same chrome, same height
   as the full window so projected and current are at the same scale.
   Reuses the same 300px inspector. */
function MacOSWindowCompact({
  active,
  children,
  height = 720,
}: {
  active: SectionId;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-[10px] border border-studio-edge-strong bg-studio-canvas shadow-[0_18px_40px_-24px_color-mix(in_oklab,var(--studio-ink)_55%,transparent)]"
      style={{ height }}
    >
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <NavRail active={active} />
        <div className="flex min-w-0 flex-1">{children}</div>
      </div>
      <StatusBar active={active} />
    </div>
  );
}

function Titlebar() {
  return (
    <div
      className="flex h-[30px] flex-none items-center gap-2 border-b border-studio-edge px-3"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      <div className="flex items-center gap-1.5">
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#FF5F57" }} />
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#FEBC2E" }} />
        <span className="block h-[10px] w-[10px] rounded-full" style={{ background: "#28C840" }} />
      </div>
      <div className="ml-auto flex items-center gap-1 text-studio-ink-faint">
        <WindowTool>{iconSideBySide()}</WindowTool>
        <WindowTool>{iconSplit()}</WindowTool>
      </div>
    </div>
  );
}

function WindowTool({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[18px] w-[22px] items-center justify-center rounded text-studio-ink-faint">
      {children}
    </div>
  );
}

const NAV_ITEMS: { id: SectionId | "settings"; label: string; icon: React.ReactNode }[] = [
  { id: "comms", label: "Comms", icon: iconBubble() },
  { id: "agents", label: "Agents", icon: iconAgents() },
  { id: "tail", label: "Tail", icon: iconPulse() },
  { id: "repos", label: "Repos", icon: iconRepos() },
];

function NavRail({ active }: { active: SectionId }) {
  return (
    <div
      className="flex w-[40px] flex-none flex-col items-center gap-1 border-r border-studio-edge py-2"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      <div className="mb-1 grid h-[26px] w-[26px] place-items-center rounded-[6px] bg-scout-accent font-display text-[12px] font-semibold text-studio-canvas">
        S
      </div>
      {NAV_ITEMS.map((it) => {
        const isActive = it.id === active;
        return (
          <div
            key={it.id}
            className={[
              "grid h-[26px] w-[26px] place-items-center rounded-[5px] text-studio-ink-faint",
              isActive ? "bg-studio-surface text-studio-ink" : "",
            ].join(" ")}
            title={it.label}
          >
            {it.icon}
          </div>
        );
      })}
      <div className="mt-auto grid h-[26px] w-[26px] place-items-center rounded-[5px] text-studio-ink-faint">
        {iconSettings()}
      </div>
    </div>
  );
}

function StatusBar({ active }: { active: SectionId }) {
  return (
    <div
      className="flex h-[22px] flex-none items-center gap-2 border-t border-studio-edge px-3 font-mono text-[9px] uppercase tracking-eyebrow"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-ok-fg" />
      <span className="text-studio-ink-muted">{labelFor(active)}</span>
    </div>
  );
}

function labelFor(s: SectionId) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ────────────────────────────────────────────────────────────────────
   Right-rail inspector — current treatment, matching the live app.
   Slimmer than the live 300px so the master page fits 2x2; the chrome
   and proportions match what the operator sees in the live app.
   ──────────────────────────────────────────────────────────────────── */

function InspectorPane({
  kind,
  status,
  statusTone,
  children,
}: {
  kind: string;
  status: string;
  statusTone: "ok" | "warn" | "info" | "error";
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-[300px] flex-none flex-col border-l border-studio-edge bg-studio-surface">
      <div className="flex items-center justify-between border-b border-studio-edge px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-0.5 rounded-sm bg-scout-accent" />
          <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            {kind}
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-eyebrow"
          style={{
            background: `var(--status-${statusTone}-bg)`,
            color: `var(--status-${statusTone}-fg)`,
          }}
        >
          <span className="block h-1.5 w-1.5 rounded-full bg-current" />
          {status}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 overflow-hidden p-2.5">{children}</div>
    </div>
  );
}

function Hairline() {
  return <div className="h-px w-full bg-studio-edge" />;
}

/* Inspector sections — three flavours, matching the live app:
   - bare  (Agent) — no leading mark, hairline divider follows
   - dot   (Repos) — leading orange dot, no divider
   - overline (Tail) — thin overline rule above the title, no divider */
function ISecBare({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}
function ISecDot({ label, dot, children }: { label: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: dot }}
        />
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}
function ISecOverline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        aria-hidden
        className="h-px w-3.5"
        style={{ background: "var(--studio-edge-strong)" }}
      />
      <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function InspectorRow({ k, v, vColor }: { k: string; v: string; vColor?: string }) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-baseline gap-x-1.5 font-mono text-[9.5px]">
      <span className="uppercase tracking-eyebrow text-studio-ink-faint">{k}</span>
      <span
        className="truncate text-right"
        style={{ color: vColor ?? "var(--studio-ink-muted)" }}
      >
        {v}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   The four screen mockups
   ──────────────────────────────────────────────────────────────────── */

function CommsMock() {
  const groups = ["now", "today", "earlier"] as const;
  const groupLabels: Record<(typeof groups)[number], string> = {
    now: "NOW",
    today: "TODAY",
    earlier: "EARLIER",
  };

  return (
    <MacOSWindow active="comms">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex flex-none items-center justify-between border-b border-studio-edge px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-[12.5px] font-semibold tracking-tight text-studio-ink">
              Conversations
            </span>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-ok-fg" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="grid h-[18px] w-[18px] place-items-center rounded text-studio-ink-faint">
              {iconRefresh()}
            </span>
            <span
              className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
              style={{ background: "var(--scout-accent-soft)", color: "var(--scout-accent)" }}
            >
              + New
            </span>
          </div>
        </div>
        {/* controls */}
        <div className="flex flex-none flex-col gap-1.5 border-b border-studio-edge px-3 py-2">
          <div className="flex items-center gap-1.5">
            {["All", "Direct", "Shared"].map((f, i) => (
              <span
                key={f}
                className={[
                  "rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow",
                  i === 0
                    ? "bg-studio-surface text-studio-ink"
                    : "text-studio-ink-faint",
                ].join(" ")}
              >
                {f}
              </span>
            ))}
          </div>
          <div className="flex h-[20px] items-center gap-1.5 rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-2 text-studio-ink-faint">
            {iconSearch()}
            <span className="font-mono text-[9.5px]">Search</span>
          </div>
        </div>
        {/* list */}
        <div className="flex-1 overflow-hidden">
          {groups.map((g) => {
            const rows = COMMS.filter((c) => c.group === g);
            if (rows.length === 0) return null;
            return (
              <div key={g}>
                <div className="px-3 py-1 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                  {groupLabels[g]}
                </div>
                {rows.map((c, i) => (
                  <div
                    key={`${g}-${i}`}
                    className={[
                      "flex flex-col gap-0.5 border-l-2 px-3 py-1.5",
                      i === 0 && g === "now"
                        ? "border-scout-accent bg-studio-canvas-alt"
                        : "border-transparent",
                    ].join(" ")}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-sans text-[11px] font-semibold text-studio-ink">
                        {c.name}
                      </span>
                      <span className="font-mono text-[8.5px] text-studio-ink-faint">
                        {c.time}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="line-clamp-1 font-sans text-[9.5px] text-studio-ink-faint">
                        {c.preview}
                      </span>
                      {c.unread > 0 ? (
                        <span className="ml-auto shrink-0 rounded-full bg-status-info-fg px-1 font-mono text-[7.5px] font-semibold text-studio-canvas">
                          {c.unread}
                        </span>
                      ) : null}
                    </div>
                    {c.ask ? (
                      <span
                        className={[
                          "self-start rounded-[2px] px-1 py-px font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow",
                          c.ask === "pending"
                            ? "bg-status-warn-bg text-status-warn-fg"
                            : "bg-status-ok-bg text-status-ok-fg",
                        ].join(" ")}
                      >
                        ASK {c.ask}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <InspectorPane kind="DM" status="AVAILABLE" statusTone="ok">
        <div className="flex items-center gap-2">
          <div className="grid h-[22px] w-[22px] place-items-center rounded-full bg-studio-canvas-alt font-mono text-[10px] text-studio-ink">
            D
          </div>
          <div>
            <div className="font-sans text-[11px] font-semibold text-studio-ink">Dewey</div>
            <div className="font-mono text-[8px] text-studio-ink-faint">
              dewey.main.arts-mac-mini-local
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
            style={{ background: "var(--scout-accent-soft)", color: "var(--scout-accent)" }}
          >
            Message
          </span>
          <span className="rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
            + New
          </span>
        </div>
        <ISecBare label="Identity">
          <InspectorRow k="Harness" v="claude" />
          <InspectorRow k="Transport" v="claude_stream_json" />
          <InspectorRow k="Role" v="Relay agent" />
        </ISecBare>
        <ISecBare label="Project">
          <InspectorRow k="Branch" v="main" />
          <InspectorRow k="Path" v="~/dev/dewey" />
        </ISecBare>
      </InspectorPane>
    </MacOSWindow>
  );
}

function AgentsMock() {
  return (
    <MacOSWindow active="agents">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex flex-none items-center justify-between border-b border-studio-edge px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-[12.5px] font-semibold tracking-tight text-studio-ink">
              Agents
            </span>
            <span
              className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint"
              style={{ background: "var(--status-neutral-bg)" }}
            >
              25 agents
            </span>
          </div>
        </div>
        {/* controls row */}
        <div className="flex flex-none items-center gap-1.5 border-b border-studio-edge px-3 py-1.5">
          <div className="flex h-[20px] flex-1 items-center gap-1.5 rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-2 text-studio-ink-faint">
            {iconSearch()}
            <span className="font-mono text-[9.5px]">Filter agents</span>
          </div>
          <span className="rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink">
            All
          </span>
          <span className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            Live
          </span>
          <span className="ml-auto rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
            Expand
          </span>
          <span className="rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
            Collapse
          </span>
        </div>
        {/* column headers */}
        <div className="grid flex-none grid-cols-[1fr_56px] items-center gap-x-2 border-b border-studio-edge-strong bg-studio-canvas-alt px-3 py-1 font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          <span>Agent</span>
          <span className="text-right">Updated</span>
        </div>
        {/* list */}
        <div className="flex-1 overflow-hidden">
          {AGENT_GROUPS.map((g) => (
            <div key={g.project}>
              <div className="flex items-baseline gap-1.5 px-3 py-1">
                <span className="font-mono text-[8.5px] text-studio-ink-faint">▾</span>
                <span className="font-sans text-[10.5px] font-semibold text-studio-ink">
                  {g.project}
                </span>
                {g.path ? (
                  <span className="font-mono text-[8.5px] text-studio-ink-faint">{g.path}</span>
                ) : null}
                <span className="ml-auto font-mono text-[8.5px] text-studio-ink-faint">
                  {g.count} agent{g.count === 1 ? "" : "s"}
                </span>
              </div>
              {g.agents.map((a, i) => (
                <div
                  key={`${g.project}-${a.name}-${a.harness ?? ""}-${i}`}
                  className={[
                    "grid grid-cols-[1fr_56px] items-baseline gap-x-2 border-l-2 px-3 py-1",
                    a.selected ? "border-scout-accent bg-studio-canvas-alt" : "border-transparent",
                  ].join(" ")}
                >
                  <span className="flex items-baseline gap-1.5 truncate">
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: STATE_COLOR[a.state] }}
                    />
                    <span className="truncate font-sans text-[10.5px] font-medium text-studio-ink">
                      {a.name}
                    </span>
                    <span className="truncate font-mono text-[8.5px] text-studio-ink-faint">
                      {a.role}
                      {a.harness ? ` · ${a.harness}` : ""}
                      {a.transport ? ` · ${a.transport}` : ""}
                    </span>
                  </span>
                  <span className="text-right font-mono text-[8.5px] text-studio-ink-faint">
                    {a.updated}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <InspectorPane kind="AGENT" status="AVAILABLE" statusTone="ok">
        <div className="flex items-center gap-2">
          <div className="grid h-[22px] w-[22px] place-items-center rounded-full bg-studio-canvas-alt font-mono text-[10px] text-studio-ink">
            A
          </div>
          <div className="min-w-0">
            <div className="truncate font-sans text-[11px] font-semibold text-studio-ink">Action</div>
            <div className="truncate font-mono text-[8px] text-studio-ink-faint">
              action.codex-polished-mira-demo.arts-mac-mini-local
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
            style={{ background: "var(--scout-accent-soft)", color: "var(--scout-accent)" }}
          >
            Message
          </span>
          <span className="rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
            + New
          </span>
        </div>
        <ISecBare label="Runtime">
          <InspectorRow k="Role" v="Relay agent" />
          <InspectorRow k="Harness" v="claude" />
          <InspectorRow k="Transport" v="claude_stream_json" />
          <InspectorRow k="Model" v="—" />
          <InspectorRow k="Node" v="Arts-Mac-mini.local" />
        </ISecBare>
        <Hairline />
        <ISecBare label="Workspace">
          <InspectorRow k="Branch" v="(none)" vColor="var(--studio-ink-faint)" />
          <InspectorRow k="Path" v="~/dev/action" />
          <InspectorRow k="cId" v="c.ab3fd029-807a-4aff-…c6f…" />
        </ISecBare>
        <Hairline />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            Session
          </span>
          <span className="rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
            ◉ Observe
          </span>
        </div>
        <div className="-mt-1 flex flex-col gap-0.5">
          <InspectorRow k="id" v="relay-action-claude" />
          <InspectorRow k="Active" v="1d" />
        </div>
      </InspectorPane>
    </MacOSWindow>
  );
}

function TailMock() {
  return (
    <MacOSWindow active="tail">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex flex-none items-center justify-between border-b border-studio-edge px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-[12.5px] font-semibold tracking-tight text-studio-ink">
              Tail
            </span>
            <span
              className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
              style={{ background: "var(--status-ok-bg)", color: "var(--status-ok-fg)" }}
            >
              ● Live
            </span>
            <span className="font-mono text-[8.5px] text-studio-ink-faint">
              40 logs · 19 procs · <span className="text-studio-ink">0.0</span> lines/s
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
              ‖ Pause
            </span>
            <span className="grid h-[18px] w-[18px] place-items-center rounded-[3px] border border-studio-edge text-studio-ink-faint">
              {iconRefresh()}
            </span>
            <span className="grid h-[18px] w-[18px] place-items-center rounded-[3px] border border-studio-edge text-studio-ink-faint">
              ◯
            </span>
          </div>
        </div>
        {/* filter row */}
        <div className="flex flex-none flex-col gap-1.5 border-b border-studio-edge px-3 py-1.5">
          <div className="flex h-[20px] items-center gap-1.5 rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-2 text-studio-ink-faint">
            {iconSearch()}
            <span className="font-mono text-[9.5px]">Search</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {[
              { l: "All sources", active: true },
              { l: "All", active: true },
              { l: "User", dot: "ok" },
              { l: "Assistant", dot: "ok" },
              { l: "Tool", dot: "warn" },
              { l: "Tool result", dot: "info" },
              { l: "System", dot: "info" },
              { l: "Other", dot: "neutral" },
            ].map((c, i) => (
              <span
                key={`${c.l}-${i}`}
                className={[
                  "inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow",
                  c.active
                    ? "bg-studio-surface text-studio-ink"
                    : "text-studio-ink-faint",
                ].join(" ")}
              >
                {c.dot ? (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: `var(--status-${c.dot}-fg)` }}
                  />
                ) : null}
                {c.l}
              </span>
            ))}
          </div>
        </div>
        {/* rows: time | source | agent | name · id | pid | kind | msg */}
        <div className="flex-1 overflow-hidden font-mono text-[9px]">
          {TAIL_ROWS.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-[52px_44px_44px_92px_36px_36px_1fr] items-baseline gap-x-1.5 border-b border-studio-edge px-3 py-0.5"
            >
              <span className="text-studio-ink-faint">{r.time}</span>
              <span
                className="rounded-[2px] px-1 text-center text-[7.5px] font-semibold"
                style={{ background: "oklch(0.72 0.16 350 / 0.22)", color: "oklch(0.82 0.16 350)" }}
              >
                {r.source}
              </span>
              <span
                className="rounded-[2px] border px-1 text-center text-[7.5px] font-semibold"
                style={{ borderColor: "var(--studio-edge)", color: "var(--studio-ink-muted)" }}
              >
                {r.agent}
              </span>
              <span className="truncate text-studio-ink-muted">
                {r.name} <span className="text-studio-ink-faint">· {r.shortId}</span>
              </span>
              <span className="text-right text-studio-ink-faint">{r.pid}</span>
              <span
                className="rounded-[2px] px-1 text-center text-[7.5px] font-semibold"
                style={{ background: KIND_COLOR[r.kind].bg, color: KIND_COLOR[r.kind].fg }}
              >
                {r.kind}
              </span>
              <span className="truncate text-studio-ink-muted">{r.msg}</span>
            </div>
          ))}
        </div>
        {/* status footer for the tail pane */}
        <div
          className="flex flex-none items-center gap-2 border-t border-studio-edge px-3 py-1 font-mono text-[8.5px]"
          style={{ background: "var(--studio-canvas-alt)" }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-ok-fg" />
          <span className="text-studio-ink-muted">Following tail</span>
          <span className="text-studio-ink-faint">0 new · latest 00:01:55 codex</span>
          <span className="ml-auto text-studio-ink-faint">681 / 700 lines buffered</span>
        </div>
      </div>
      <InspectorPane kind="OVERVIEW" status="LIVE" statusTone="ok">
        <div className="flex items-center gap-1.5 font-mono text-[8.5px] text-studio-ink-faint">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--status-ok-fg)" }}
          />
          following live transcript tails
        </div>
        <ISecOverline label="Coverage">
          <div className="grid grid-cols-2 gap-1">
            <Stat label="Logs" v="40" />
            <Stat label="Processes" v="19" />
            <Stat label="Sessions" v="4" />
            <Stat label="Buffered" v="700" />
          </div>
        </ISecOverline>
        <ISecOverline label="Sources">
          <InspectorRow k="codex" v="515" vColor="var(--studio-ink)" />
          <InspectorRow k="claude" v="185" />
        </ISecOverline>
        <ISecOverline label="Origins">
          <InspectorRow k="native" v="626" vColor="var(--studio-ink)" />
          <InspectorRow k="scout" v="74" />
        </ISecOverline>
        <ISecOverline label="Kinds">
          <InspectorRow k="System" v="197" vColor="var(--studio-ink)" />
          <InspectorRow k="Tool result" v="185" />
          <InspectorRow k="Tool" v="168" />
          <InspectorRow k="Assistant" v="93" />
          <InspectorRow k="Other" v="52" />
          <InspectorRow k="User" v="5" />
        </ISecOverline>
        <ISecOverline label="Tracks">
          <Track t="Transcript logs" d="Claude and Codex JSONL files discovered on disk." />
          <Track t="Live processes" d="Harness process inventory and parent attribution." />
          <Track t="Sessions" d="Session IDs and short row links." />
          <Track t="Projects" d="Current working directory and project labels." />
        </ISecOverline>
        <ISecOverline label="Defaults">
          <label className="flex items-center gap-1.5 font-mono text-[9px] text-studio-ink">
            <span
              className="grid h-[12px] w-[12px] place-items-center rounded-[2px]"
              style={{ background: "var(--scout-accent)" }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
                <path d="M1 4.2L3 6.2L7 1.5" stroke="var(--studio-canvas)" strokeWidth="1.5" fill="none" />
              </svg>
            </span>
            Show transcript metadata
          </label>
          <div className="font-mono text-[8.5px] leading-snug text-studio-ink-faint">
            Metadata includes records like model, title, permission-mode, and last-prompt.
          </div>
        </ISecOverline>
      </InspectorPane>
    </MacOSWindow>
  );
}

function ReposMock() {
  const totals = REPOS.reduce(
    (acc, r) => {
      acc.trees += r.worktrees.length;
      if (r.state === "attention") acc.dirty += 1;
      return acc;
    },
    { trees: 0, dirty: 0, attn: REPOS.filter((r) => r.state === "attention").length },
  );
  return (
    <MacOSWindow active="repos">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex flex-none flex-col gap-1 border-b border-studio-edge px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-[12.5px] font-semibold tracking-tight text-studio-ink">
              Repos
            </span>
            <span
              className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
              style={{ background: "var(--status-ok-bg)", color: "var(--status-ok-fg)" }}
            >
              ● Live
            </span>
            <span className="font-mono text-[8.5px] text-studio-ink-faint">
              <span className="text-studio-ink">10</span> repos
            </span>
            <span className="font-mono text-[8.5px] text-studio-ink-faint">
              <span className="text-studio-ink">15</span> trees
            </span>
            <span className="font-mono text-[8.5px]" style={{ color: "var(--status-warn-fg)" }}>
              {totals.dirty} dirty
            </span>
            <span className="font-mono text-[8.5px]" style={{ color: "var(--status-warn-fg)" }}>
              {totals.attn} attn
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-studio-ink-faint">
              <span className="font-mono text-[8.5px]">◐ Quiet 2</span>
              <span className="grid h-[16px] w-[16px] place-items-center rounded text-studio-ink-faint">
                {iconRefresh()}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[8.5px]">
            <span className="font-semibold uppercase tracking-eyebrow text-studio-ink">
              Table
            </span>
            <span className="uppercase tracking-eyebrow text-studio-ink-faint">Drift</span>
          </div>
        </div>
        {/* table */}
        <div className="flex-1 overflow-hidden">
          <div className="grid grid-cols-[1fr_72px_36px_72px_44px] items-center gap-x-2 border-b border-studio-edge-strong bg-studio-canvas-alt px-3 py-1 font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            <span>Repo / Branch · Worktree</span>
            <span className="text-right">Churn</span>
            <span className="text-right">Files</span>
            <span className="text-right">Drift</span>
            <span className="text-right">Ag.</span>
          </div>
          {REPOS.map((r) => (
            <div key={r.name}>
              <div
                className={[
                  "flex items-baseline gap-1.5 border-b border-studio-edge px-3 py-1",
                  r.selected ? "bg-studio-canvas-alt" : "",
                ].join(" ")}
              >
                <span className="font-mono text-[8.5px] text-studio-ink-faint">▾</span>
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background: r.state === "attention" ? "var(--status-warn-fg)" : "var(--studio-ink-faint)",
                  }}
                />
                <span className="font-sans text-[10.5px] font-semibold text-studio-ink">
                  {r.name}
                </span>
                <span className="font-mono text-[8.5px] text-studio-ink-faint">{r.path}</span>
                <span className="ml-auto font-mono text-[8.5px] text-studio-ink-faint">
                  {r.agents} idle
                </span>
              </div>
              {r.worktrees.map((w, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_72px_36px_72px_44px] items-baseline gap-x-2 border-b border-studio-edge px-3 py-0.5 font-mono text-[8.5px]"
                >
                  <span className="truncate">
                    <span className="text-studio-ink-faint">└ </span>
                    <span className="text-studio-ink">{w.branch}</span>
                  </span>
                  <span className="text-right">
                    {w.add !== null && w.del !== null ? (
                      <>
                        <span style={{ color: "var(--status-ok-fg)" }}>+{w.add.toLocaleString()}</span>
                        <span className="ml-0.5" style={{ color: "var(--status-error-fg)" }}>
                          -{w.del}
                        </span>
                      </>
                    ) : (
                      <span className="text-studio-ink-faint">—</span>
                    )}
                  </span>
                  <span className="text-right text-studio-ink-muted">
                    {w.files ?? "—"}
                  </span>
                  <span className="text-right">
                    <DriftBar value={w.drift} attention={w.highlight} />
                  </span>
                  <span
                    className="truncate text-right text-studio-ink-muted"
                    title={w.agents ?? ""}
                  >
                    {w.agents ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <InspectorPane kind="REPO" status="ATTENTION" statusTone="warn">
        <div>
          <div className="flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--status-warn-fg)" }}
            />
            <span className="font-sans text-[11.5px] font-semibold text-studio-ink">lattices</span>
          </div>
          <div className="font-mono text-[8.5px] text-studio-ink-faint">
            /Users/art/dev/lattices
          </div>
        </div>
        <ISecDot label="Why" dot="var(--status-warn-fg)">
          <div className="font-mono text-[9.5px] text-studio-ink-muted">Dirty main</div>
        </ISecDot>
        <ISecDot label="Worktrees" dot="var(--status-warn-fg)">
          <InspectorRow k="Total" v="1" />
          <InspectorRow k="Dirty" v="1" vColor="var(--status-warn-fg)" />
        </ISecDot>
        <ISecDot label="Changes" dot="var(--status-warn-fg)">
          <InspectorRow k="Staged" v="0" />
          <InspectorRow k="Unstaged" v="2" vColor="var(--status-warn-fg)" />
          <InspectorRow k="Untracked" v="0" />
        </ISecDot>
        <ISecDot label="Attached" dot="var(--status-warn-fg)">
          <InspectorRow k="Agents" v="2" />
          <InspectorRow k="Sessions" v="2" />
        </ISecDot>
      </InspectorPane>
    </MacOSWindow>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Projections — §2 mockups
   Smaller, focused mockups that show ONE concrete redesign per screen.
   Each is a deliberate departure from the current state, not a polish
   pass. The "what & why" lives on the card; the mockup is the proof.
   ──────────────────────────────────────────────────────────────────── */

function CommsAfterMock() {
  return (
    <MacOSWindowCompact active="comms">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header — unchanged */}
        <div className="flex flex-none items-center justify-between border-b border-studio-edge px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-[12.5px] font-semibold tracking-tight text-studio-ink">
              Conversations
            </span>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-ok-fg" />
          </div>
          <span
            className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
            style={{ background: "var(--scout-accent-soft)", color: "var(--scout-accent)" }}
          >
            + New
          </span>
        </div>
        {/* list — selected row highlighted, ask state on the row */}
        <div className="flex-1 overflow-hidden">
          {COMMS.slice(0, 5).map((c, i) => (
            <div
              key={c.name}
              className={[
                "flex flex-col gap-0.5 border-l-2 px-3 py-1.5",
                i === 0 ? "border-scout-accent bg-studio-canvas-alt" : "border-transparent",
              ].join(" ")}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-sans text-[11px] font-semibold text-studio-ink">
                  {c.name}
                </span>
                <span className="font-mono text-[8.5px] text-studio-ink-faint">{c.time}</span>
              </div>
              <span className="line-clamp-1 font-sans text-[9.5px] text-studio-ink-faint">
                {c.preview}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* the new right inspector — uses the unified grammar */}
      <InspectorPane kind="DM" status="AVAILABLE" statusTone="ok">
        <div className="flex items-center gap-2">
          <div className="grid h-[22px] w-[22px] place-items-center rounded-full bg-studio-canvas-alt font-mono text-[10px] text-studio-ink">
            D
          </div>
          <div>
            <div className="font-sans text-[11px] font-semibold text-studio-ink">Dewey</div>
            <div className="font-mono text-[8px] text-studio-ink-faint">dewey.main.arts-mac-mini-local</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
            style={{ background: "var(--scout-accent-soft)", color: "var(--scout-accent)" }}
          >
            Message
          </span>
          <span className="rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
            + New
          </span>
        </div>
        <ISecOverline label="Conversation">
          <InspectorRow k="Last" v="2m" />
          <InspectorRow k="Unread" v="2" vColor="var(--status-info-fg)" />
        </ISecOverline>
        <ISecOverline label="Project">
          <InspectorRow k="Branch" v="main" />
          <InspectorRow k="Path" v="~/dev/dewey" />
        </ISecOverline>
        <ISecOverline label="Ask">
          <div className="font-mono text-[9.5px] text-studio-ink-muted">No pending ask</div>
        </ISecOverline>
      </InspectorPane>
    </MacOSWindowCompact>
  );
}

function AgentsAfterMock() {
  return (
    <MacOSWindowCompact active="agents">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none items-center justify-between border-b border-studio-edge px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-[12.5px] font-semibold tracking-tight text-studio-ink">
              Agents
            </span>
            <span
              className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint"
              style={{ background: "var(--status-neutral-bg)" }}
            >
              25 agents
            </span>
          </div>
        </div>
        <div className="flex flex-none items-center gap-1.5 border-b border-studio-edge px-3 py-1.5">
          <div className="flex h-[20px] flex-1 items-center gap-1.5 rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-2 text-studio-ink-faint">
            {iconSearch()}
            <span className="font-mono text-[9.5px]">Filter agents</span>
          </div>
          <span className="rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink">
            All
          </span>
        </div>
        {/* denser 2-line rows */}
        <div className="flex-1 overflow-hidden">
          {AGENT_GROUPS.slice(0, 8).flatMap((g) => g.agents.slice(0, 2)).map((a, i) => (
            <div
              key={`${a.name}-${i}`}
              className={[
                "flex flex-col gap-0.5 border-l-2 px-3 py-1",
                a.selected ? "border-scout-accent bg-studio-canvas-alt" : "border-transparent",
              ].join(" ")}
            >
              <div className="flex items-baseline gap-1.5">
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: STATE_COLOR[a.state] }}
                />
                <span className="truncate font-sans text-[10.5px] font-medium text-studio-ink">
                  {a.name}
                </span>
                <span className="ml-auto font-mono text-[8.5px] text-studio-ink-faint">
                  {a.updated}
                </span>
              </div>
              <div className="truncate pl-3 font-mono text-[8.5px] text-studio-ink-faint">
                {a.role}
                {a.harness ? ` · ${a.harness}` : ""}
                {a.transport ? ` · ${a.transport}` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
      <InspectorPane kind="AGENT" status="AVAILABLE" statusTone="ok">
        <div className="flex items-center gap-2">
          <div className="grid h-[22px] w-[22px] place-items-center rounded-full bg-studio-canvas-alt font-mono text-[10px] text-studio-ink">
            A
          </div>
          <div>
            <div className="font-sans text-[11px] font-semibold text-studio-ink">Action</div>
            <div className="font-mono text-[8px] text-studio-ink-faint">
              action.codex-polished-mira-demo.arts-mac-mini-local
            </div>
          </div>
        </div>
        <ISecOverline label="Runtime">
          <InspectorRow k="Role" v="Relay agent" />
          <InspectorRow k="Harness" v="claude" />
          <InspectorRow k="Transport" v="claude_stream_json" />
        </ISecOverline>
        <ISecOverline label="Project">
          <InspectorRow k="Branch" v="(none)" vColor="var(--studio-ink-faint)" />
          <InspectorRow k="Path" v="~/dev/action" />
        </ISecOverline>
      </InspectorPane>
    </MacOSWindowCompact>
  );
}

function TailAfterMock() {
  return (
    <MacOSWindowCompact active="tail">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none items-center justify-between border-b border-studio-edge px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-[12.5px] font-semibold tracking-tight text-studio-ink">
              Tail
            </span>
            <span
              className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
              style={{ background: "var(--status-ok-bg)", color: "var(--status-ok-fg)" }}
            >
              ● Live
            </span>
            <span className="font-mono text-[8.5px] text-studio-ink-faint">
              40 · 19 · 0.0 l/s
            </span>
          </div>
          <span className="rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
            ‖ Pause
          </span>
        </div>
        {/* collapsed 4-column rows: time | kind | speaker | msg */}
        <div className="flex-1 overflow-hidden font-mono text-[9px]">
          {TAIL_ROWS.slice(0, 8).map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-[50px_36px_1fr] items-baseline gap-x-2 border-b border-studio-edge px-3 py-0.5"
            >
              <span className="text-studio-ink-faint">{r.time}</span>
              <span
                className="rounded-[2px] px-1 text-center text-[7.5px] font-semibold"
                style={{ background: KIND_COLOR[r.kind].bg, color: KIND_COLOR[r.kind].fg }}
              >
                {r.kind}
              </span>
              <span className="truncate text-studio-ink-muted">{r.msg}</span>
            </div>
          ))}
        </div>
      </div>
      {/* per-selection inspector — replaces the overview */}
      <InspectorPane kind="EVENT" status="SELECTED" statusTone="info">
        <div className="flex items-center gap-1.5">
          <span className="font-sans text-[11.5px] font-semibold text-studio-ink">
            00:01:55 · codex
          </span>
        </div>
        <ISecOverline label="Speaker">
          <InspectorRow k="Source" v="codex" />
          <InspectorRow k="Agent" v="native" />
          <InspectorRow k="Session" v="talkie · 019eb9da" />
        </ISecOverline>
        <ISecOverline label="Kind">
          <div className="font-mono text-[9.5px] text-studio-ink-muted">SYS · agent_message</div>
        </ISecOverline>
        <ISecOverline label="Body">
          <div className="line-clamp-4 font-mono text-[9.5px] leading-snug text-studio-ink-muted">
            Done. I tightened the selector geometry and queried the index
            for the project. The runtime inventory now reads back cleanly
            and the parent attribution is consistent.
          </div>
        </ISecOverline>
      </InspectorPane>
    </MacOSWindowCompact>
  );
}

function ReposAfterMock() {
  return (
    <MacOSWindowCompact active="repos">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* condensed header — single summary, drill-in for the rest */}
        <div className="flex flex-none items-center justify-between border-b border-studio-edge px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-[12.5px] font-semibold tracking-tight text-studio-ink">
              Repos
            </span>
            <span
              className="rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
              style={{ background: "var(--status-ok-bg)", color: "var(--status-ok-fg)" }}
            >
              ● Live
            </span>
            <span className="font-mono text-[8.5px] text-studio-ink-faint">
              <span className="text-studio-ink">10 repos</span>
            </span>
            <span className="font-mono text-[8.5px]" style={{ color: "var(--status-warn-fg)" }}>
              3 need attention
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[8.5px]">
            <span className="font-semibold uppercase tracking-eyebrow text-studio-ink">
              Table
            </span>
            <span className="uppercase tracking-eyebrow text-studio-ink-faint">Drift</span>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="grid grid-cols-[1fr_72px_36px_90px_44px] items-center gap-x-2 border-b border-studio-edge-strong bg-studio-canvas-alt px-3 py-1 font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            <span>Repo / Branch</span>
            <span className="text-right">Churn</span>
            <span className="text-right">Files</span>
            <span className="text-right">Drift</span>
            <span className="text-right">Ag.</span>
          </div>
          {REPOS.slice(0, 5).map((r) => (
            <div key={r.name}>
              <div
                className={[
                  "flex items-baseline gap-1.5 border-b border-studio-edge px-3 py-1",
                  r.selected ? "bg-studio-canvas-alt" : "",
                ].join(" ")}
              >
                <span className="font-mono text-[8.5px] text-studio-ink-faint">▾</span>
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      r.state === "attention" ? "var(--status-warn-fg)" : "var(--studio-ink-faint)",
                  }}
                />
                <span className="font-sans text-[10.5px] font-semibold text-studio-ink">
                  {r.name}
                </span>
                <span className="ml-auto font-mono text-[8.5px] text-studio-ink-faint">
                  {r.agents} idle
                </span>
              </div>
              {r.worktrees.slice(0, 1).map((w, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_72px_36px_90px_44px] items-baseline gap-x-2 border-b border-studio-edge px-3 py-0.5 font-mono text-[8.5px]"
                >
                  <span className="truncate">
                    <span className="text-studio-ink-faint">└ </span>
                    <span className="text-studio-ink">{w.branch}</span>
                  </span>
                  <span className="text-right">
                    {w.add !== null && w.del !== null ? (
                      <>
                        <span style={{ color: "var(--status-ok-fg)" }}>+{w.add}</span>
                        <span className="ml-0.5" style={{ color: "var(--status-error-fg)" }}>
                          -{w.del}
                        </span>
                      </>
                    ) : (
                      <span className="text-studio-ink-faint">—</span>
                    )}
                  </span>
                  <span className="text-right text-studio-ink-muted">{w.files ?? "—"}</span>
                  <span className="text-right">
                    <DriftBar value={w.drift} attention={w.highlight} max={100} />
                  </span>
                  <span
                    className="truncate text-right text-studio-ink-muted"
                    title={w.agents ?? ""}
                  >
                    {w.agents ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <InspectorPane kind="REPO" status="ATTENTION" statusTone="warn">
        <div>
          <div className="flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--status-warn-fg)" }}
            />
            <span className="font-sans text-[11.5px] font-semibold text-studio-ink">lattices</span>
          </div>
          <div className="font-mono text-[8.5px] text-studio-ink-faint">
            /Users/art/dev/lattices
          </div>
        </div>
        <ISecOverline label="Why">
          <div className="font-mono text-[9.5px] text-studio-ink-muted">Dirty main</div>
        </ISecOverline>
        <ISecOverline label="Drill-in">
          <InspectorRow k="Worktrees" v="1" />
          <InspectorRow k="Dirty" v="1" vColor="var(--status-warn-fg)" />
          <InspectorRow k="Unstaged" v="2" vColor="var(--status-warn-fg)" />
        </ISecOverline>
        <ISecOverline label="Quiet">
          <div className="font-mono text-[9.5px] text-studio-ink-muted">
            2 repos w/o activity ≥24h
          </div>
        </ISecOverline>
      </InspectorPane>
    </MacOSWindowCompact>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Small inspector primitives used by the Tail inspector
   ──────────────────────────────────────────────────────────────────── */

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-[4px] border border-studio-edge bg-studio-canvas-alt px-2 py-1">
      <div className="font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[14px] font-medium tabular-nums leading-none text-studio-ink">
        {v}
      </div>
    </div>
  );
}

function Track({ t, d }: { t: string; d: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-sans text-[10px] font-semibold text-studio-ink">{t}</div>
      <div className="font-mono text-[8.5px] leading-snug text-studio-ink-faint">{d}</div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Inline icons (single-color, 1.2px stroke, currentColor).
   ──────────────────────────────────────────────────────────────────── */

function iconSideBySide() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="6" height="9" rx="1" stroke="currentColor" />
      <rect x="7.5" y="0.5" width="6" height="9" rx="1" stroke="currentColor" />
    </svg>
  );
}
function iconSplit() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="6" height="9" rx="1" stroke="currentColor" />
      <rect x="7.5" y="3.5" width="6" height="6" rx="1" stroke="currentColor" />
    </svg>
  );
}
function iconBubble() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 3.5h11v8h-7l-3 2.5v-2.5h-1v-8z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function iconAgents() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.5" cy="7" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M2 13.5c.5-2 2-3 4-3s3.5 1 4 3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M9.5 12.5c.4-1.2 1.3-1.8 2.3-1.8 1.1 0 1.9.6 2.2 1.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function iconPulse() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1 8h2.5l1.5-4 2.5 8 1.5-5 1.5 2H15"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function iconRepos() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="12" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 4h3.5a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function iconSettings() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1.5v1.7M8 12.8v1.7M14.5 8h-1.7M3.2 8H1.5M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6L3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function iconSearch() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.2 10.2L13.5 13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
function iconRefresh() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 8a6 6 0 0 1 10.5-3.9L14 5.5M14 8a6 6 0 0 1-10.5 3.9L2 10.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M14 2.5v3h-3M2 13.5v-3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────── */

export default function ScoutMacOSShellPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-10 max-w-prose">
        <EyebrowLabel size="sm">· studies · macos · shell</EyebrowLabel>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Scout macOS shell
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The design direction for the four screens in the Scout macOS
          app — <span className="text-studio-ink-muted">Comms</span>,{" "}
          <span className="text-studio-ink-muted">Agents</span>,{" "}
          <span className="text-studio-ink-muted">Tail</span>, and{" "}
          <span className="text-studio-ink-muted">Repos</span> — projected
          from the current state below. Each projection is a deliberate
          departure rather than a polish pass; the proof is the mockup,
          the rationale is on the card. Settle one at a time; a
          projection becomes the new current only after the
          corresponding Swift port ships.
        </p>
      </header>

      {/* ────────────────────────────────────────────────────────────
          §1 — Projected state
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §1 · Projected state
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The design direction. One concrete redesign per screen, each
          addressing an open question from the live app. Windows are at
          the same height as §2 so the two read at the same scale.
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ProjectionCard
            screen="Comms"
            problem="Comms has no right inspector. The other three surfaces all own one."
            mock={<CommsAfterMock />}
            changes={[
              "Add a 300px right-rail inspector for the selected conversation.",
              "Uses the unified grammar from /studies/inspector-grammar.",
              "Shows conversation metadata (last activity, unread, project) without breaking the list-first read.",
            ]}
          />
          <ProjectionCard
            screen="Agents"
            problem="The agent-row density is sparse. ~9 rows visible vs. ~12 in Repos at the same height."
            mock={<AgentsAfterMock />}
            changes={[
              "Two-line rows: name + role on top, harness · transport · updated below.",
              "Same vertical space, ~50% more agents visible.",
              "State dot stays as a leading marker; selection treatment unchanged.",
            ]}
          />
          <ProjectionCard
            screen="Tail"
            problem="The 7-column row is too wide. The pid column is noise. The inspector is an overview, not a selection."
            mock={<TailAfterMock />}
            changes={[
              "Collapse source + agent + name · id into the body; drop the pid column.",
              "Rows go from 7 columns to 3 — time · kind · message.",
              "Inspector becomes per-selection (the picked event) instead of a global overview.",
            ]}
          />
          <ProjectionCard
            screen="Repos"
            problem="The header has 6 separate counts. The drift bar is small. The Quiet indicator is mysterious."
            mock={<ReposAfterMock />}
            changes={[
              "Header condenses to '10 repos · 3 need attention' — drill-in for the rest.",
              "Drift bar gets a wider scale + a clearer numeric value.",
              "Quiet moves into the inspector as a labelled block, not a header glyph.",
            ]}
          />
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          §2 — Current state — baseline
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §2 · Current state — baseline
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The live app as it ships today — the baseline §1 was projected
          from. Each window uses real data from the recent screenshots;
          Comms is illustrative (no live screenshot was provided). The
          dedicated study for each screen is the source of truth.
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ScreenCard
            label="Comms"
            href="/studies/scout-comms"
            note="Single-pane conversation list. Header + filter + search + recency-grouped rows. The list *is* the surface; the conversation opens in a pushed view. No right inspector on the live screen."
            illustrative
          >
            <CommsMock />
          </ScreenCard>
          <ScreenCard
            label="Agents"
            href="/studies/agent-inspector-card"
            note="Project · agent tree with a per-agent row. Header + filter + Expand/Collapse + column header (AGENT / UPDATED). The right inspector follows the cursor."
            sourceScreenshot="2026-06-12 00.07.38"
          >
            <AgentsMock />
          </ScreenCard>
          <ScreenCard
            label="Tail"
            href="/studies/scout-tail"
            note="Live cross-agent firehose. Header (Live + counts + Pause) + kind filter chips + 7-column log rows. The right inspector is an *overview* of the source, not a selection."
            sourceScreenshot="2026-06-12 00.07.57"
          >
            <TailMock />
          </ScreenCard>
          <ScreenCard
            label="Repos"
            href="/studies/branch-diff-sheet"
            note="Repo · worktree table. Header with live counts (10 · 15 · dirty · attn · Quiet) + Table/Drift toggle + a flat tree of repos with their worktrees and drift bars underneath."
            sourceScreenshot="2026-06-12 00.07.50"
          >
            <ReposMock />
          </ScreenCard>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          §3 — The shell chrome
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §3 · The shell chrome
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The five pieces every screen shares. When a piece changes here,
          it changes on all four screens at once.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          <ChromeSpec
            label="Titlebar"
            owner="NSWindow / NSToolbar"
            token="--studio-canvas-alt bg · --studio-edge hairline"
            note="30px tall. Traffic lights on the left, side-by-side / split toggles on the right. The window itself owns this; the app does not paint over it."
          />
          <ChromeSpec
            label="Left nav rail"
            owner="ScoutRootView"
            token="--studio-canvas-alt bg · 40px wide"
            note="Five icons (Comms · Agents · Tail · Repos · Settings at the foot). Active section gets bg-studio-surface. The brand mark sits at the top."
          />
          <ChromeSpec
            label="Main column"
            owner="per-screen SwiftUI view"
            token="flex · 1fr"
            note="Each screen owns its own header + filter + list. The shell gives it a flex column; the screen fills it."
          />
          <ChromeSpec
            label="Right inspector"
            owner="per-screen inspector view"
            token="300px wide (live) · --studio-surface bg"
            note="Lives on Agent, Tail, Repos. Comms does not own one. Width is in @AppStorage; collapsed hides the column entirely."
          />
          <ChromeSpec
            label="Status bar"
            owner="ScoutRootView"
            token="--studio-canvas-alt bg · 22px tall"
            note="Bottom row. Live dot + active section name on the left. Quiet by design — the operator should be able to ignore it. The Tail surface adds a secondary line with buffered count."
          />
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          §4 — Sections
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §4 · Sections
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The five <code className="text-studio-ink-muted">ScoutSection</code>{" "}
          cases, in sidebar order. Four own a screen; Settings pushes a
          sheet and is excluded from this page.
        </p>

        <div className="overflow-hidden rounded-md border border-studio-edge">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="bg-studio-canvas-alt text-left text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                <th className="px-3 py-2">Section</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Inspector</th>
                <th className="px-3 py-2">Dedicated study</th>
              </tr>
            </thead>
            <tbody>
              {[
                { s: "comms",  src: "ScoutCommsView",                  insp: "—",            study: "/studies/scout-comms" },
                { s: "agents", src: "ScoutRootView (agents tree)",     insp: "per-agent",    study: "/studies/agent-inspector-card" },
                { s: "tail",   src: "ScoutTailView",                   insp: "tail overview",study: "/studies/scout-tail" },
                { s: "repos",  src: "ScoutReposView",                  insp: "per-repo",     study: "/studies/branch-diff-sheet" },
              ].map((row, i) => (
                <tr
                  key={row.s}
                  className={i % 2 === 0 ? "bg-studio-surface" : "bg-studio-canvas-alt"}
                >
                  <td className="px-3 py-2 text-studio-ink">{row.s}</td>
                  <td className="px-3 py-2 text-studio-ink-muted">{row.src}</td>
                  <td className="px-3 py-2 text-studio-ink-muted">{row.insp}</td>
                  <td className="px-3 py-2 text-scout-accent">
                    <a href={row.study} className="hover:underline">{row.study}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          §5 — Open design questions
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §5 · Open design questions
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Questions the projections in §1 raise but don't answer. Three
          questions from the prior draft (Comms w/o inspector, Tail's
          overview inspector, agent-row density) are resolved by §1 and
          removed from this list.
        </p>

        <ul className="flex max-w-prose flex-col gap-3 font-sans text-[13px] leading-relaxed text-studio-ink">
          <Question q="Does the Comms projection break the list-first read?">
            The 300px inspector takes ~45% of the content area at the
            live app's width. The list drops from ~6 visible rows to ~3-4
            per group. Worth confirming on a real Comms window before
            the port — if the list-first read breaks, the inspector
            should collapse by default and pop on row hover, or live
            behind a toolbar toggle.
          </Question>
          <Question q="Does the Tail projection lose too much speaker context?">
            Collapsing source + agent + name · id into the body drops
            four pieces of metadata. Some of it (the pid) is noise; some
            (the source/agent) is the disambiguation that makes the tail
            scannable when many harnesses are writing at once. A
            compromise: show the source in a 1-char chip prefix on the
            row, drop the rest into the inspector.
          </Question>
          <Question q="When does the inspector-grammar port happen?">
            The §2 baseline still uses the <em>current</em> inspector
            treatment, not the unified grammar from{" "}
            <a href="/studies/inspector-grammar" className="text-scout-accent hover:underline">
              /studies/inspector-grammar
            </a>
            . The port to a shared Swift <code>InspectorFrame</code> is
            the next step after at least one projection is signed off.
            Worth doing <em>before</em> the per-screen ports so all four
            surfaces adopt the new chrome in lockstep.
          </Question>
          <Question q="Comms needs a live screenshot.">
            §2 Comms is illustrative — the rows are made up. Capture a
            fresh Comms window and the baseline data + layout should
            follow, like the other three.
          </Question>
        </ul>
      </section>

      <footer className="border-t border-studio-edge pt-4 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        Status · draft ·{" "}
        <span className="text-studio-ink-muted">drives</span>{" "}
        ScoutRootView, ScoutCommsView, ScoutTailView, ScoutReposView
      </footer>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */

function ScreenCard({
  label,
  href,
  note,
  children,
  sourceScreenshot,
  illustrative,
}: {
  label: string;
  href: string;
  note: string;
  children: React.ReactNode;
  sourceScreenshot?: string;
  illustrative?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-scout-accent">
            {label}
          </div>
          {illustrative ? (
            <span className="rounded-[2px] bg-studio-canvas-alt px-1 py-px font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              Illustrative
            </span>
          ) : sourceScreenshot ? (
            <span className="rounded-[2px] bg-studio-canvas-alt px-1 py-px font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              from screenshot
            </span>
          ) : null}
        </div>
        <a
          href={href}
          className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint hover:text-studio-ink"
        >
          study →
        </a>
      </div>
      {children}
      <p className="font-sans text-[11.5px] leading-snug text-studio-ink-faint">{note}</p>
    </div>
  );
}

function ChromeSpec({
  label,
  owner,
  token,
  note,
}: {
  label: string;
  owner: string;
  token: string;
  note: string;
}) {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface p-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink">
          {label}
        </div>
        <code className="font-mono text-[8.5px] text-studio-ink-faint">{owner}</code>
      </div>
      <div className="mb-1.5 font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-muted">
        {token}
      </div>
      <p className="font-sans text-[10.5px] leading-snug text-studio-ink-faint">{note}</p>
    </div>
  );
}

function Question({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <li className="rounded-md border border-studio-edge bg-studio-canvas-alt p-3">
      <div className="font-medium text-studio-ink">{q}</div>
      <div className="mt-1 text-studio-ink-faint">{children}</div>
    </li>
  );
}

function ProjectionCard({
  screen,
  problem,
  mock,
  changes,
}: {
  screen: string;
  problem: string;
  mock: React.ReactNode;
  changes: string[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-scout-accent">
          {screen}
        </div>
        <span className="rounded-[2px] bg-scout-accent-soft px-1 py-px font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-scout-accent">
          Direction
        </span>
      </div>
      {mock}
      <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-3">
        <div className="mb-1.5 font-sans text-[12px] font-medium text-studio-ink">
          {problem}
        </div>
        <ul className="flex flex-col gap-1 font-sans text-[11px] leading-snug text-studio-ink-faint">
          {changes.map((c, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="mt-1.5 inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-scout-accent" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
