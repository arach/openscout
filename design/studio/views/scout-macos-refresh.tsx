/**
 * Scout macOS · Refresh — the consolidated macOS direction coming out of the
 * design review (docs/agent/studio-levelup-brief.md). Where the focused studies
 * each own one surface, this study is the *decision artifact*: one projection of
 * the refreshed Comms window with the inspector wired in, plus a ledger that
 * itemises every change against its macOS symbol and whether it ships, refines,
 * or is net-new.
 *
 * It pulls the five surface areas from the brief into a single inspectable view:
 *   1. Inspector grammar      — the signed-off Section/KV kit (source of truth:
 *                               /studies/scout-inspectors), applied to the
 *                               channel inspector.
 *   2. Comms ask context      — the [ask:<flightId>] reply-context backlink and
 *                               the pinned originating-ask band behaviour.
 *   3. Channel inspector      — Conversation / Project / Ask blocks.
 *   4. Recency / list         — Now / Today / Earlier groups + the ask chip
 *                               (already shipped; shown for coherence).
 *   5. Shell / header         — nav rail active state, the 2px accent selection
 *                               rule, and the thread header sub-line + actions.
 *
 * Visual idiom follows /studies/scout-comms-inspector (Tailwind + studio/scout
 * tokens, self-rolled macOS chrome). The grammar links point at
 * /studies/scout-inspectors — the real inspector reference — not the phantom
 * /studies/inspector-system + /studies/inspector-grammar the older study cites.
 *
 * Static reference only — no app code lives here. Status: draft.
 */

import { EyebrowLabel } from "@/components/EyebrowLabel";

/* ────────────────────────────────────────────────────────────────────
   Mock data — the Conversation shape mirrors ScoutChannel; the extra
   fields the inspector + ask context read are marked NEW.
   ──────────────────────────────────────────────────────────────────── */

type Group = "now" | "today" | "earlier";
type AskState = "pending" | "answered" | null;

type Conversation = {
  cId: string;
  name: string;
  agentId: string;
  avatar: string;
  channel?: boolean;
  ask: AskState;
  preview: string;
  time: string;
  unread: boolean;
  unreadCount: number;
  selected?: boolean;
  group: Group;
  project?: { name: string; branch: string; path: string };
  // Ask — NEW (feeds the pinned band + the inspector Ask block)
  askDetail?: { id: string; from: string; text: string };
};

const CONVERSATIONS: Conversation[] = [
  {
    cId: "ab3fd029",
    name: "Talkie",
    agentId: "talkie.main.arts-mac-mini-local",
    avatar: "T",
    ask: "pending",
    preview: "On it — moving resolveStartupTheme() ahead of the composer mount.",
    time: "2m",
    unread: true,
    unreadCount: 2,
    selected: true,
    group: "now",
    project: { name: "talkie", branch: "master", path: "~/dev/talkie" },
    askDetail: {
      id: "ask:f-mq8ubzy0-8qm0",
      from: "Art",
      text: "Review AgentHomeShellView — should overlay settings render before send, or stay deferred? Flag any perf traps while you're in there.",
    },
  },
  {
    cId: "90a1c2d4",
    name: "premotion",
    agentId: "premotion.arts-mac-mini-local",
    avatar: "P",
    ask: "pending",
    preview: "Can you confirm the app-scoped-design note lands before the v0-2 cut?",
    time: "8m",
    unread: true,
    unreadCount: 1,
    group: "now",
    project: { name: "premotion", branch: "main", path: "~/dev/premotion" },
  },
  {
    cId: "a4d433a9",
    name: "Dewey",
    agentId: "dewey.main.arts-mac-mini-local",
    avatar: "D",
    ask: "answered",
    preview: "Done — the inspector renders the resolved skin badge.",
    time: "22m",
    unread: false,
    unreadCount: 0,
    group: "today",
    project: { name: "dewey", branch: "main", path: "~/dev/dewey" },
  },
  {
    cId: "8006703b",
    name: "Hudson",
    agentId: "hudson.arts-mac-mini-local",
    avatar: "H",
    ask: null,
    preview: "Reviewed. talkie-overlay-settings polished — moved the no-fly list inline.",
    time: "2h",
    unread: false,
    unreadCount: 0,
    group: "today",
    project: { name: "hudson", branch: "main", path: "~/dev/hudson" },
  },
  {
    cId: "5215a166",
    name: "Lattices",
    agentId: "lattices.arts-mac-mini-local",
    avatar: "L",
    ask: null,
    preview: "Rebased main onto origin — 2 ahead, clean.",
    time: "1d",
    unread: false,
    unreadCount: 0,
    group: "earlier",
    project: { name: "lattices", branch: "main", path: "~/dev/lattices" },
  },
];

type ReplyContext = { title: string; from: string; status: "working" | "done" };

type Turn = {
  me: boolean;
  author: string;
  avatar: string;
  time: string;
  body: string;
  // NEW — resolved from the raw [ask:<flightId>] tag the agent echoes
  replyContext?: ReplyContext;
  card?: { head: string; body: string };
};

const MESSAGES: Turn[] = [
  {
    me: false,
    author: "Talkie",
    avatar: "T",
    time: "2:15 PM",
    replyContext: { title: "inspector theme badge: surface resolved skin?", from: "Art", status: "done" },
    body: "Three changes, highest-impact first: make Library a full-height pane (drop the nested ScrollView), rebuild Overview around now not inventory, and kill the date-parse hot path in the sort comparators. Items 1–2 are view-layer; 3 is store-layer.",
  },
  {
    me: true,
    author: "Art",
    avatar: "A",
    time: "2:17 PM",
    body: "Great breakdown. Take both — and surface the active theme in the inspector while you're in the view layer, so I can see which skin a session opened with.",
  },
  {
    me: false,
    author: "Talkie",
    avatar: "T",
    time: "2:18 PM",
    body: "On it. Moved resolveStartupTheme() ahead of the composer mount, and the inspector now shows the resolved skin badge. Pushed to master.",
    card: {
      head: "Talkie/AgentHomeShellView.swift",
      body: "Applies overlay settings on appear, before the first send — no skin flash on cold open.",
    },
  },
];

/* ────────────────────────────────────────────────────────────────────
   Window chrome — same shell as /studies/scout-macos-shell.
   ──────────────────────────────────────────────────────────────────── */

type ActiveSection = "comms";

function MacOSWindow({
  active,
  children,
  height = 560,
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
      <StatusBar />
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
      <span className="ml-2 font-mono text-[9.5px] text-studio-ink-faint">scout · comms</span>
    </div>
  );
}

const NAV_ITEMS: { id: ActiveSection | "agents" | "tail" | "repos"; label: string; icon: React.ReactNode }[] = [
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

function StatusBar() {
  return (
    <div
      className="flex h-[22px] flex-none items-center gap-2 border-t border-studio-edge px-3 font-mono text-[9px] uppercase tracking-eyebrow"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-ok-fg" />
      <span className="text-studio-ink-muted">Comms · 5 chats · 2 need you</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Comms list — fixed-width column. Recency groups, ask chip, unread,
   the 2px accent selection rule. (Shipped on macOS; shown for coherence.)
   ──────────────────────────────────────────────────────────────────── */

function CommsList({ selectedCid }: { selectedCid: string }) {
  const groups: Group[] = ["now", "today", "earlier"];
  const groupLabels: Record<Group, string> = { now: "NOW", today: "TODAY", earlier: "EARLIER" };
  return (
    <div className="flex w-[228px] flex-none flex-col border-r border-studio-edge">
      <div className="flex flex-none items-center justify-between border-b border-studio-edge px-3 py-2">
        <span className="font-sans text-[12px] font-semibold tracking-tight text-studio-ink">Chats</span>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-ok-fg" />
      </div>
      <div className="flex flex-none items-center gap-1.5 border-b border-studio-edge px-3 py-2">
        {["All", "Direct", "Shared"].map((f, i) => (
          <span
            key={f}
            className={[
              "rounded-[3px] px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow",
              i === 0 ? "bg-studio-surface text-studio-ink" : "text-studio-ink-faint",
            ].join(" ")}
          >
            {f}
          </span>
        ))}
      </div>
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
                      <span
                        className={[
                          "truncate font-sans text-[11px] text-studio-ink",
                          c.unread ? "font-bold" : "font-semibold",
                        ].join(" ")}
                      >
                        {c.name}
                      </span>
                      <span className="font-mono text-[8.5px] text-studio-ink-faint">{c.time}</span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="line-clamp-1 font-sans text-[9.5px] text-studio-ink-faint">{c.preview}</span>
                      {c.unread && c.unreadCount > 0 ? (
                        <span className="ml-auto shrink-0 rounded-full bg-status-info-fg px-1 font-mono text-[7.5px] font-semibold text-studio-canvas">
                          {c.unreadCount}
                        </span>
                      ) : null}
                    </div>
                    {c.ask === "pending" ? (
                      <span className="self-start rounded-[2px] bg-status-warn-bg px-1 py-px font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-status-warn-fg">
                        ASK pending
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
   Thread — center column. Header sub-line + actions, the pinned
   originating-ask band, turns with the reply-context backlink.
   ──────────────────────────────────────────────────────────────────── */

function Thread({ conversation }: { conversation: Conversation }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* header — name + sub-line (repo · branch · path · cId) + actions */}
      <div className="flex flex-none items-center gap-2 border-b border-studio-edge px-3 py-2">
        <div className="grid h-[26px] w-[26px] place-items-center rounded-full bg-studio-canvas-alt font-mono text-[11px] text-studio-ink">
          {conversation.avatar}
        </div>
        <div className="min-w-0">
          <div className="truncate font-sans text-[13px] font-semibold tracking-tight text-studio-ink">
            {conversation.name}
          </div>
          <div className="truncate font-mono text-[8.5px] text-studio-ink-faint">
            {conversation.project?.name} · {conversation.project?.branch} · {conversation.project?.path} · c.{conversation.cId}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-[5px] border border-studio-edge bg-transparent px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted"
          >
            <EyeGlyph /> Observe
          </button>
          <button
            type="button"
            className="rounded-[5px] border px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-eyebrow"
            style={{ background: "var(--scout-accent-soft)", borderColor: "var(--scout-accent)", color: "var(--scout-accent)" }}
          >
            Message
          </button>
        </div>
      </div>

      {/* pinned originating ask band */}
      {conversation.askDetail ? <PinnedAskBand conversation={conversation} /> : null}

      {/* turns */}
      <div className="flex-1 space-y-3 overflow-hidden px-3 py-3">
        {MESSAGES.map((m, i) => (
          <TurnRow key={i} turn={m} />
        ))}
      </div>
    </div>
  );
}

function PinnedAskBand({ conversation }: { conversation: Conversation }) {
  const pending = conversation.ask === "pending";
  return (
    <div
      className="flex flex-none flex-col gap-1 px-3 py-2"
      style={{
        background: pending ? "var(--status-warn-bg)" : "var(--status-ok-bg)",
        boxShadow: `inset 2px 0 0 ${pending ? "var(--status-warn-fg)" : "var(--status-ok-fg)"}`,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span style={{ color: pending ? "var(--status-warn-fg)" : "var(--status-ok-fg)" }}>
          <PinGlyph />
        </span>
        <span
          className="font-mono text-[8px] font-semibold uppercase tracking-eyebrow"
          style={{ color: pending ? "var(--status-warn-fg)" : "var(--status-ok-fg)" }}
        >
          Pinned ask · {pending ? "Awaiting reply" : "Answered"}
        </span>
        <span className="font-mono text-[8px] text-studio-ink-faint">from {conversation.askDetail?.from}</span>
      </div>
      <div className="font-sans text-[10.5px] leading-snug text-studio-ink-muted">{conversation.askDetail?.text}</div>
    </div>
  );
}

function TurnRow({ turn }: { turn: Turn }) {
  return (
    <div className="flex gap-2">
      <div
        className={[
          "grid h-[24px] w-[24px] flex-none place-items-center rounded-full font-mono text-[10px]",
          turn.me ? "text-studio-canvas" : "bg-studio-canvas-alt text-studio-ink",
        ].join(" ")}
        style={turn.me ? { background: "var(--scout-accent)" } : undefined}
      >
        {turn.avatar}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="font-sans text-[11px] font-semibold text-studio-ink">{turn.author}</span>
          <span className="font-mono text-[8.5px] text-studio-ink-faint">{turn.time}</span>
        </div>

        {/* reply-context backlink — resolved from the raw [ask:<flightId>] tag */}
        {turn.replyContext ? (
          <button
            type="button"
            className="group mt-1 flex max-w-full items-center gap-1.5 font-mono text-[9px] text-studio-ink-faint"
            title="Open the originating ask"
          >
            <ReplyGlyph />
            <span className="font-semibold uppercase tracking-eyebrow">reply to</span>
            <span className="truncate text-studio-ink-muted group-hover:text-scout-accent group-hover:underline">
              {turn.replyContext.title}
            </span>
            <span className="flex-none text-studio-ink-faint">· {turn.replyContext.from}</span>
            {turn.replyContext.status === "working" ? (
              <span className="flex-none" style={{ color: "var(--scout-accent)" }}>· working</span>
            ) : (
              <span className="flex-none text-studio-ink-faint">· done</span>
            )}
          </button>
        ) : null}

        <div className="mt-1 font-sans text-[10.5px] leading-relaxed text-studio-ink-muted">{turn.body}</div>

        {turn.card ? (
          <div className="mt-2 overflow-hidden rounded-[7px] border border-studio-edge bg-studio-surface">
            <div className="flex items-center gap-1.5 border-b border-studio-edge px-2.5 py-1.5 font-mono text-[9px] text-studio-ink">
              <FileGlyph /> {turn.card.head}
            </div>
            <div className="px-2.5 py-1.5 font-sans text-[9.5px] leading-snug text-studio-ink-faint">{turn.card.body}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Inspector — the channel inspector in the signed-off grammar
   (source of truth: /studies/scout-inspectors). Identity → Open action →
   Conversation → Project → Ask.
   ──────────────────────────────────────────────────────────────────── */

function Inspector({ conversation }: { conversation: Conversation }) {
  const askTone: "ok" | "warn" | "neutral" =
    conversation.ask === "pending" ? "warn" : conversation.ask === "answered" ? "ok" : "neutral";

  return (
    <div className="flex w-[260px] flex-none flex-col border-l border-studio-edge bg-studio-surface">
      <div className="flex items-center justify-between border-b border-studio-edge px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-0.5 rounded-sm bg-scout-accent" />
          <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">DM</span>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-eyebrow"
          style={{ background: "var(--status-ok-bg)", color: "var(--status-ok-fg)" }}
        >
          <span className="block h-1.5 w-1.5 rounded-full bg-current" />
          Open
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
        {/* identity */}
        <div className="flex items-center gap-2">
          <div className="grid h-[28px] w-[28px] place-items-center rounded-full bg-studio-canvas-alt font-mono text-[11px] text-studio-ink">
            {conversation.avatar}
          </div>
          <div className="min-w-0">
            <div className="truncate font-sans text-[14px] font-semibold leading-tight tracking-tight text-studio-ink">
              {conversation.name}
            </div>
            <div className="truncate font-mono text-[9.5px] text-studio-ink-faint">{conversation.agentId}</div>
          </div>
        </div>

        {/* action row — primary is "Open" (not Send) */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="rounded-[5px] border px-2.5 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow"
            style={{ background: "var(--scout-accent-soft)", borderColor: "var(--scout-accent)", color: "var(--scout-accent)" }}
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

        <ISec label="Conversation">
          <KV k="Last" v={conversation.time} />
          <KV
            k="Unread"
            v={String(conversation.unreadCount)}
            vColor={conversation.unread ? "var(--status-info-fg)" : undefined}
          />
          <KV k="Channel" v={conversation.channel ? "#" : "DM"} />
        </ISec>

        {conversation.project ? (
          <ISec label="Project">
            <KV k="Repo" v={conversation.project.name} />
            <KV k="Branch" v={conversation.project.branch} />
            <KV k="Path" v={conversation.project.path} />
          </ISec>
        ) : null}

        {conversation.ask ? (
          <ISec label="Ask" tone={askTone}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span
                  className="rounded-[2px] px-1 py-px font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow"
                  style={{ background: `var(--status-${askTone}-bg)`, color: `var(--status-${askTone}-fg)` }}
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
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">{label}</div>
      </div>
      {children}
    </div>
  );
}

function KV({ k, v, vColor }: { k: string; v: string; vColor?: string }) {
  return (
    <div className="grid grid-cols-[60px_1fr] items-baseline gap-x-2">
      <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">{k}</span>
      <span className="truncate text-right font-mono text-[10px]" style={{ color: vColor ?? "var(--studio-ink-muted)" }}>
        {v}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Refresh ledger — every change, mapped to its macOS symbol + status.
   ──────────────────────────────────────────────────────────────────── */

type Disposition = "ship" | "refine" | "new";

const DISPOSITION_STYLE: Record<Disposition, { label: string; bg: string; fg: string }> = {
  ship: { label: "Shipped", bg: "var(--status-ok-bg)", fg: "var(--status-ok-fg)" },
  refine: { label: "Refine", bg: "var(--status-info-bg)", fg: "var(--status-info-fg)" },
  new: { label: "New", bg: "var(--status-warn-bg)", fg: "var(--status-warn-fg)" },
};

function Tag({ kind }: { kind: Disposition }) {
  const s = DISPOSITION_STYLE[kind];
  return (
    <span
      className="inline-block rounded-[2px] px-1 py-px font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

const LEDGER: { area: string; change: string; kind: Disposition; symbol: string }[] = [
  {
    area: "Inspector grammar",
    change: "Adopt the signed-off Section/KV kit across inspectors so the channel inspector reads like Agents/Repos.",
    kind: "refine",
    symbol: "ScoutChannelInspector · ScoutInspectorKVRow (ScoutRootView.swift)",
  },
  {
    area: "Reply-context backlink",
    change: "Resolve the raw [ask:<flightId>] tag into a backlink (reply to · title · from · status); strip the token from prose.",
    kind: "new",
    symbol: "ScoutMessageRow.custodyLabel (ScoutCommsView.swift ~1220)",
  },
  {
    area: "Channel inspector blocks",
    change: "Give the channel inspector its own Conversation / Project / Ask blocks instead of scope + members only.",
    kind: "new",
    symbol: "ScoutChannelInspector (ScoutRootView.swift ~5425)",
  },
  {
    area: "Pinned-ask behavior",
    change: "Band pins the originating ask; list-row chip + inspector Ask block mirror the same answered/pending state.",
    kind: "refine",
    symbol: "ScoutPinnedAskBand (ScoutRootView.swift)",
  },
  {
    area: "Thread header",
    change: "Header gains the repo · branch · path · cId sub-line and Observe / Message actions (today it is handle-only).",
    kind: "new",
    symbol: "chatHeader (ScoutRootView.swift ~1106)",
  },
  {
    area: "Recency / list",
    change: "Now / Today / Earlier groups, pending-ask chip, unread emphasis, 2px accent selection rule.",
    kind: "ship",
    symbol: "ScoutConversationListBar · ScoutConversationRow (ScoutCommsView.swift)",
  },
];

function RefreshLedger() {
  return (
    <div className="overflow-hidden rounded-[8px] border border-studio-edge">
      <div className="grid grid-cols-[150px_1fr_70px] gap-x-3 border-b border-studio-edge bg-studio-canvas-alt px-3 py-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        <span>Area</span>
        <span>Change · macOS symbol</span>
        <span className="text-right">Status</span>
      </div>
      {LEDGER.map((row, i) => (
        <div
          key={row.area}
          className={[
            "grid grid-cols-[150px_1fr_70px] items-start gap-x-3 px-3 py-2",
            i > 0 ? "border-t border-studio-edge" : "",
          ].join(" ")}
        >
          <span className="font-sans text-[11px] font-semibold text-studio-ink">{row.area}</span>
          <span className="flex flex-col gap-0.5">
            <span className="font-sans text-[10.5px] leading-snug text-studio-ink-muted">{row.change}</span>
            <span className="font-mono text-[8.5px] text-studio-ink-faint">{row.symbol}</span>
          </span>
          <span className="text-right">
            <Tag kind={row.kind} />
          </span>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Glyphs
   ──────────────────────────────────────────────────────────────────── */

function navBubble() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 3.5h11v8h-7l-3 2.5v-2.5h-1v-8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
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
      <path d="M1 8h2.5l1.5-4 2.5 8 1.5-5 1.5 2H15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
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
function ReplyGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}
function PinGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 17v5" />
      <path d="M9 10.76 5.5 14h13L15 10.76V4h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1z" />
    </svg>
  );
}
function EyeGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}
function FileGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────── */

export default function ScoutMacosRefreshPage() {
  const focus = CONVERSATIONS.find((c) => c.cId === "ab3fd029")!;

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-10 max-w-prose">
        <EyebrowLabel size="sm">· studies · macos · refresh</EyebrowLabel>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Scout macOS · Refresh
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The consolidated macOS direction from the design review. One projection
          of the refreshed Comms window — list · thread · inspector — that lands
          the ask-context story end to end and adopts the signed-off inspector
          grammar from{" "}
          <a href="/studies/scout-inspectors" className="text-scout-accent hover:underline">
            /studies/scout-inspectors
          </a>
          . The ledger below maps every change to its macOS symbol and whether it
          ships today, refines, or is net-new. Reference only — the per-surface
          specs stay in{" "}
          <a href="/studies/scout-comms" className="text-scout-accent hover:underline">
            /studies/scout-comms
          </a>{" "}
          and{" "}
          <a href="/studies/scout-comms-inspector" className="text-scout-accent hover:underline">
            /studies/scout-comms-inspector
          </a>
          .
        </p>
      </header>

      {/* §1 — The projection */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">§1 · The projection</h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The full three-pane Comms surface. The list keeps its recency groups and
          ask chip; the thread gains the repo sub-line + actions, the pinned
          originating-ask band, and the reply-context backlink on the turn that
          answers a prior ask; the inspector composes Identity → Open → Conversation
          → Project → Ask in the signed-off grammar.
        </p>
        <MacOSWindow active="comms">
          <CommsList selectedCid={focus.cId} />
          <Thread conversation={focus} />
          <Inspector conversation={focus} />
        </MacOSWindow>
      </section>

      {/* §2 — Ask context, in close-up */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">§2 · Ask context, end to end</h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          One ask, four coherent affordances. The raw correlation token never
          reaches the prose; it becomes the backlink. The pinned band, the list
          chip, and the inspector Ask block all read the same state.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {/* before / after backlink */}
          <div className="flex flex-col gap-3 rounded-[8px] border border-studio-edge p-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                Reply-context backlink
              </span>
              <Tag kind="new" />
            </div>
            <div className="rounded-[6px] border border-dashed border-studio-edge bg-studio-canvas-alt px-3 py-2">
              <div className="mb-1 font-mono text-[8px] uppercase tracking-eyebrow text-studio-ink-faint">Today (leaks)</div>
              <div className="font-mono text-[10px] text-studio-ink-muted">
                <span className="rounded-[2px] bg-status-warn-bg px-1 text-status-warn-fg">[ask:f-mq8ubzy0-8qm0]</span>{" "}
                Three changes, highest-impact first…
              </div>
            </div>
            <div className="rounded-[6px] border border-studio-edge bg-studio-surface px-3 py-2">
              <div className="mb-1 font-mono text-[8px] uppercase tracking-eyebrow text-studio-ink-faint">Refresh (lifted)</div>
              <div className="group flex max-w-full items-center gap-1.5 font-mono text-[9px] text-studio-ink-faint">
                <ReplyGlyph />
                <span className="font-semibold uppercase tracking-eyebrow">reply to</span>
                <span className="truncate text-studio-ink-muted group-hover:text-scout-accent">inspector theme badge</span>
                <span className="flex-none">· Art</span>
                <span className="flex-none">· done</span>
              </div>
              <div className="mt-1 font-sans text-[10px] text-studio-ink-muted">Three changes, highest-impact first…</div>
            </div>
          </div>

          {/* pinned band */}
          <div className="flex flex-col gap-3 rounded-[8px] border border-studio-edge p-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                Pinned originating ask
              </span>
              <Tag kind="refine" />
            </div>
            <PinnedAskBand conversation={focus} />
            <p className="font-sans text-[10.5px] leading-snug text-studio-ink-faint">
              The band pins while the ask awaits a reply and mirrors the list-row
              chip + the inspector Ask block. Once answered it tones to the ok
              color; the answering turn carries the reply-context backlink.
            </p>
          </div>
        </div>
      </section>

      {/* §3 — Refresh ledger */}
      <section className="mb-8">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">§3 · Refresh ledger</h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          What ships today, what refines an existing surface, and what is net-new
          — each mapped to the macOS symbol an implementer would touch.
        </p>
        <RefreshLedger />
      </section>
    </main>
  );
}
