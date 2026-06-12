/**
 * Scout Comms · With Inspector — the visual spec for the Comms
 * inspector. The IA-level design (block library, composition rules,
 * entity model) lives at /studies/inspector-system; this study is
 * the focused iteration on how the Comms composition reads at
 * width, what variants exist, and which decisions are Comms-specific.
 *
 * Structure:
 *   §1  The projection.    A full-size window mockup with the
 *                          inspector wired in. This is what we're
 *                          porting to Swift.
 *   §2  Variants.          Three ways the inspector could be
 *                          integrated: always visible, pop on
 *                          row select, toolbar toggle. Each with
 *                          a small mockup + the trade-off.
 *   §3  Composition.       The Comms inspector as a block
 *                          composition from /studies/inspector-system,
 *                          with the data each block reads.
 *   §4  Design decisions.  The choices that don't follow from the
 *                          other three surfaces and need their own
 *                          rationale.
 *   §5  Open questions.    Comms-specific things this study raises
 *                          but doesn't answer.
 *
 * The §1 right-rail inspector uses the unified grammar from
 * /studies/inspector-grammar — overline + stacked label/value,
 * filled status badge, etc. The block library is in
 * /studies/inspector-system.
 *
 * Status: draft.
 */

import { EyebrowLabel } from "@/components/EyebrowLabel";

/* ────────────────────────────────────────────────────────────────────
   Mock data — used across §1, §2, and §3.
   The `CONVERSATIONS` shape mirrors `ScoutChannel` (with the extra
   fields the new inspector needs marked NEW).
   ──────────────────────────────────────────────────────────────────── */

type Group = "now" | "today" | "earlier";
type AskState = "pending" | "answered" | null;

type Conversation = {
  cId: string;
  name: string;
  agentId: string;        // NEW — the inspector identity line
  avatar: string;
  channel?: boolean;
  ask: AskState;
  preview: string;
  time: string;
  lastMessageAt: number;  // NEW — for the inspector's "last" field
  unread: boolean;
  unreadCount: number;    // NEW — for the inspector's "unread" field
  selected?: boolean;
  group: Group;
  // Project — NEW (most DMs have a project; the inspector surfaces it)
  project?: {
    name: string;
    branch: string;
    path: string;
  };
  // Ask — NEW (for the inspector's "Ask" block)
  askDetail?: {
    id: string;
    from: string;
    text: string;
  };
};

const NOW = 1718160000; // fixed reference time so the relative strings are stable

const CONVERSATIONS: Conversation[] = [
  {
    cId: "a4d433a9",
    name: "Dewey",
    agentId: "dewey.main.arts-mac-mini-local",
    avatar: "D",
    ask: null,
    preview:
      "Great breakdown. Take both — and surface the active theme in the inspector while you're in the view layer…",
    time: "2m",
    lastMessageAt: NOW - 120,
    unread: true,
    unreadCount: 2,
    selected: true,
    group: "now",
    project: { name: "dewey", branch: "main", path: "~/dev/dewey" },
  },
  {
    cId: "ab3fd029",
    name: "Hudson",
    agentId: "hudson.arts-mac-mini-local",
    avatar: "H",
    ask: "answered",
    preview: "On it. Moved resolveStartupTheme() ahead of the composer mount…",
    time: "8m",
    lastMessageAt: NOW - 480,
    unread: false,
    unreadCount: 0,
    group: "now",
    project: { name: "hudson", branch: "main", path: "~/dev/hudson" },
    askDetail: {
      id: "ask:f-mq8ubzy0-8qm0",
      from: "Art",
      text: "Review AgentHomeShellView — should overlay settings render before send?",
    },
  },
  {
    cId: "f0192c8a",
    name: "Scout · iOS pairing",
    agentId: "scout.ios-pairing",
    avatar: "S",
    ask: "pending",
    preview: "QR handoff from iOS. Awaiting the second-device scan.",
    time: "11m",
    lastMessageAt: NOW - 660,
    unread: true,
    unreadCount: 1,
    group: "now",
    project: { name: "openscout", branch: "feat/scout-ios-lan-pairing", path: "~/dev/openscout" },
    askDetail: {
      id: "ask:f-77a91bc2-31e4",
      from: "Scout",
      text: "Confirm the QR handoff is visible on the iPad's home screen.",
    },
  },
  {
    cId: "3aaf1b07",
    name: "Atlas",
    agentId: "atlas.main.arts-mac-mini-local",
    avatar: "A",
    ask: null,
    preview: "Dropped the iconography study. Want to walk through it?",
    time: "22m",
    lastMessageAt: NOW - 1320,
    unread: false,
    unreadCount: 0,
    group: "today",
    project: { name: "atlas", branch: "design/atlas-iconography", path: "~/dev/atlas" },
  },
  {
    cId: "c2d884f1",
    name: "Preframe",
    agentId: "preframe.arts-mac-mini-local",
    avatar: "P",
    ask: null,
    preview: "Today's standup is in 5m — I'll bring up the worktree map.",
    time: "1h",
    lastMessageAt: NOW - 3600,
    unread: false,
    unreadCount: 0,
    group: "today",
    project: { name: "preframe", branch: "main", path: "~/dev/preframe" },
  },
  {
    cId: "1e07d9b3",
    name: "Lattices",
    agentId: "lattices.arts-mac-mini-local",
    avatar: "L",
    ask: null,
    preview: "Pushed a fix for the new-conversation footer button.",
    time: "1d",
    lastMessageAt: NOW - 86400,
    unread: false,
    unreadCount: 0,
    group: "earlier",
    project: { name: "lattices", branch: "main", path: "~/dev/lattices" },
  },
  {
    cId: "5a2b8c44",
    name: "Talkie",
    agentId: "talkie.arts-mac-mini-local",
    avatar: "T",
    ask: "answered",
    preview: "Render before send — the no-skin-flash fix is in.",
    time: "1d",
    lastMessageAt: NOW - 90000,
    unread: false,
    unreadCount: 0,
    group: "earlier",
    project: { name: "talkie", branch: "main", path: "~/dev/talkie" },
  },
];

/* ────────────────────────────────────────────────────────────────────
   Window chrome — shared across §1 and §2.
   Same shell as /studies/scout-macos-shell — titlebar, nav rail,
   status bar. The inspector is the new piece.
   ──────────────────────────────────────────────────────────────────── */

type ActiveSection = "comms";

function MacOSWindow({
  active,
  children,
  height = 720,
}: {
  active: ActiveSection;
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
        <WindowTool>
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden>
            <rect x="0.5" y="0.5" width="6" height="9" rx="1" stroke="currentColor" />
            <rect x="7.5" y="0.5" width="6" height="9" rx="1" stroke="currentColor" />
          </svg>
        </WindowTool>
        <WindowTool>
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden>
            <rect x="0.5" y="0.5" width="6" height="9" rx="1" stroke="currentColor" />
            <rect x="7.5" y="3.5" width="6" height="6" rx="1" stroke="currentColor" />
          </svg>
        </WindowTool>
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

const NAV_ITEMS: { id: ActiveSection | "agents" | "tail" | "repos" | "settings"; label: string; icon: React.ReactNode }[] = [
  { id: "comms", label: "Comms", icon: navBubble() },
  { id: "agents", label: "Agents", icon: navAgents() },
  { id: "tail", label: "Tail", icon: navPulse() },
  { id: "repos", label: "Repos", icon: navRepos() },
];

function NavRail({ active }: { active: ActiveSection }) {
  return (
    <div
      className="flex w-[40px] flex-none flex-col items-center gap-1 border-r border-studio-edge py-2"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      <div className="mb-1 grid h-[26px] w-[26px] place-items-center rounded-[6px] bg-scout-accent font-display text-[12px] font-semibold text-studio-canvas">
        S
      </div>
      {NAV_ITEMS.map((it) => (
        <div
          key={it.id}
          className={[
            "grid h-[26px] w-[26px] place-items-center rounded-[5px] text-studio-ink-faint",
            it.id === active ? "bg-studio-surface text-studio-ink" : "",
          ].join(" ")}
          title={it.label}
        >
          {it.icon}
        </div>
      ))}
      <div className="mt-auto grid h-[26px] w-[26px] place-items-center rounded-[5px] text-studio-ink-faint">
        {navSettings()}
      </div>
    </div>
  );
}

function StatusBar({ active }: { active: ActiveSection }) {
  return (
    <div
      className="flex h-[22px] flex-none items-center gap-2 border-t border-studio-edge px-3 font-mono text-[9px] uppercase tracking-eyebrow"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-ok-fg" />
      <span className="text-studio-ink-muted">Comms</span>
    </div>
  );
}

function navBubble() {
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
function navAgents() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.5" cy="7" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 13.5c.5-2 2-3 4-3s3.5 1 4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M9.5 12.5c.4-1.2 1.3-1.8 2.3-1.8 1.1 0 1.9.6 2.2 1.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
function navPulse() {
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
function navRepos() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="12" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 4h3.5a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function navSettings() {
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

/* ────────────────────────────────────────────────────────────────────
   Comms list — the left half of every mockup on this page.
   Real rows (Dewey selected by default), with recency groups, the
   ask chip, and the unread badge.
   ──────────────────────────────────────────────────────────────────── */

function CommsList({ selectedCid = "a4d433a9" }: { selectedCid?: string }) {
  const groups: Group[] = ["now", "today", "earlier"];
  const groupLabels: Record<Group, string> = {
    now: "NOW",
    today: "TODAY",
    earlier: "EARLIER",
  };
  return (
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
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M2 8a6 6 0 0 1 10.5-3.9L14 5.5M14 8a6 6 0 0 1-10.5 3.9L2 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <path d="M14 2.5v3h-3M2 13.5v-3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
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
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M10.2 10.2L13.5 13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="font-mono text-[9.5px]">Search</span>
        </div>
      </div>
      {/* list */}
      <div className="flex-1 overflow-hidden">
        {groups.map((g) => {
          const rows = CONVERSATIONS.filter((c) => c.group === g);
          if (rows.length === 0) return null;
          return (
            <div key={g}>
              <div className="px-3 py-1 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                {groupLabels[g]}
              </div>
              {rows.map((c) => {
                const isSelected = c.cId === selectedCid;
                return (
                  <div
                    key={c.cId}
                    className={[
                      "flex flex-col gap-0.5 border-l-2 px-3 py-1.5",
                      isSelected ? "border-scout-accent bg-studio-canvas-alt" : "border-transparent",
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
                      {c.unread && c.unreadCount > 0 ? (
                        <span className="ml-auto shrink-0 rounded-full bg-status-info-fg px-1 font-mono text-[7.5px] font-semibold text-studio-canvas">
                          {c.unreadCount}
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
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Inspector — uses the unified grammar from /studies/inspector-grammar.
   - 300px wide (matches the live app)
   - overline + mono uppercase section titles (no leading dot)
   - filled status badge (tone changes, weight doesn't)
   - stacked label/value (no inline row)
   - no dividers between sections (spacing only)
   ──────────────────────────────────────────────────────────────────── */

function Inspector({
  conversation,
  variant = "always",
}: {
  conversation: Conversation;
  variant?: "always" | "pop" | "toggle";
}) {
  // For the "pop" variant, hide the inspector entirely when no row is
  // selected. For the "always" variant, always show. For the "toggle"
  // variant, show a "show inspector" affordance instead.
  if (variant === "pop" && !conversation.selected) {
    return null;
  }
  if (variant === "toggle" && !conversation.selected) {
    return (
      <div className="flex w-[80px] flex-none flex-col items-center gap-2 border-l border-studio-edge bg-studio-surface p-3">
        <div
          className="grid h-[26px] w-[26px] place-items-center rounded-[5px] text-studio-ink-faint"
          title="Show inspector"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M9 2.5v11" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
        <span
          className="rotate-180 font-mono text-[8px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint"
          style={{ writingMode: "vertical-rl" }}
        >
          Show inspector
        </span>
      </div>
    );
  }

  const askTone: "ok" | "warn" | "neutral" = conversation.ask === "pending"
    ? "warn"
    : conversation.ask === "answered"
      ? "ok"
      : "neutral";

  return (
    <div className="flex w-[300px] flex-none flex-col border-l border-studio-edge bg-studio-surface">
      {/* title row */}
      <div className="flex items-center justify-between border-b border-studio-edge px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-0.5 rounded-sm bg-scout-accent" />
          <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            DM
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-eyebrow"
          style={{
            background: "var(--status-ok-bg)",
            color: "var(--status-ok-fg)",
          }}
        >
          <span className="block h-1.5 w-1.5 rounded-full bg-current" />
          Open
        </span>
      </div>
      {/* body */}
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
        {/* identity */}
        <div>
          <div className="flex items-center gap-2">
            <div className="grid h-[28px] w-[28px] place-items-center rounded-full bg-studio-canvas-alt font-mono text-[11px] text-studio-ink">
              {conversation.avatar}
            </div>
            <div className="min-w-0">
              <div className="truncate font-sans text-[14px] font-semibold leading-tight tracking-tight text-studio-ink">
                {conversation.name}
              </div>
              <div className="truncate font-mono text-[9.5px] text-studio-ink-faint">
                {conversation.agentId}
              </div>
            </div>
          </div>
        </div>

        {/* action row */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="rounded-[5px] border px-2.5 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow"
            style={{
              background: "var(--scout-accent-soft)",
              borderColor: "var(--scout-accent)",
              color: "var(--scout-accent)",
            }}
          >
            Open
          </button>
          <button
            type="button"
            className="rounded-[5px] border border-studio-edge bg-transparent px-2.5 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted"
          >
            + New
          </button>
        </div>

        {/* conversation section */}
        <ISec label="Conversation">
          <KV k="Last" v={conversation.time} />
          <KV k="Unread" v={String(conversation.unreadCount)} vColor={conversation.unread ? "var(--status-info-fg)" : undefined} />
          <KV k="Channel" v={conversation.channel ? "#" : "DM"} />
        </ISec>

        {/* project section (if present) */}
        {conversation.project ? (
          <ISec label="Project">
            <KV k="Repo" v={conversation.project.name} />
            <KV k="Branch" v={conversation.project.branch} />
            <KV k="Path" v={conversation.project.path} />
          </ISec>
        ) : null}

        {/* ask section (if present) */}
        {conversation.ask ? (
          <ISec label="Ask" tone={askTone}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span
                  className="rounded-[2px] px-1 py-px font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow"
                  style={{
                    background: `var(--status-${askTone}-bg)`,
                    color: `var(--status-${askTone}-fg)`,
                  }}
                >
                  {conversation.ask}
                </span>
                <span className="font-mono text-[8.5px] text-studio-ink-faint">
                  from {conversation.askDetail?.from ?? "—"}
                </span>
              </div>
              {conversation.askDetail ? (
                <div className="font-sans text-[10.5px] leading-snug text-studio-ink-muted">
                  {conversation.askDetail.text}
                </div>
              ) : null}
            </div>
          </ISec>
        ) : null}
      </div>
    </div>
  );
}

/* Section uses the unified grammar: overline + mono uppercase title,
   no leading dot, no divider below. */
function ISec({
  label,
  tone = "neutral",
  children,
}: {
  label: string;
  tone?: "ok" | "warn" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <div
          aria-hidden
          className="mb-1.5 h-px w-3.5"
          style={{
            background:
              tone === "warn"
                ? "var(--status-warn-fg)"
                : tone === "ok"
                  ? "var(--status-ok-fg)"
                  : "var(--studio-edge-strong)",
          }}
        />
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          {label}
        </div>
      </div>
      {children}
    </div>
  );
}

function KV({ k, v, vColor }: { k: string; v: string; vColor?: string }) {
  return (
    <div className="grid grid-cols-[60px_1fr] items-baseline gap-x-2">
      <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {k}
      </span>
      <span
        className="truncate text-right font-mono text-[10px]"
        style={{ color: vColor ?? "var(--studio-ink-muted)" }}
      >
        {v}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────── */

export default function ScoutCommsInspectorPage() {
  // The conversation the inspector reads from — Dewey is the selection.
  const focus = CONVERSATIONS.find((c) => c.cId === "a4d433a9")!;

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-10 max-w-prose">
        <EyebrowLabel size="sm">· studies · macos · comms-inspector</EyebrowLabel>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Scout Comms · with inspector
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The Comms surface gains a 300px right-rail inspector. This
          study is the visual spec for the Comms composition — §1 is
          the port target, §2 weighs how the inspector integrates with
          the list-first read, §3 is the block composition (the IA
          lives in{" "}
          <a href="/studies/inspector-system" className="text-scout-accent hover:underline">
            /studies/inspector-system
          </a>
          ), §4 documents the decisions that don't follow from the
          other three surfaces.
        </p>
      </header>

      {/* ────────────────────────────────────────────────────────────
          §1 — The projection
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §1 · The projection
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The list is unchanged from the live app. The inspector is
          new — it follows the selection, uses the unified grammar
          from{" "}
          <a href="/studies/inspector-grammar" className="text-scout-accent hover:underline">
            /studies/inspector-grammar
          </a>
          , and shows the four blocks that make sense for a DM:
          identity, conversation, project, and ask.
        </p>

        <div className="w-full">
          <MacOSWindow active="comms">
            <CommsList selectedCid={focus.cId} />
            <Inspector conversation={focus} variant="always" />
          </MacOSWindow>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          §2 — Variants
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §2 · Variants
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Three ways the inspector could integrate. The §1 default
          (always visible) is the most familiar; the others preserve
          more list width at the cost of a step before the inspector
          shows.
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <VariantCard
            name="Always visible"
            selected
            mock={<MacOSWindow active="comms" height={420}><CommsList selectedCid={focus.cId} /><Inspector conversation={focus} variant="always" /></MacOSWindow>}
            pros={[
              "Inspector is always one click away — no extra step.",
              "Matches the Agents / Repos pattern (per-selection inspector, always on).",
              "Easiest to port: same `InspectorFrame` SwiftUI view, no new state.",
            ]}
            cons={[
              "The list drops from ~6 visible rows to ~3 per recency group at the live app's width.",
              "Comms's defining trait is the list-first read. Always-on inspector may dilute that.",
            ]}
            verdict="Default for the port."
          />
          <VariantCard
            name="Pop on row select"
            mock={<MacOSWindow active="comms" height={420}><CommsList selectedCid={focus.cId} /><Inspector conversation={focus} variant="pop" /></MacOSWindow>}
            pros={[
              "Preserves the list-first read — inspector only appears when there's a selection.",
              "Same component as the always-on variant; just gated on `selected`.",
            ]}
            cons={[
              "The inspector is hidden until the user clicks. The Agents / Repos pattern is that the inspector *follows* the cursor (keyboard nav); Comms doesn't have keyboard nav yet, so 'on click' is the only trigger.",
              "First-time users may not discover the inspector exists.",
            ]}
            verdict="Worth A/B testing after the always-on port ships."
          />
          <VariantCard
            name="Toolbar toggle"
            mock={<MacOSWindow active="comms" height={420}><CommsList selectedCid={focus.cId} /><Inspector conversation={focus} variant="toggle" /></MacOSWindow>}
            pros={[
              "List width is always maximum. The inspector is a deliberate choice.",
              "Familiar pattern (think Mail, Messages) — collapsed rail, expand on demand.",
            ]}
            cons={[
              "A second click before the inspector appears. Friction for the common case.",
              "The collapsed rail is an unfamiliar pattern in the rest of the macOS Scout app — Agents, Tail, Repos all have the inspector always on.",
            ]}
            verdict="Skip for now — inconsistent with the other three surfaces."
          />
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          §3 — Composition
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §3 · Composition
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The Comms inspector as a composition of blocks from the
          library in{" "}
          <a href="/studies/inspector-system" className="text-scout-accent hover:underline">
            /studies/inspector-system §1
          </a>
          . The full entity model is in §3 of that study. The visual
          rendering of each block is the same across all four
          surfaces — the Comms specificity is the <em>composition
          order</em> and which blocks are conditional on Comms data.
        </p>

        <div className="overflow-hidden rounded-md border border-studio-edge">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="bg-studio-canvas-alt text-left text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Block</th>
                <th className="px-3 py-2">Reads from entity</th>
                <th className="px-3 py-2">Conditional?</th>
              </tr>
            </thead>
            <tbody>
              {COMPOSITION.map((row, i) => (
                <tr
                  key={row.block}
                  className={i % 2 === 0 ? "bg-studio-surface" : "bg-studio-canvas-alt"}
                >
                  <td className="px-3 py-2 font-mono text-[9.5px] text-studio-ink-faint">
                    {String(i + 1).padStart(2, "0")}
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={`/studies/inspector-system#${row.block}`}
                      className="text-studio-ink hover:underline"
                    >
                      {row.block}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-studio-ink-muted">{row.reads}</td>
                  <td className="px-3 py-2 text-studio-ink-muted">
                    {row.conditional ? "yes" : "no"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 max-w-prose font-sans text-[11.5px] leading-snug text-studio-ink-faint">
          The first three blocks (Identity, Action row, Conversation)
          are universal. Project is conditional — ~80% of DMs have an
          underlying project; the other 20% skip it. Ask is
          conditional — only renders when there's an active ask on the
          thread. This is what makes the same composition fit a quiet
          2-block inspector (Identity + Conversation) and a busy
          5-block inspector (Identity + Action + Conversation + Project
          + Ask) without code changes.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────
          §4 — Design decisions
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §4 · Design decisions
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Choices that don't follow mechanically from the inspector
          grammar or the other three surfaces.
        </p>

        <ol className="flex max-w-prose flex-col gap-4 font-sans text-[13px] leading-relaxed text-studio-ink">
          <Decision
            n="1"
            title="The primary action is 'Open', not 'Send' or 'Compose'."
            body="Agents and Repos both have a 'Message' primary action (the inspector is on an entity, not a thread). Comms is on a thread — the natural primary action is opening it. 'Send' / 'Compose' would imply writing a new message, which duplicates the list's existing + New button and the conversation view's composer."
          />
          <Decision
            n="2"
            title="Ask gets its own block, not a chip in the conversation section."
            body="Hudson and Scout · iOS pairing both have active Asks. The chip in the list is the *signal*; the inspector block is the *context* — who asked, what they asked, and the state (pending / answered). The chip and the block together answer 'why is this conversation highlighted?' without forcing the operator to open the thread."
          />
          <Decision
            n="3"
            title="Project is its own block, not collapsed into Conversation."
            body="DMs have an underlying project ~80% of the time (the agent is doing work in a repo). Surfacing branch + path in the inspector means 'I want to know what this conversation is about at a glance' doesn't require opening the thread. The other 20% (e.g. a personal chat with an agent) get no project block — the section is conditional on the data being present."
          />
          <Decision
            n="4"
            title="The status badge is 'Open', not 'AVAILABLE' or 'ATTENTION'."
            body="The other inspectors report the entity's state. Comms's entity is a *thread*, not an agent — 'available' doesn't apply. The most useful status is whether the thread is currently open in a pushed view ('Open') or not. This is a deviation from the other three surfaces, but it follows from the entity changing shape."
          />
        </ol>
      </section>

      {/* ────────────────────────────────────────────────────────────
          §5 — Open questions
          ──────────────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §5 · Open questions
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Comms-specific things this study raises but doesn't answer.
        </p>

        <ul className="flex max-w-prose flex-col gap-3 font-sans text-[13px] leading-relaxed text-studio-ink">
          <OQ q="Should Comms gain keyboard navigation to match the inspector pattern?">
            Agents and Repos are j/k/h/l navigable, with the inspector
            following the cursor. Comms has no keyboard nav today.
            Without it, the inspector's 'follows the selection' is just
            'follows the click'. Adding basic ↑↓ nav is a small change
            in <code>ScoutCommsView</code> and makes the inspector feel
            native to the rest of the app.
          </OQ>
          <OQ q="Does the inspector need a 'Last opened' or 'Open count' field?">
            Recurring conversations with the same agent (e.g. a daily
            standup with Preframe) might benefit from showing how
            recently the operator opened this thread — a sticky 'last
            opened 2h ago' line above the action row. Useful or noise?
          </OQ>
          <OQ q="What happens when the selected conversation is a channel, not a DM?">
            The projection assumes a DM. Channels have a different
            shape: multiple participants, a channel name not an agent
            name, no project. The inspector for a channel would
            probably surface participants + recent activity + pinned
            asks. Out of scope for this study, but worth a follow-up.
          </OQ>
        </ul>
      </section>

      <footer className="border-t border-studio-edge pt-4 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        Status · draft ·{" "}
        <span className="text-studio-ink-muted">ports to</span>{" "}
        ScoutCommsView + InspectorFrame (Swift)
      </footer>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */

function VariantCard({
  name,
  selected,
  mock,
  pros,
  cons,
  verdict,
}: {
  name: string;
  selected?: boolean;
  mock: React.ReactNode;
  pros: string[];
  cons: string[];
  verdict: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-scout-accent">
          {name}
        </div>
        {selected ? (
          <span className="rounded-[2px] bg-scout-accent-soft px-1 py-px font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-scout-accent">
            Selected
          </span>
        ) : null}
      </div>
      {mock}
      <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-3 font-sans text-[11px] leading-snug text-studio-ink">
        <div className="mb-1.5">
          <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-status-ok-fg">
            Pros
          </div>
          <ul className="mt-1 flex flex-col gap-0.5 text-studio-ink-faint">
            {pros.map((p, i) => (
              <li key={i}>· {p}</li>
            ))}
          </ul>
        </div>
        <div className="mb-1.5 mt-2">
          <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-status-warn-fg">
            Cons
          </div>
          <ul className="mt-1 flex flex-col gap-0.5 text-studio-ink-faint">
            {cons.map((c, i) => (
              <li key={i}>· {c}</li>
            ))}
          </ul>
        </div>
        <div className="mt-2 border-t border-studio-edge pt-2">
          <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink">
            Verdict
          </div>
          <div className="mt-0.5 text-studio-ink">{verdict}</div>
        </div>
      </div>
    </div>
  );
}

function Decision({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border border-studio-edge bg-studio-canvas-alt font-mono text-[10px] font-semibold text-studio-ink">
        {n}
      </span>
      <div>
        <div className="font-medium text-studio-ink">{title}</div>
        <div className="mt-0.5 text-studio-ink-faint">{body}</div>
      </div>
    </li>
  );
}

function OQ({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <li className="rounded-md border border-studio-edge bg-studio-canvas-alt p-3">
      <div className="font-medium text-studio-ink">{q}</div>
      <div className="mt-1 text-studio-ink-faint">{children}</div>
    </li>
  );
}

const COMPOSITION: {
  block: string;
  reads: string;
  conditional: boolean;
}[] = [
  { block: "identity",     reads: "name, agentId, avatar",    conditional: false },
  { block: "action-row",   reads: "actions[primary, secondary]", conditional: true },
  { block: "conversation", reads: "conversation.last, conversation.unread, conversation.kind", conditional: false },
  { block: "project",      reads: "project.repo, project.branch, project.path", conditional: true },
  { block: "ask",          reads: "ask.state, ask.from, ask.text", conditional: true },
];
