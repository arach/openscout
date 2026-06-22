"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ScoutPageHeader } from "@/components/scout/ScoutSurface";
import styles from "./scout-shell.module.css";

/**
 * Scout — Design System.
 *
 * One semantic token set (`--s-*`, the exact sRGB of native `ScoutThemeColors`)
 * rendered across the real app skins, then the full shell rebuilt from those
 * tokens: every nav surface — Comms, Agents, Repos, Tail, Settings — as a
 * window mockup. The default skin (Juniper · Light, indigo accent) is the
 * live app theme today, so what reads here is what ships.
 */

const SKINS = [
  { id: "juniper-l", label: "Juniper", tone: "Light", current: true },
  { id: "juniper-d", label: "Juniper", tone: "Dark", current: false },
  { id: "graphite", label: "Graphite", tone: "Dark", current: false },
] as const;

type SkinId = (typeof SKINS)[number]["id"];

const TOKENS: { name: string; role: string }[] = [
  { name: "--s-bg", role: "Canvas" },
  { name: "--s-chrome", role: "Nav / rail" },
  { name: "--s-surface", role: "Card / raised" },
  { name: "--s-ink", role: "Primary text" },
  { name: "--s-muted", role: "Secondary text" },
  { name: "--s-dim", role: "Tertiary text" },
  { name: "--s-border", role: "Border" },
  { name: "--s-hairline-strong", role: "Strong rule" },
  { name: "--s-accent", role: "Accent" },
  { name: "--s-accent-soft", role: "Accent fill" },
  { name: "--s-ok", role: "Status · ok" },
  { name: "--s-warn", role: "Status · warn" },
  { name: "--s-error", role: "Status · error" },
  { name: "--s-info", role: "Status · info" },
];

/* ── Repos data ─────────────────────────────────────────────────────── */

type Worktree = {
  prefix?: string;
  branch: string;
  add: number;
  del: number;
  files: number;
  ahead: number;
  behind: number;
  agents?: { live?: boolean; handle: string }[];
  touched: string;
  tag?: string;
  selected?: boolean;
};
type Repo = {
  name: string;
  path: string;
  worktrees: number;
  tone: "accent" | "warn" | "error" | "dim";
  trees: Worktree[];
};

const REPOS: Repo[] = [
  {
    name: "lattices",
    path: "~/dev/lattices",
    worktrees: 1,
    tone: "warn",
    trees: [
      {
        branch: "main",
        add: 13,
        del: 0,
        files: 1,
        ahead: 2,
        behind: 0,
        agents: [{ live: true, handle: "@lattices" }],
        touched: "2m",
      },
    ],
  },
  {
    name: "talkie",
    path: "~/dev/talkie",
    worktrees: 3,
    tone: "error",
    trees: [
      {
        branch: "master",
        add: 1349,
        del: 1169,
        files: 60,
        ahead: 4,
        behind: 1,
        agents: [{ live: true, handle: "@talkie" }],
        touched: "1m",
        selected: true,
      },
      {
        prefix: "codex/",
        branch: "screenshot-cursors",
        add: 48,
        del: 12,
        files: 6,
        ahead: 0,
        behind: 3,
        touched: "18m",
        tag: "LOCAL",
      },
    ],
  },
  {
    name: "hudson",
    path: "~/dev/hudson",
    worktrees: 2,
    tone: "accent",
    trees: [
      {
        prefix: "feat/",
        branch: "hud-markdown-renderer",
        add: 92,
        del: 18,
        files: 5,
        ahead: 7,
        behind: 0,
        agents: [
          { live: true, handle: "@hudson" },
          { handle: "@sprek" },
        ],
        touched: "6m",
      },
      { branch: "main", add: 0, del: 0, files: 0, ahead: 0, behind: 0, touched: "3h" },
    ],
  },
  {
    name: "openscout",
    path: "~/dev/openscout",
    worktrees: 2,
    tone: "accent",
    trees: [
      {
        prefix: "feat/",
        branch: "repo-watch-web-converge",
        add: 1108,
        del: 231,
        files: 27,
        ahead: 5,
        behind: 0,
        agents: [{ live: true, handle: "@scout" }, { handle: "@codex" }],
        touched: "just now",
      },
    ],
  },
];

const DIFF_FILES: { glyph: "M" | "A" | "D"; name: string; add: number; del: number; active?: boolean }[] = [
  { glyph: "M", name: "Sources/Talkie/AgentHomeShellView.swift", add: 38, del: 12, active: true },
  { glyph: "M", name: "Sources/Talkie/AgentHomeActivityStore.swift", add: 64, del: 9 },
  { glyph: "A", name: "Sources/Talkie/OverlaySettingsView.swift", add: 121, del: 0 },
  { glyph: "M", name: "Sources/Talkie/ComposerView.swift", add: 27, del: 44 },
  { glyph: "D", name: "Sources/Talkie/LegacyThemeBridge.swift", add: 0, del: 86 },
];

const HUNK: { no: string; kind: "ctx" | "add" | "del"; text: string }[] = [
  { no: "82", kind: "ctx", text: "  func body(in scope: AgentScope) -> some View {" },
  { no: "83", kind: "del", text: "    let theme = resolveStartupTheme(deferred: true)" },
  { no: "83", kind: "add", text: "    let theme = resolveStartupTheme()      // before first send" },
  { no: "84", kind: "add", text: "    overlaySettings.apply(theme)" },
  { no: "85", kind: "ctx", text: "    return ComposerView(theme: theme)" },
  { no: "86", kind: "ctx", text: "      .environment(\\.scoutTheme, theme)" },
];

/* ── Conversations data ─────────────────────────────────────────────── */

type ConvGroup = "now" | "today" | "earlier";
type Conversation = {
  name: string;
  avatar: string;
  channel?: boolean;
  askState?: "answered" | "pending";
  preview: string;
  cId: string;
  time: string;
  count?: number;
  unread?: boolean;
  selected?: boolean;
  group: ConvGroup;
};

/* Grouped by recency (improvement #3) — a flat 50-row scroll becomes
   Now / Today / Earlier, with unread emphasis and an `answered/pending`
   chip on ask threads. The cId is demoted to the selected row only. */
const CONV_GROUPS: { id: ConvGroup; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "today", label: "Today" },
  { id: "earlier", label: "Earlier" },
];

const CONVERSATIONS: Conversation[] = [
  {
    name: "Talkie",
    avatar: "T",
    askState: "answered",
    preview: "Render before send — moved resolveStartupTheme() ahead of the composer mount; no skin flash on cold open.",
    cId: "ab3fd029",
    time: "2m",
    count: 6,
    unread: true,
    selected: true,
    group: "now",
  },
  {
    name: "Art",
    avatar: "A",
    askState: "answered",
    preview: "Done — the inspector renders Talkie's own library presentation with the resolved skin badge.",
    cId: "a4d433a9",
    time: "12m",
    count: 2,
    unread: true,
    group: "now",
  },
  {
    name: "openscout",
    avatar: "#",
    channel: true,
    preview: "feat/repo-watch — themeVars bridge landed; the embed now adopts the app palette.",
    cId: "fb44d2ee",
    time: "1h",
    count: 4,
    group: "today",
  },
  {
    name: "Hudson",
    avatar: "H",
    askState: "answered",
    preview: "Reviewed. talkie-overlay-settings polished — moved the no-fly list inline.",
    cId: "8006703b",
    time: "2h",
    count: 1,
    group: "today",
  },
  {
    name: "premotion",
    avatar: "P",
    askState: "pending",
    preview: "Can you confirm the app-scoped-design note lands before the v0-2 cut?",
    cId: "90a1c2d4",
    time: "3h",
    count: 2,
    group: "today",
  },
  {
    name: "scoutbot",
    avatar: "S",
    preview: "Daily digest — 4 repos dirty, 2 agents live, 14 worktrees across the fleet.",
    cId: "71d0ee20",
    time: "5h",
    count: 1,
    group: "earlier",
  },
  {
    name: "openscout-feature-flags",
    avatar: "#",
    channel: true,
    preview: "@hudson — does a single-@ mention route any differently in-channel than a DM?",
    cId: "6fdde021",
    time: "1d",
    count: 4,
    group: "earlier",
  },
  {
    name: "Lattices",
    avatar: "L",
    preview: "Rebased main onto origin — 2 ahead, clean. Ready for the lattice-snap pass.",
    cId: "5215a166",
    time: "1d",
    count: 3,
    group: "earlier",
  },
];

/* The originating request, pinned above the stream (improvement #2) so the
   long answer below always has its context + resolution state on screen. */
const ASK = {
  id: "ask:f-mq8ubzy0-8qm0",
  from: "Art",
  state: "answered" as "answered" | "pending",
  text: "Review AgentHomeShellView / AgentHomeActivityStore — should overlay settings render before send, or stay deferred? Flag any perf traps while you're in there.",
};

type Message = {
  me: boolean;
  author: string;
  time: string;
  long?: boolean;
  html: string;
  card?: { head: string; body: string };
};

const MESSAGES: Message[] = [
  {
    me: false,
    author: "Talkie",
    time: "2:15 PM",
    long: true,
    html: `<p>Three changes, highest-impact first:</p>
<ol>
<li><strong>Make Library a full-height, first-class pane.</strong> Today <code>ScopeLibraryList</code> nests its own ScrollView inside a fixed <code>.frame(height: 460)</code> inside the scaffold's ScrollView — a double scroll with a clipped value. Drop the wrapper and let the list fill the content area edge-to-edge.</li>
<li><strong>Rebuild Overview around <em>now</em>, not inventory.</strong> The hero copy and quick routes replay the same data forever. Replace them with active work (running / waiting jobs, live status), the latest completed turn with a Continue affordance, and a health strip that only surfaces when something's degraded.</li>
<li><strong>Kill the date-parse hot path.</strong> <code>createdDate</code> / <code>updatedDate</code> allocate a fresh <code>ISO8601DateFormatter</code> on every call — and they're called inside the sort comparators, so it's O(n log n) allocations per 5s tick. Parse once at init into stored <code>Date</code> fields, or use one cached static formatter.</li>
</ol>
<p><strong>High-risk performance traps (ranked)</strong></p>
<ul>
<li>ISO8601Formatter-per-call inside sorts / grouping — the worst CPU offender; scales with job count × refresh cadence.</li>
<li>Unbounded library <code>ValueObservation</code> full-table decode on every write — give it a limit + load-more.</li>
<li>Guaranteed re-render cadence: a 5s store tick and a 3s shell tick re-render on a timer even when nothing changed.</li>
</ul>
<p>Items 1–2 are view-layer (<code>AgentHomeShellView</code>); 3–5 are store-layer (<code>AgentHomeActivityStore</code>). Happy to take either.</p>`,
  },
  {
    me: true,
    author: "Art",
    time: "2:17 PM",
    html: "Great breakdown. Take both — and surface the active theme in the inspector while you're in the view layer, so I can see which skin a session opened with.",
  },
  {
    me: false,
    author: "Talkie",
    time: "2:18 PM",
    html: "On it. Moved <code>resolveStartupTheme()</code> ahead of the composer mount, and the inspector now shows the resolved skin badge. Pushed to <code>master</code>.",
    card: {
      head: "Talkie/AgentHomeShellView.swift",
      body: "Applies overlay settings on appear, before the first send — no skin flash on cold open.",
    },
  },
];

/* ── Agents data ────────────────────────────────────────────────────── */

type AgentRowT = {
  name: string;
  meta: string;
  state: string;
  updated: string;
  live?: boolean;
  expandable?: boolean;
  selected?: boolean;
};
type AgentGroupT = { project: string; path: string; count: number; agents: AgentRowT[] };

const AGENT_GROUPS: AgentGroupT[] = [
  {
    project: "Hudson",
    path: "~/dev/hudson",
    count: 4,
    agents: [
      { name: "Grok Hudson", meta: "Relay agent · pi · pi_rpc", state: "AVAILABLE", updated: "1d", live: true, expandable: true },
      { name: "Hudson", meta: "Relay agent · claude · claude_stream_json", state: "AVAILABLE", updated: "1d", live: true },
    ],
  },
  {
    project: "Lattices",
    path: "~/dev/lattices",
    count: 1,
    agents: [
      { name: "Lattices", meta: "Relay agent · claude · claude_stream_json", state: "AVAILABLE", updated: "1d", live: true },
    ],
  },
  {
    project: "Openscout",
    path: "~/dev/openscout",
    count: 8,
    agents: [
      { name: "Claude", meta: "Relay agent · claude · tmux", state: "AVAILABLE", updated: "15h 12m", live: true, expandable: true },
      { name: "Openscout", meta: "Relay agent · codex · codex_app_server", state: "AVAILABLE", updated: "22h 33m", live: true },
      { name: "Scout", meta: "operator-assistant · codex · codex_app_server", state: "AVAILABLE", updated: "14h 38m", live: true, expandable: true },
    ],
  },
  {
    project: "talkie",
    path: "~/dev/talkie",
    count: 1,
    agents: [
      { name: "Talkie", meta: "Relay agent · claude · tmux", state: "AVAILABLE", updated: "13h 6m", live: true, selected: true, expandable: true },
    ],
  },
];

/* ── Tail data ──────────────────────────────────────────────────────── */

type Kind = "msg" | "tool" | "session" | "diff" | "error";
const TAIL: { t: string; src: string; kind: Kind; label: string; html: string }[] = [
  { t: "14:21:08", src: "@talkie", kind: "msg", label: "Msg", html: "render overlay settings before the first send — no skin flash" },
  { t: "14:21:03", src: "@scout", kind: "diff", label: "Diff", html: "<code>feat/repo-watch-web-converge</code> +1,108 −231 · 27 files" },
  { t: "14:20:55", src: "@hudson", kind: "tool", label: "Tool", html: "Read <code>HudNavigationSidebar.swift</code> · 412 lines" },
  { t: "14:20:51", src: "@codex", kind: "session", label: "Session", html: "<code>relay-openscout-codex</code> started · tmux" },
  { t: "14:20:44", src: "@talkie", kind: "tool", label: "Tool", html: "Edit <code>AgentHomeShellView.swift</code> · +4 −1" },
  { t: "14:20:40", src: "@talkie", kind: "error", label: "Error", html: "swift build: HudsonVoice gated by <code>HUDSONKIT_WITH_VOICE=1</code>" },
  { t: "14:20:31", src: "@lattices", kind: "msg", label: "Msg", html: "rebased main onto origin — 2 ahead, clean" },
  { t: "14:20:22", src: "@scout", kind: "session", label: "Session", html: "<code>relay-openscout-claude</code> idle → active" },
  { t: "14:20:09", src: "@hudson", kind: "diff", label: "Diff", html: "<code>feat/hud-markdown-renderer</code> +92 −18 · 5 files" },
];

/* ── Settings data ──────────────────────────────────────────────────── */

const PRESETS: { name: string; tone: string; bg: string; chrome: string; accent: string; active?: boolean }[] = [
  { name: "Paper", tone: "Light", bg: "#fafafb", chrome: "#f1f2f4", accent: "#4954c4" },
  { name: "Mist", tone: "Light", bg: "#f5f7fa", chrome: "#e9edf2", accent: "#4954c4" },
  { name: "Graphite", tone: "Soft dark", bg: "#141416", chrome: "#0e0e10", accent: "#5e6ad2" },
  { name: "Nocturne", tone: "Soft dark", bg: "#12151a", chrome: "#0b0e13", accent: "#5e6ad2", active: true },
];

const ACCENTS: { name: string; color: string; active?: boolean }[] = [
  { name: "Indigo", color: "#4954c4", active: true },
  { name: "Forest", color: "#387a57" },
  { name: "Cyan", color: "#007d87" },
  { name: "Amber", color: "#bf6917" },
  { name: "Rose", color: "#b34a61" },
];

/* ════════════════════════════════════════════════════════════════════ */

export default function ScoutShellPage() {
  const [skin, setSkin] = useState<SkinId>("juniper-l");

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-prose">
          <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · studies · scout · design system
          </div>
          <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
            Scout — Design System
          </h1>
          <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            One token set (<code className="font-mono text-[11px] text-studio-ink">--s-*</code>, the exact
            sRGB of native <code className="font-mono text-[11px] text-studio-ink">ScoutThemeColors</code>),
            then the whole shell rebuilt from it — every nav surface as a window. The default skin is the{" "}
            <strong className="font-semibold text-studio-ink">live app theme</strong> right now: juniper · light · indigo.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-studio-edge p-0.5">
          {SKINS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSkin(s.id)}
              className={`relative rounded-[5px] px-3 py-1.5 text-left transition-colors ${
                skin === s.id ? "bg-studio-surface text-studio-ink" : "text-studio-ink-faint hover:text-studio-ink"
              }`}
            >
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold">
                {s.label}
                {s.current ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="current app theme" /> : null}
              </div>
              <div className="font-mono text-[8.5px] uppercase tracking-eyebrow opacity-70">{s.tone}</div>
            </button>
          ))}
        </div>
      </header>

      <div className={styles.shell} data-scout-skin={skin}>
        {/* Tokens */}
        <section className={styles.section}>
          <SectionHead label={`tokens · ${SKINS.find((s) => s.id === skin)?.label} ${SKINS.find((s) => s.id === skin)?.tone}`} />
          <div className={styles.tokenGrid}>
            {TOKENS.map((t) => (
              <div key={t.name} className={styles.swatch}>
                <div className={styles.swatchChip} style={{ background: `var(${t.name})` }} />
                <div className={styles.swatchMeta}>
                  <div className={styles.swatchName}>{t.name}</div>
                  <div className={styles.swatchRole}>{t.role}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Page · Comms */}
        <section className={styles.section}>
          <SectionHead label="page · comms" />
          <WindowFrame active="comms">
            <CommsPage />
          </WindowFrame>
        </section>

        {/* Page · Agents */}
        <section className={styles.section}>
          <SectionHead label="page · agents + inspector" />
          <WindowFrame active="agents">
            <AgentsPage />
          </WindowFrame>
        </section>

        {/* Page · Repos */}
        <section className={styles.section}>
          <SectionHead label="page · repos — diffs & drifts" />
          <WindowFrame active="repos">
            <ReposPage />
          </WindowFrame>
        </section>

        {/* Page · Tail */}
        <section className={styles.section}>
          <SectionHead label="page · tail" />
          <WindowFrame active="tail">
            <TailPage />
          </WindowFrame>
        </section>

        {/* Page · Settings */}
        <section className={styles.section}>
          <SectionHead label="page · settings — appearance" />
          <WindowFrame active="settings">
            <SettingsPage />
          </WindowFrame>
        </section>
      </div>
    </main>
  );
}

function SectionHead({ label }: { label: string }) {
  return (
    <div className={styles.sectionHead}>
      <span className={styles.kicker}>{label}</span>
      <span className={styles.kickerRule} />
    </div>
  );
}

/* ── Window frame ───────────────────────────────────────────────────── */

function WindowFrame({ active, children }: { active: string; children: ReactNode }) {
  return (
    <div className={styles.win}>
      <div className={styles.titlebar}>
        <div className={styles.tl}>
          <span className={`${styles.tlDot} ${styles.tlRed}`} />
          <span className={`${styles.tlDot} ${styles.tlYellow}`} />
          <span className={`${styles.tlDot} ${styles.tlGreen}`} />
        </div>
        <span className={styles.winTitle}>scout · arts-mac-mini</span>
        <div className={styles.winTools}>
          <span className={styles.toolBtn}><SidebarGlyph /></span>
        </div>
      </div>
      <div className={styles.winBody}>
        <Rail active={active} />
        <div className={styles.content}>{children}</div>
      </div>
      <StatusBar />
    </div>
  );
}

const NAV = [
  { id: "comms", label: "Comms", icon: <CommsGlyph /> },
  { id: "agents", label: "Agents", icon: <AgentsGlyph /> },
  { id: "repos", label: "Repos", icon: <ReposGlyph /> },
  { id: "tail", label: "Tail", icon: <TailGlyph /> },
];

function Rail({ active }: { active: string }) {
  return (
    <nav className={styles.rail}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>S</span>
        <span className={styles.brandName}>Scout</span>
      </div>
      <div className={styles.nav}>
        {NAV.map((n) => (
          <div key={n.id} className={`${styles.navItem} ${active === n.id ? styles.active : ""}`}>
            {n.icon}
            {n.label}
          </div>
        ))}
      </div>
      <div className={styles.navSpacer} />
      <div className={`${styles.navSettings} ${active === "settings" ? styles.active : ""}`}>
        <GearGlyph />
        Settings
      </div>
    </nav>
  );
}

function StatusBar() {
  return (
    <div className={styles.statusbar}>
      <span className={styles.statusDot} />
      <span className={styles.statusKey}>SCOUT</span>
      <span className={styles.statusSep}>·</span>
      <span>50 cIds</span>
      <span className={styles.statusSep}>·</span>
      <span>24 agents</span>
      <span className={styles.statusSep}>·</span>
      <span>0 tail</span>
      <span className={styles.statusSep}>·</span>
      <span>14 trees</span>
    </div>
  );
}

/* ── Page · Comms ───────────────────────────────────────────────────── */

const CONV_FILTERS = ["Inbox", "DMs", "Channels"] as const;

function CommsPage() {
  const unread = CONVERSATIONS.filter((c) => c.unread).length;
  return (
    <div className={styles.comms}>
      <aside className={styles.commsAside}>
        <div className={styles.convHead}>
          <span className={styles.convTitleBar}>Conversations</span>
          <span className={styles.convCount}>{CONVERSATIONS.length} · {unread} unread</span>
        </div>
        {/* Labeled filters (improvement #3) — the three icon toggles in the app
            are unlabeled; name them. */}
        <div className={styles.convFilters}>
          {CONV_FILTERS.map((f, i) => (
            <span key={f} className={`${styles.convFilter} ${i === 0 ? styles.active : ""}`}>
              {f}
            </span>
          ))}
        </div>
        <div className={styles.convSearch}>
          <SearchGlyph />
          <span>Search the fleet</span>
        </div>
        {/* Grouped by recency instead of one flat 50-row scroll (improvement #3) */}
        <div className={styles.commsList}>
          {CONV_GROUPS.map((g) => {
            const rows = CONVERSATIONS.filter((c) => c.group === g.id);
            if (!rows.length) return null;
            return (
              <Fragment key={g.id}>
                <div className={styles.convGroup}>{g.label}</div>
                {rows.map((c) => (
                  <ConversationRow key={c.cId} c={c} />
                ))}
              </Fragment>
            );
          })}
        </div>
      </aside>
      <section className={styles.thread}>
        <div className={styles.threadHead}>
          <span className={styles.threadAvatar}>T</span>
          <div className={styles.threadIdent}>
            <div className={styles.threadName}>Talkie</div>
            <div className={styles.threadSub}>talkie · master · ~/dev/talkie · c.ab3fd029</div>
          </div>
          <div className={styles.threadActions}>
            <button className={styles.ghostBtn}>
              <EyeGlyph /> Observe
            </button>
            <button className={styles.btnPrimary}>Message</button>
          </div>
        </div>
        {/* Pinned originating ask (improvement #2) */}
        <PinnedAsk />
        <div className={styles.stream}>
          {MESSAGES.map((m, i) => (
            <Turn key={i} m={m} />
          ))}
        </div>
        <div className={styles.composer}>
          <div className={styles.composerBox}>
            <div className={styles.composerField}>Message Talkie…</div>
            <div className={styles.composerBar}>
              <span className={styles.composerMeta}>Type / for commands · @ for agents · session: for sessions</span>
              <button className={`${styles.btnPrimary} ${styles.composerSend}`}>Send</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function PinnedAsk() {
  const answered = ASK.state === "answered";
  return (
    <div className={styles.pinnedAsk}>
      <div className={styles.pinnedAskBar}>
        <PinGlyph />
        <span className={styles.pinLabel}>Ask</span>
        <span className={styles.pinId}>{ASK.id}</span>
        <span className={`${styles.askState} ${answered ? styles.askAnswered : styles.askPending}`}>
          {answered ? "Answered" : "Pending"}
        </span>
        <span className={styles.pinFrom}>from {ASK.from}</span>
      </div>
      <div className={styles.pinnedAskText}>{ASK.text}</div>
    </div>
  );
}

function Turn({ m }: { m: Message }) {
  const [open, setOpen] = useState(false);
  const clamped = m.long && !open;
  return (
    <div className={styles.turn}>
      <span className={`${styles.turnAvatar} ${m.me ? styles.turnAvatarMe : styles.turnAvatarAgent}`}>
        {m.author[0]}
      </span>
      <div className={styles.turnBody}>
        <div className={styles.turnHead}>
          <span className={styles.turnAuthor}>{m.author}</span>
          <span className={styles.turnTime}>{m.time}</span>
        </div>
        {/* Constrained reading measure + collapsible long turn (improvement #1) */}
        <div className={`${styles.turnText} ${clamped ? styles.turnClamped : ""}`} dangerouslySetInnerHTML={{ __html: m.html }} />
        {m.long ? (
          <button type="button" className={styles.turnMore} onClick={() => setOpen((o) => !o)}>
            {open ? "Show less" : "Show more"}
            <ChevronDown className={open ? styles.turnMoreUp : undefined} />
          </button>
        ) : null}
        {m.card ? (
          <div className={styles.turnCard}>
            <div className={styles.turnCardHead}>
              <FileGlyph />
              {m.card.head}
            </div>
            <div className={styles.turnCardBody}>{m.card.body}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Page · Agents ──────────────────────────────────────────────────── */

function AgentsPage() {
  return (
    <div className={styles.agents}>
      <div className={styles.agentsMain}>
        <ScoutPageHeader title="Agents" pill="25 agents" />
        <div className={styles.agentsBar}>
          <div className={styles.filterField}>
            <SearchGlyph />
            <span>Filter agents</span>
          </div>
          <div className={styles.seg}>
            <span className={`${styles.segBtn} ${styles.active}`}>All</span>
            <span className={styles.segBtn}>Live</span>
          </div>
          <button className={styles.ghostBtn}>Collapse</button>
        </div>
        <div className={styles.agentsTable}>
          <div className={styles.agentsHeadRow}>
            <span>Agent</span>
            <span>State</span>
            <span style={{ textAlign: "right" }}>Updated</span>
          </div>
          {AGENT_GROUPS.map((g) => (
            <AgentGroup key={g.project} g={g} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className={styles.pageHead}>
          <span className={styles.inspKey} style={{ fontSize: 9 }}>Agent</span>
          <div className={styles.pageHeadRight}>
            <span className={`${styles.badge} ${styles.badgeOk}`}>
              <span className={styles.statusDot} style={{ background: "var(--s-ok)" }} /> Available
            </span>
          </div>
        </div>
        <div className={styles.inspector}>
          <InspectorCard />
        </div>
      </div>
    </div>
  );
}

function AgentGroup({ g }: { g: AgentGroupT }) {
  return (
    <>
      <div className={styles.projRow}>
        <ChevronDown className={styles.projChevron} />
        <span className={styles.projName}>{g.project}</span>
        <span className={styles.projPath}>{g.path}</span>
        <span className={styles.projCount}>{g.count} {g.count === 1 ? "agent" : "agents"}</span>
      </div>
      {g.agents.map((a) => (
        <div key={a.name} className={`${styles.agentRow} ${a.selected ? styles.selected : ""}`}>
          <span className={styles.agentLead}>
            <span className={styles.agentChevron}>{a.expandable ? <ChevronRight /> : null}</span>
            <span className={styles.agentDot} style={{ background: a.live ? "var(--s-ok)" : "var(--s-dim)" }} />
            <span className={styles.agentName}>{a.name}</span>
            <span className={styles.agentMeta}>{a.meta}</span>
          </span>
          <span className={styles.stateCol}>{a.state}</span>
          <span className={styles.updatedCol}>{a.updated}</span>
        </div>
      ))}
    </>
  );
}

function InspectorCard() {
  return (
    <div className={styles.inspCard}>
      <div className={styles.inspTop}>
        <span className={styles.inspAvatar}>T</span>
        <div className={styles.inspIdent}>
          <div className={styles.inspName}>Talkie</div>
          <div className={styles.inspHandle}>talkie.master.arts-mac-mini-local</div>
        </div>
        <span className={styles.inspCopy}><CopyGlyph /></span>
      </div>
      <div className={styles.inspBtns}>
        <button className={styles.btnPrimary}>Message</button>
        <button className={styles.btnGhost}>+ New session</button>
      </div>
      {/* Live "what it's doing now" strip — reclaims the dead space and turns a
          static identity card into a cockpit (improvement #4). */}
      <div className={styles.inspGroup}>
        <div className={styles.inspGroupLabel}>
          Now
          <span className={styles.inspObserveBtn}>
            <EyeGlyph /> Observe
          </span>
        </div>
        <div className={styles.inspNowAction}>
          editing <code>AgentHomeShellView.swift</code>
          <span className={styles.inspNowCursor} />
        </div>
        <div className={styles.inspNowTail}>
          <div className={styles.inspNowRow}>
            <span className={styles.inspNowKind} data-k="tool">tool</span>
            Edit AgentHomeActivityStore.swift · +12 −4
          </div>
          <div className={styles.inspNowRow}>
            <span className={styles.inspNowKind} data-k="msg">msg</span>
            render overlay settings before the first send
          </div>
        </div>
      </div>
      <div className={styles.inspGroup}>
        <div className={styles.inspGroupLabel}>Runtime</div>
        <KV k="Role" v="Relay agent" />
        <KV k="Harness" v="claude" />
        <KV k="Transport" v="tmux" />
        <KV k="Node" v="Arts-Mac-mini.local" />
      </div>
      <div className={styles.inspGroup}>
        <div className={styles.inspGroupLabel}>Workspace</div>
        <KV k="Branch" v="master" />
        <KV k="Path" v="~/dev/talkie" />
        <KV k="cId" v="ab3fd029-807a-4aff-968a…" dim />
      </div>
      <div className={styles.inspGroup}>
        <div className={styles.inspGroupLabel}>
          Session
          <span className={styles.inspObserveBtn}>
            <EyeGlyph /> Observe
          </span>
        </div>
        <KV k="ID" v="relay-talkie-claude" />
        <KV k="Active" v="13h 6m" />
      </div>
      <div className={styles.inspGroup}>
        <div className={styles.inspGroupLabel}>Sessions</div>
        <div className={styles.inspSessionRow}>
          <span className={styles.agentDot} style={{ background: "var(--s-ok)" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--s-ink)" }}>Talkie</span>
          <span className={styles.tag}>RELAY AGENT</span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--s-font-mono)", fontSize: 10, color: "var(--s-dim)" }}>
            13h 6m
          </span>
        </div>
        <div className={styles.inspSessionMeta}>master · 6 msgs</div>
      </div>
    </div>
  );
}

function KV({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div className={styles.inspKV}>
      <span className={styles.inspKey}>{k}</span>
      <span className={`${styles.inspVal} ${dim ? styles.inspValDim : ""}`}>{v}</span>
    </div>
  );
}

/* ── Page · Repos ───────────────────────────────────────────────────── */

function ReposPage() {
  return (
    <>
      <ScoutPageHeader
        title="Repos"
        live
        counts={[
          { n: 10, label: "repos" },
          { n: 15, label: "trees" },
          { n: 8, label: "dirty", tone: "warn" },
          { n: 3, label: "attn", tone: "warn" },
        ]}
      />
      <div className={styles.reposPage}>
        <div className={styles.reposMain}>
          <div className={styles.repos}>
            <div className={styles.repoHead}>
              <span>repo / branch · worktree</span>
              <span className={styles.colRight}>churn</span>
              <span className={styles.colCenter}>files</span>
              <span className={styles.colCenter}>drift</span>
              <span>agents</span>
              <span className={styles.colRight}>touched</span>
            </div>
            {REPOS.map((repo) => (
              <ReposGroup key={repo.name} repo={repo} />
            ))}
          </div>
        </div>
        <div className={styles.diff}>
          <div className={styles.diffHead}>
            <div className={styles.diffTitle}>
              talkie <code>/master</code> — diff
            </div>
            <div className={styles.diffSub}>↑4 ↓1 · 60 files · +1,349 −1,169</div>
          </div>
          <div className={styles.diffBody}>
            <div className={styles.diffFilesCol}>
              <div className={styles.diffFiles}>
                {DIFF_FILES.map((f) => (
                  <div key={f.name} className={`${styles.diffFile} ${f.active ? styles.active : ""}`}>
                    <span
                      className={styles.diffGlyph}
                      style={{ color: f.glyph === "A" ? "var(--s-ok)" : f.glyph === "D" ? "var(--s-error)" : "var(--s-warn)" }}
                    >
                      {f.glyph}
                    </span>
                    <span className={styles.diffName}>{f.name}</span>
                    <span className={styles.diffNums}>
                      <span className={styles.add}>+{f.add}</span>
                      <span className={styles.del}>−{f.del}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.diffHunkCol}>
              <div className={styles.hunk}>
                <div className={styles.hunkHead}>AgentHomeShellView.swift · @@ -82,6 +82,9 @@</div>
                {HUNK.map((l, i) => (
                  <div
                    key={i}
                    className={`${styles.codeLine} ${l.kind === "add" ? styles.codeAdd : l.kind === "del" ? styles.codeDel : ""}`}
                  >
                    <span className={styles.codeGutter}>{l.no}</span>
                    <span className={styles.codeText}>
                      {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
                      {l.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Page · Tail ────────────────────────────────────────────────────── */

const KIND_CLASS: Record<Kind, string> = {
  msg: styles.kindMsg,
  tool: styles.kindTool,
  session: styles.kindSession,
  diff: styles.kindDiff,
  error: styles.kindError,
};

function TailPage() {
  return (
    <>
      <ScoutPageHeader
        title="Tail"
        live
        counts={[
          { n: 9, label: "events" },
          { n: 5, label: "sources" },
        ]}
      />
      <div className={styles.tail}>
        <div className={styles.tailBar}>
          <span className={styles.tailLive}>
            <span className={styles.tailPip} /> Live
          </span>
          <div className={styles.tailChips}>
            <span className={`${styles.chip} ${styles.active}`}>All</span>
            <span className={styles.chip}>Messages</span>
            <span className={styles.chip}>Tools</span>
            <span className={styles.chip}>Sessions</span>
            <span className={styles.chip}>Diffs</span>
          </div>
        </div>
        <div className={styles.tailStream}>
          {TAIL.map((e, i) => (
            <div key={i} className={styles.ev}>
              <span className={styles.evTime}>{e.t}</span>
              <span className={styles.evSource}>{e.src}</span>
              <span className={`${styles.evKind} ${KIND_CLASS[e.kind]}`}>{e.label}</span>
              <span className={styles.evMsg} dangerouslySetInnerHTML={{ __html: e.html }} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── Page · Settings ────────────────────────────────────────────────── */

const SET_NAV = ["Appearance", "Agents", "Ports & Services", "Shortcuts", "About"];

function SettingsPage() {
  return (
    <>
      <ScoutPageHeader title="Settings" />
      <div className={styles.settings}>
        <div className={styles.setNav}>
          {SET_NAV.map((n, i) => (
            <div key={n} className={`${styles.setNavItem} ${i === 0 ? styles.active : ""}`}>
              {n}
            </div>
          ))}
        </div>
        <div className={styles.setPane}>
          <div className={styles.setSection}>
            <div className={styles.setSectionTitle}>Theme</div>
            <div className={styles.setSectionHint}>
              The preset sets surfaces; mode and accent layer on top. Active: Nocturne · Light · Indigo.
            </div>
            <div className={styles.presetGrid}>
              {PRESETS.map((p) => (
                <div key={p.name} className={`${styles.presetCard} ${p.active ? styles.active : ""}`}>
                  <div className={styles.presetSwatch}>
                    <span className={styles.presetSwatchChrome} style={{ background: p.chrome }} />
                    <span className={styles.presetSwatchBg} style={{ background: p.bg }} />
                    <span className={styles.presetSwatchAccent} style={{ background: p.accent }} />
                  </div>
                  <div className={styles.presetMeta}>
                    <div className={styles.presetName}>{p.name}</div>
                    <div className={styles.presetTone}>{p.tone}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.setSection}>
            <div className={styles.setRow}>
              <div>
                <div className={styles.setRowLabel}>Mode</div>
                <div className={styles.setRowHint}>Render the preset in its light or dark tone.</div>
              </div>
              <div className={styles.modeSeg}>
                <span className={`${styles.modeSegBtn} ${styles.active}`}>Light</span>
                <span className={styles.modeSegBtn}>Dark</span>
                <span className={styles.modeSegBtn}>Auto</span>
              </div>
            </div>
            <div className={styles.setRow}>
              <div>
                <div className={styles.setRowLabel}>Accent</div>
                <div className={styles.setRowHint}>Tints actions, selection, and live state.</div>
              </div>
              <div className={styles.accentRow}>
                {ACCENTS.map((a) => (
                  <span
                    key={a.name}
                    title={a.name}
                    className={`${styles.accentDot} ${a.active ? styles.active : ""}`}
                    style={{ background: a.color }}
                  />
                ))}
              </div>
            </div>
            <div className={styles.setRow}>
              <div>
                <div className={styles.setRowLabel}>Window opacity</div>
                <div className={styles.setRowHint}>100% — fully opaque.</div>
              </div>
              <div className={styles.slider}>
                <div className={styles.sliderFill} style={{ width: "100%" }} />
                <div className={styles.sliderKnob} style={{ left: "100%" }} />
              </div>
            </div>
            <div className={styles.setRow}>
              <div>
                <div className={styles.setRowLabel}>Preview accents on hover</div>
                <div className={styles.setRowHint}>Flash a preset's accent when hovering its card.</div>
              </div>
              <div className={`${styles.toggle} ${styles.on}`}>
                <span className={styles.toggleKnob} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Repos table components (shared) ────────────────────────────────── */

function ReposGroup({ repo }: { repo: Repo }) {
  const toneVar =
    repo.tone === "warn"
      ? "var(--s-warn)"
      : repo.tone === "error"
        ? "var(--s-error)"
        : repo.tone === "dim"
          ? "var(--s-dim)"
          : "var(--s-accent)";
  return (
    <>
      <div className={`${styles.repoRow} ${styles.project}`}>
        <span className={styles.nameCell}>
          <span className={styles.dot} style={{ background: toneVar }} />
          <span className={styles.repoName}>{repo.name}</span>
          <span className={styles.path}>{repo.path}</span>
          <span className={styles.tag}>{repo.worktrees} wt</span>
        </span>
        <ChurnAgg repo={repo} />
        <span />
        <span />
        <span />
        <span />
      </div>
      {repo.trees.map((wt, i) => (
        <WorktreeRow key={`${repo.name}-${wt.branch}-${i}`} wt={wt} last={i === repo.trees.length - 1} />
      ))}
    </>
  );
}

function WorktreeRow({ wt, last }: { wt: Worktree; last: boolean }) {
  const live = wt.agents?.some((a) => a.live);
  return (
    <div className={`${styles.repoRow} ${wt.selected ? styles.selected : ""}`}>
      <span className={styles.nameCell}>
        <svg className={styles.treeGuide} viewBox="0 0 14 32" aria-hidden>
          <path d={`M6 0 V${last ? 16 : 32} M6 16 H13`} stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
        <span className={styles.dot} style={{ background: live ? "var(--s-accent)" : "var(--s-dim)" }} />
        <span className={styles.branch}>
          {wt.prefix ? <span className={styles.branchPrefix}>{wt.prefix}</span> : null}
          {wt.branch}
        </span>
        {wt.tag ? <span className={styles.tag}>{wt.tag}</span> : null}
      </span>
      <span className={styles.colRight}>
        <Churn add={wt.add} del={wt.del} />
      </span>
      <span className={styles.colCenter} style={{ color: wt.files ? "var(--s-muted)" : "var(--s-dim)", fontSize: 11 }}>
        {wt.files || "—"}
      </span>
      <span className={styles.colCenter}>
        <Drift ahead={wt.ahead} behind={wt.behind} />
      </span>
      <span className={styles.agents}>
        {wt.agents?.length ? (
          <>
            {live ? <span className={styles.livePip} /> : null}
            <span
              className={live ? styles.live : undefined}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {wt.agents.map((a) => a.handle).join(" ")}
            </span>
          </>
        ) : (
          <span className={styles.dash}>—</span>
        )}
      </span>
      <span className={`${styles.colRight} ${styles.touched}`}>{wt.touched}</span>
    </div>
  );
}

function ConversationRow({ c }: { c: Conversation }) {
  return (
    <div className={`${styles.convRow} ${c.selected ? styles.selected : ""} ${c.unread ? styles.unread : ""}`}>
      <span className={`${styles.convAvatar} ${c.channel ? styles.channel : ""}`}>{c.avatar}</span>
      <span className={styles.convBody}>
        <span className={styles.convTopline}>
          {c.unread ? <span className={styles.convUnread} /> : null}
          <span className={styles.convName}>{c.name}</span>
          {c.askState ? (
            <span className={`${styles.miniAsk} ${c.askState === "answered" ? styles.miniAnswered : styles.miniPending}`}>
              {c.askState}
            </span>
          ) : null}
          <span className={styles.convTime}>{c.time}</span>
        </span>
        <span className={styles.convPreview}>{c.preview}</span>
        {/* cId demoted to the focused row only (improvement #3) */}
        {c.selected ? <span className={styles.convCid}>cId {c.cId}</span> : null}
      </span>
      {c.count ? (
        <span className={`${styles.convMsgCount} ${c.unread ? styles.convMsgUnread : ""}`}>{c.count}</span>
      ) : null}
    </div>
  );
}

function ChurnAgg({ repo }: { repo: Repo }) {
  const add = repo.trees.reduce((n, t) => n + t.add, 0);
  const del = repo.trees.reduce((n, t) => n + t.del, 0);
  return (
    <span className={styles.colRight}>
      <Churn add={add} del={del} dim />
    </span>
  );
}

function Churn({ add, del, dim }: { add: number; del: number; dim?: boolean }) {
  if (add === 0 && del === 0) return <span className={styles.dash}>—</span>;
  const total = Math.max(add + del, 1);
  return (
    <span className={styles.churn} style={dim ? { opacity: 0.85 } : undefined}>
      <span className={styles.churnNums}>
        <span className={styles.add}>+{add.toLocaleString()}</span>
        <span className={styles.del}>−{del.toLocaleString()}</span>
      </span>
      <span className={styles.cbar}>
        <span className={styles.cbarAdd} style={{ width: `${(add / total) * 100}%` }} />
        <span className={styles.cbarDel} style={{ width: `${(del / total) * 100}%` }} />
      </span>
    </span>
  );
}

function Drift({ ahead, behind }: { ahead: number; behind: number }) {
  const cap = 10;
  const aheadW = (Math.min(ahead, cap) / cap) * 50;
  const behindW = (Math.min(behind, cap) / cap) * 50;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      <span className={styles.drift}>
        <span className={styles.driftTrack} />
        {behind > 0 ? <span className={styles.driftBehind} style={{ width: `${behindW}%` }} /> : null}
        {ahead > 0 ? <span className={styles.driftAhead} style={{ width: `${aheadW}%` }} /> : null}
        <span className={styles.driftTick} />
      </span>
      <span className={styles.driftLabels}>
        {behind > 0 ? <span className={styles.driftBehindN}>↓{behind}</span> : null}
        {ahead > 0 ? <span className={styles.driftAheadN}>↑{ahead}</span> : null}
        {ahead === 0 && behind === 0 ? <span className={styles.dash}>in sync</span> : null}
      </span>
    </span>
  );
}

/* ── Glyphs ─────────────────────────────────────────────────────────── */

function CommsGlyph() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 9.5 9.5 0 0 1-4-.9L3 20l1.4-4.5A8.4 8.4 0 0 1 3.5 11 8.5 8.5 0 0 1 12 2.5a8.4 8.4 0 0 1 9 8.5z" />
    </svg>
  );
}
function AgentsGlyph() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 19v-1a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v1" />
      <circle cx="9.5" cy="8" r="3" />
      <path d="M21 19v-1a3 3 0 0 0-2.2-2.9M16 5.1A3 3 0 0 1 16 11" />
    </svg>
  );
}
function ReposGlyph() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="2.4" />
      <circle cx="6" cy="19" r="2.4" />
      <circle cx="18" cy="8" r="2.4" />
      <path d="M6 7.4v9.2M6 12h6a4 4 0 0 0 4-4v-.2" />
    </svg>
  );
}
function TailGlyph() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l2.5 6 5-13 2.5 7H21" />
    </svg>
  );
}
function GearGlyph() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.8 7.8 0 0 0 0-3l1.7-1.3-1.8-3.1-2 .8a7.6 7.6 0 0 0-2.6-1.5L14.4 2H9.6l-.3 2.4a7.6 7.6 0 0 0-2.6 1.5l-2-.8L2.9 8.2l1.7 1.3a7.8 7.8 0 0 0 0 3L2.9 13.8l1.8 3.1 2-.8a7.6 7.6 0 0 0 2.6 1.5l.3 2.4h4.8l.3-2.4a7.6 7.6 0 0 0 2.6-1.5l2 .8 1.8-3.1z" />
    </svg>
  );
}
function SearchGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function EyeGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}
function CopyGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}
function FileGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
function PinGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" />
      <path d="M12 16v4" />
    </svg>
  );
}
function SidebarGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
