/**
 * Scout macOS Shell — the master page for the four screens in the
 * Scout macOS app: Comms, Agents, Tail, Repos.
 *
 * What this page is
 * -----------------
 * A 2x2 grid of window mockups, one per screen, on the shared Scout
 * macOS shell chrome — titlebar · left nav rail · main content · right
 * inspector · status bar. Each window is sized so the whole grid fits
 * on one screen so you can compare the four at a glance.
 *
 * Why it exists
 * -------------
 * Each screen used to be designed in isolation (one study per screen,
 * one study per sub-feature). That's fine for surface-level work, but
 * it means the shell evolves by accident — each screen pulls the
 * chrome in a slightly different direction. This page pins the
 * current state of all four at once, so when the shell changes, the
 * change is visible everywhere at the same time.
 *
 * What it's not
 * -------------
 * - Not a pixel-accurate SwiftUI preview. The shell chrome is real;
 *   the row content is representative, not exhaustive. The dedicated
 *   study for each screen is the source of truth for that screen.
 * - Not the new grammar. The right-rail inspector on each window is
 *   rendered in the *current* treatment from the live app — what the
 *   operator sees today. The unified grammar from
 *   /studies/inspector-grammar is the *proposed* treatment; the port
 *   happens after this page is signed off.
 *
 * Status: draft.
 */

import { EyebrowLabel } from "@/components/EyebrowLabel";

/* ────────────────────────────────────────────────────────────────────
   Mock data — small, representative slices of each screen.
   Mirrors the live app's data shape (per the Swift models) so the
   proportions and densities read correctly. Bump these when the
   live app changes and the studio should follow.
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

const AGENT_GROUPS = [
  {
    project: "Action",
    path: "~/dev/action",
    count: 1,
    agents: [
      {
        name: "Action",
        role: "Relay agent",
        meta: "claude · claude_stream_json",
        updated: "1d",
        selected: true,
      },
    ],
  },
  {
    project: "Art",
    path: "~/dev",
    count: 1,
    agents: [
      {
        name: "Art",
        role: "Relay agent",
        meta: "",
        updated: "—",
        selected: false,
      },
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
        meta: "claude · claude_stream_json",
        updated: "1d",
        selected: false,
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
        meta: "pi · pi_rpc",
        updated: "1d",
        selected: false,
      },
      {
        name: "Grok Hudson Lite",
        role: "Relay agent",
        meta: "pi · pi_rpc",
        updated: "1d",
        selected: false,
      },
      {
        name: "Hudson",
        role: "Relay agent",
        meta: "claude · claude_stream_json",
        updated: "1d",
        selected: false,
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
        meta: "claude · tmux",
        updated: "10h 15m",
        selected: false,
      },
      {
        name: "Openscout",
        role: "Relay agent",
        meta: "codex · codex_app_server",
        updated: "10h 15m",
        selected: false,
      },
      {
        name: "Scout",
        role: "operator-assistant",
        meta: "codex · codex_app_server",
        updated: "10h 15m",
        selected: false,
      },
    ],
  },
];

const TAIL_ROWS = [
  { time: "00:01:02", source: "codex", agent: "native", kind: "SYS", msg: "tokens · 12462029" },
  { time: "00:01:06", source: "codex", agent: "native", kind: "SYS", msg: "[reasoning]" },
  { time: "00:01:07", source: "codex", agent: "native", kind: "ASST", msg: "Both builds succeeded. I'm relaunching TalkieA…" },
  { time: "00:01:10", source: "codex", agent: "native", kind: "TOOL", msg: 'exec_command({"cmd":"./run.sh TalkieAgent Talk…" })' },
  { time: "00:01:14", source: "codex", agent: "native", kind: "OUT", msg: "→ Chunk ID: 51697a Wall time: 4.0798 seconds…" },
  { time: "00:01:14", source: "codex", agent: "native", kind: "SYS", msg: "tokens · 12621726" },
  { time: "00:01:25", source: "codex", agent: "native", kind: "SYS", msg: "[reasoning]" },
  { time: "00:01:31", source: "codex", agent: "native", kind: "ASST", msg: "The relaunch completed; the agent signing step…" },
  { time: "00:01:31", source: "codex", agent: "native", kind: "TOOL", msg: 'exec_command({"cmd":"pgrep -fl \\"TalkieAgent[…]" })' },
  { time: "00:01:32", source: "codex", agent: "native", kind: "OUT", msg: "→ Chunk ID: ef9e28 Wall time: 0.0000 seconds…" },
  { time: "00:01:32", source: "codex", agent: "native", kind: "TOOL", msg: 'exec_command({"cmd":"git diff --check -- apps/…" })' },
  { time: "00:01:35", source: "codex", agent: "native", kind: "SYS", msg: "[reasoning]" },
];

const REPOS = [
  {
    name: "lattices",
    path: "~/art/dev/lattices",
    worktrees: [{ branch: "main", add: 491, del: 102, files: 2, drift: null, agents: 2, touched: "—" }],
    selected: true,
  },
  {
    name: "preframe",
    path: "~/art/dev/preframe",
    worktrees: [{ branch: "main", add: 68, del: 15, files: 10, drift: null, agents: 1, touched: "—" }],
  },
  {
    name: "action",
    path: "~/art/dev/action",
    worktrees: [
      {
        branch: "codex/polished-mira-demo",
        add: 284,
        del: 39,
        files: 27,
        drift: "+21",
        agents: 1,
        touched: "—",
      },
    ],
  },
  {
    name: "dewey",
    path: "~/art/dev/dewey",
    worktrees: [{ branch: "main", add: null, del: null, files: null, drift: null, agents: 1, touched: "—" }],
  },
  {
    name: "hudson",
    path: "~/art/dev/hudson",
    worktrees: [
      {
        branch: "feat/hud-markdown-renderer",
        add: 239,
        del: 57,
        files: 24,
        drift: "+35",
        agents: 6,
        touched: "—",
      },
      { branch: "main", add: null, del: null, files: null, drift: null, agents: null, touched: "—" },
    ],
  },
  {
    name: "openscout",
    path: "~/art/dev/openscout",
    worktrees: [
      {
        branch: "feat/scout-ios-lan-pairing",
        add: 1534,
        del: 1810,
        files: 42,
        drift: null,
        agents: 183,
        touched: "—",
      },
      {
        branch: "feat/repo-watch-web-converge",
        add: 1158,
        del: 231,
        files: 27,
        drift: null,
        agents: 103,
        touched: "—",
      },
    ],
  },
];

/* ────────────────────────────────────────────────────────────────────
   Shared chrome — the Scout macOS window frame.
   Titlebar · left nav rail · body · status bar.
   Body is a 2-column flex: [main] [inspector] at the real 300px
   inspector width.
   ──────────────────────────────────────────────────────────────────── */

type SectionId = "comms" | "agents" | "tail" | "repos";

function MacOSWindow({
  active,
  children,
}: {
  active: SectionId;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[420px] flex-col overflow-hidden rounded-[10px] border border-studio-edge-strong bg-studio-canvas shadow-[0_18px_40px_-24px_color-mix(in_oklab,var(--studio-ink)_55%,transparent)]">
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

/* nav rail — five icons + settings at the bottom, the same shape the
   live app draws. Active section gets a subtle background fill. */
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
   This is what the operator sees today; the new grammar from
   /studies/inspector-grammar is the proposed replacement.
   ──────────────────────────────────────────────────────────────────── */

function InspectorPane({ kind, status, children }: { kind: string; status: string; children: React.ReactNode }) {
  return (
    <div className="flex w-[180px] flex-none flex-col border-l border-studio-edge bg-studio-surface">
      <div className="flex items-center justify-between border-b border-studio-edge px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-0.5 rounded-sm bg-scout-accent" />
          <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            {kind}
          </span>
        </div>
        <span className="font-mono text-[8px] font-semibold uppercase tracking-eyebrow text-status-ok-fg">
          {status}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 overflow-hidden p-2.5">{children}</div>
    </div>
  );
}

function InspectorSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function InspectorRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-baseline gap-x-1.5 font-mono text-[9.5px]">
      <span className="uppercase tracking-eyebrow text-studio-ink-faint">{k}</span>
      <span className="truncate text-right text-studio-ink-muted">{v}</span>
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
      <InspectorPane kind="DM" status="AVAILABLE">
        <InspectorSection label="Identity">
          <InspectorRow k="Name" v="Dewey" />
          <InspectorRow k="Harness" v="claude" />
          <InspectorRow k="Transport" v="claude_stream_json" />
        </InspectorSection>
        <InspectorSection label="Project">
          <InspectorRow k="Branch" v="main" />
          <InspectorRow k="Path" v="~/dev/dewey" />
        </InspectorSection>
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
          <div className="flex items-center gap-1">
            <span className="rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
              Expand
            </span>
            <span className="rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
              Collapse
            </span>
          </div>
        </div>
        {/* filter row */}
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
                <span className="font-mono text-[8.5px] text-studio-ink-faint">{g.path}</span>
                <span className="ml-auto font-mono text-[8.5px] text-studio-ink-faint">
                  {g.count} agent{g.count === 1 ? "" : "s"}
                </span>
              </div>
              {g.agents.map((a) => (
                <div
                  key={a.name}
                  className={[
                    "flex items-center gap-2 border-l-2 px-3 py-1",
                    a.selected ? "border-scout-accent bg-studio-canvas-alt" : "border-transparent",
                  ].join(" ")}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-ok-fg" />
                  <span className="truncate font-sans text-[10.5px] font-medium text-studio-ink">
                    {a.name}
                  </span>
                  <span className="truncate font-mono text-[8.5px] text-studio-ink-faint">
                    {a.role}
                    {a.meta ? ` · ${a.meta}` : ""}
                  </span>
                  <span className="ml-auto font-mono text-[8.5px] text-studio-ink-faint">
                    {a.updated}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <InspectorPane kind="AGENT" status="AVAILABLE">
        <div className="flex items-center gap-2">
          <div className="grid h-[22px] w-[22px] place-items-center rounded-full bg-studio-canvas-alt font-mono text-[10px] text-studio-ink">
            A
          </div>
          <div>
            <div className="font-sans text-[11px] font-semibold text-studio-ink">Action</div>
            <div className="font-mono text-[8px] text-studio-ink-faint">
              action.codex-polished-mira-demo…
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
        <InspectorSection label="Runtime">
          <InspectorRow k="Role" v="Relay agent" />
          <InspectorRow k="Harness" v="claude" />
          <InspectorRow k="Transport" v="claude_stream_json" />
        </InspectorSection>
        <InspectorSection label="Workspace">
          <InspectorRow k="Branch" v="codex/polished-mira-demo" />
          <InspectorRow k="Path" v="~/dev/action" />
        </InspectorSection>
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
              40 logs · 19 procs · 0.0 lines/s
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
              ‖ Pause
            </span>
            <span className="rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
              ↻
            </span>
          </div>
        </div>
        {/* filter row */}
        <div className="flex flex-none flex-col gap-1 border-b border-studio-edge px-3 py-1.5">
          <div className="flex h-[18px] items-center gap-1.5 rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-1.5 text-studio-ink-faint">
            {iconSearch()}
            <span className="font-mono text-[8.5px]">Search</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {[
              { l: "All sources", active: true },
              { l: "All", active: true },
              { l: "User" },
              { l: "Assistant" },
              { l: "Tool" },
              { l: "Tool result" },
              { l: "System" },
              { l: "Other" },
            ].map((c, i) => (
              <span
                key={`${c.l}-${i}`}
                className={[
                  "rounded-[3px] px-1.5 py-0.5 font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow",
                  c.active
                    ? "bg-studio-surface text-studio-ink"
                    : "text-studio-ink-faint",
                ].join(" ")}
              >
                {c.l}
              </span>
            ))}
          </div>
        </div>
        {/* rows */}
        <div className="flex-1 overflow-hidden font-mono text-[9px]">
          {TAIL_ROWS.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-[58px_56px_56px_44px_1fr] items-baseline gap-x-2 border-b border-studio-edge px-3 py-0.5"
            >
              <span className="text-studio-ink-faint">{r.time}</span>
              <span className="truncate text-studio-ink-muted">{r.source}</span>
              <span className="truncate text-studio-ink-muted">{r.agent}</span>
              <span className="rounded-[2px] bg-studio-canvas-alt px-1 text-center text-[7.5px] font-semibold text-studio-ink">
                {r.kind}
              </span>
              <span className="truncate text-studio-ink-muted">{r.msg}</span>
            </div>
          ))}
        </div>
      </div>
      <InspectorPane kind="OVERVIEW" status="LIVE">
        <InspectorSection label="Coverage">
          <InspectorRow k="Logs" v="40" />
          <InspectorRow k="Processes" v="19" />
          <InspectorRow k="Sessions" v="4" />
          <InspectorRow k="Buffered" v="700" />
        </InspectorSection>
        <InspectorSection label="Sources">
          <InspectorRow k="codex" v="515" />
          <InspectorRow k="claude" v="185" />
        </InspectorSection>
        <InspectorSection label="Kinds">
          <InspectorRow k="System" v="197" />
          <InspectorRow k="Tool result" v="185" />
          <InspectorRow k="Tool" v="168" />
        </InspectorSection>
      </InspectorPane>
    </MacOSWindow>
  );
}

function ReposMock() {
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
            <span
              className="font-mono text-[8.5px]"
              style={{ color: "var(--status-warn-fg)" }}
            >
              8 dirty
            </span>
            <span
              className="font-mono text-[8.5px]"
              style={{ color: "var(--status-warn-fg)" }}
            >
              3 attn
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
          <div className="grid grid-cols-[1fr_64px_32px_64px_36px] items-center gap-x-1 border-b border-studio-edge-strong bg-studio-canvas-alt px-3 py-1 font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            <span>Repo / Branch</span>
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
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-ok-fg" />
                <span className="font-sans text-[10.5px] font-semibold text-studio-ink">
                  {r.name}
                </span>
                <span className="font-mono text-[8.5px] text-studio-ink-faint">{r.path}</span>
                <span className="ml-auto font-mono text-[8.5px] text-studio-ink-faint">
                  {r.worktrees.length} tree{r.worktrees.length === 1 ? "" : "s"}
                </span>
              </div>
              {r.worktrees.map((w, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_64px_32px_64px_36px] items-baseline gap-x-1 border-b border-studio-edge px-3 py-0.5 font-mono text-[8.5px]"
                >
                  <span className="truncate">
                    <span className="text-studio-ink-faint">└ </span>
                    <span className="text-studio-ink">{w.branch}</span>
                  </span>
                  <span className="text-right">
                    {w.add !== null ? (
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
                  <span className="text-right text-studio-ink-muted">
                    {w.files ?? "—"}
                  </span>
                  <span className="text-right">
                    {w.drift ? (
                      <span style={{ color: "var(--status-warn-fg)" }}>{w.drift}</span>
                    ) : (
                      <span className="text-studio-ink-faint">—</span>
                    )}
                  </span>
                  <span className="text-right text-studio-ink-muted">
                    {w.agents ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <InspectorPane kind="REPO" status="ATTENTION">
        <div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-warn-fg" />
            <span className="font-sans text-[11.5px] font-semibold text-studio-ink">lattices</span>
          </div>
          <div className="font-mono text-[8.5px] text-studio-ink-faint">
            /Users/art/dev/lattices
          </div>
        </div>
        <InspectorSection label="Why">
          <div className="font-mono text-[9.5px] text-studio-ink-muted">Dirty main</div>
        </InspectorSection>
        <InspectorSection label="Worktrees">
          <InspectorRow k="Total" v="1" />
          <InspectorRow k="Dirty" v="1" />
        </InspectorSection>
        <InspectorSection label="Changes">
          <InspectorRow k="Staged" v="0" />
          <InspectorRow k="Unstaged" v="2" />
          <InspectorRow k="Untracked" v="0" />
        </InspectorSection>
        <InspectorSection label="Attached">
          <InspectorRow k="Agents" v="2" />
          <InspectorRow k="Sessions" v="2" />
        </InspectorSection>
      </InspectorPane>
    </MacOSWindow>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Inline icons (single-color, 1.2px stroke, currentColor).
   Kept local to this file to avoid coupling the master page to
   detail-level icon atoms.
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
          The four screens in the Scout macOS app —{" "}
          <span className="text-studio-ink-muted">Comms</span>,{" "}
          <span className="text-studio-ink-muted">Agents</span>,{" "}
          <span className="text-studio-ink-muted">Tail</span>, and{" "}
          <span className="text-studio-ink-muted">Repos</span> — rendered on
          the shared shell chrome (titlebar · left nav rail · main ·
          right inspector · status bar) so the shell can evolve
          coherently. Settings is omitted because it pushes a sheet
          rather than owning a section.
        </p>
      </header>

      {/* ────────────────────────────────────────────────────────────
          §1 — The four screens
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §1 · The four screens
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Each window is a representative slice of the live screen —
          enough to evaluate the layout, not enough to drown the page.
          The dedicated study for each screen is the source of truth.
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ScreenCard
            label="Comms"
            href="/studies/scout-comms"
            note="Single-pane conversation list. Header + filter + search + recency-grouped rows. The list *is* the surface; the conversation opens in a pushed view."
          >
            <CommsMock />
          </ScreenCard>
          <ScreenCard
            label="Agents"
            href="/studies/agent-inspector-card"
            note="Project · agent tree. Header + filter + grouped rows. The right inspector follows the cursor."
          >
            <AgentsMock />
          </ScreenCard>
          <ScreenCard
            label="Tail"
            href="/studies/scout-tail"
            note="Live cross-agent firehose. Header + kind filters + log rows. The right inspector is an *overview* of the source, not a selection."
          >
            <TailMock />
          </ScreenCard>
          <ScreenCard
            label="Repos"
            href="/studies/branch-diff-sheet"
            note="Repo · worktree table. Header with live counts + view toggle (Table/Drift) + a flat tree of repos with their worktrees underneath. The right inspector follows the cursor."
          >
            <ReposMock />
          </ScreenCard>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          §2 — The shell chrome
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §2 · The shell chrome
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
            note="Bottom row. Live dot + active section name on the left. Quiet by design — the operator should be able to ignore it."
          />
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          §3 — Sections
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §3 · Sections
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
                {
                  s: "comms",
                  src: "ScoutCommsView",
                  insp: "—",
                  study: "/studies/scout-comms",
                },
                {
                  s: "agents",
                  src: "ScoutRootView (agents tree)",
                  insp: "per-agent",
                  study: "/studies/agent-inspector-card",
                },
                {
                  s: "tail",
                  src: "ScoutTailView",
                  insp: "tail overview",
                  study: "/studies/scout-tail",
                },
                {
                  s: "repos",
                  src: "ScoutReposView",
                  insp: "per-repo",
                  study: "/studies/branch-diff-sheet",
                },
              ].map((row, i) => (
                <tr
                  key={row.s}
                  className={i % 2 === 0 ? "bg-studio-surface" : "bg-studio-canvas-alt"}
                >
                  <td className="px-3 py-2 text-studio-ink">{row.s}</td>
                  <td className="px-3 py-2 text-studio-ink-muted">{row.src}</td>
                  <td className="px-3 py-2 text-studio-ink-muted">{row.insp}</td>
                  <td className="px-3 py-2 text-scout-accent">
                    <a href={row.study} className="hover:underline">
                      {row.study}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          §4 — Open questions
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §4 · Open design questions
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Things the master page is meant to surface. The dedicated
          studies settle them; this page is the place to remember that
          they're still open.
        </p>

        <ul className="flex max-w-prose flex-col gap-3 font-sans text-[13px] leading-relaxed text-studio-ink">
          <Question q="Comms has no right inspector. Should it get one?">
            The other three surfaces all own a 300px inspector column.
            Comms owns none — the conversation list *is* the surface, and
            the conversation opens in a pushed view. Either Comms
            inherits the inspector pattern (e.g. pinned conversations,
            per-conversation metadata) or the four screens officially
            fall into "three with inspector, one without" and that's
            documented.
          </Question>
          <Question q="Tail's inspector is a global overview, not a selection. Is that the right read?">
            The Agent and Repo inspectors are per-selection; Tail's
            is a coverage / sources / kinds rollup of the *whole* tail.
            The right column isn't following the cursor — it's a
            dashboard. Worth deciding whether Tail should be a fourth
            per-selection inspector (the selected event) or whether
            "overview" is genuinely the right read for that surface.
          </Question>
          <Question q="The agent-row density on the Agents view is sparse. Is that correct?">
            The live screen shows ~9 rows in the visible area. The repo
            view shows ~12 worktree rows. The comms view shows ~6
            conversations. Three different densities. Settle on a row
            height (or three intentional densities) so a future
            compression pass has a target.
          </Question>
          <Question q="The right-rail inspector on this page is the *current* treatment, not the new grammar.">
            Each window on §1 paints the inspector the way it ships
            today. Once /studies/inspector-grammar is approved, the
            master page re-renders all four inspectors from the unified
            grammar so the delta is visible at a glance.
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
}: {
  label: string;
  href: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-scout-accent">
          {label}
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
