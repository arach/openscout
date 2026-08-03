"use client";

/**
 * Mobile · v3 — the settled fleet-timeline shape.
 *
 * Source of truth: plans/scout-mobile-timeline.md → "## v3 (settled shape)".
 * Phone tab bar: Home · Chats · [hex] · Projects · Notifications — consumption
 * left of the hex (the feed, conversations), the fleet's structure and demands
 * right of it (places, obligations). Each surface borrows the reference app
 * that fits its job: Home is X-like, Chats is Slack-like, the hex composer is
 * Codex-like, Notifications is an action queue, and Projects is the places
 * view where terminal access is contextual, not a tab.
 *
 * The frames reuse the scout-ios kit (PhoneShell, glyphs, --i-* tokens); the
 * v3 chrome (masthead without the retired compose "+", tab bar with the quiet
 * center hex) and the per-surface bodies are the deltas, scoped here as
 * .mtl-* on top of the kit classes.
 */

import type { ReactNode } from "react";
import {
  PhoneShell,
  ScoutIOSStyles,
  Glyph,
  CommsTypeGlyph,
  CommsStatusGlyph,
  CommsSurface,
  DetailHeader,
  EntrySurface,
  NotificationDetail,
  type CommsKind,
  type CommsStatus,
} from "@/components/scout-ios";

/* ════════════════════════════════════════════════════════════════════
   Studio helpers (outside the phone frames) — same grammar as the other
   editorial studies: mono eyebrow, display headline, lede.
   ════════════════════════════════════════════════════════════════════ */

function FrameCap({ k, children }: { k: string; children?: ReactNode }) {
  return (
    <div className="mb-3 min-h-[94px]">
      <div
        className="font-mono text-2xs font-semibold uppercase tracking-[0.14em]"
        style={{ color: "var(--scout-accent)" }}
      >
        {k}
      </div>
      {children ? (
        <div className="mt-1 max-w-[40ch] text-sm leading-snug text-studio-ink-muted">{children}</div>
      ) : null}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   v3 phone chrome — masthead + the five-seat tab bar with the raised hex.
   ════════════════════════════════════════════════════════════════════ */

/** The Scout mark as a logo lockup — the same filleted-hex geometry as the
 *  tab-bar hex, drawn heavy: a thick outer ring with a filled inner hex
 *  (the classic simple-geometry mark). */
function ScoutMark({ size = 21 }: { size?: number }) {
  return (
    <svg
      className="mtl-mark"
      viewBox="0 0 224 236"
      width={size}
      height={Math.round(size * (236 / 224))}
      aria-hidden
    >
      <path
        d="M103.01 13.21 Q112 8 120.99 13.21 L198.01 57.79 Q207 63 207 73.39 L207 162.61 Q207 173 198.01 178.21 L120.99 222.79 Q112 228 103.01 222.79 L25.99 178.21 Q17 173 17 162.61 L17 73.39 Q17 63 25.99 57.79 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={26}
        strokeLinejoin="round"
      />
      <path d="M112 70 154 94v48l-42 24-42-24V94Z" fill="currentColor" />
    </svg>
  );
}

/** Host scope — which hosts this device is looking at. Retires the technical
 *  treatments (host dots in the wire-hex qualifier, the counts pill) for a
 *  quiet borderless selector beside the mark: "All hosts" by default, a down
 *  caret, no counts in the masthead. The menu carries the per-host rows and
 *  their online state. Matches the status bar's fiction (mini online, mbp
 *  offline). */
const V3_HOSTS = [
  { id: "mini", label: "Arts Mac mini", online: true },
  { id: "mbp", label: "Studio MacBook", online: false },
];

function V3HostScope({ open = false }: { open?: boolean }) {
  return (
    <span className="mtl-scope">
      <span className="mtl-scope-btn" role="button" aria-expanded={open} aria-label="Host scope: all hosts">
        <span className="mtl-scope-label">All hosts</span>
        <Glyph kind="chevron" size={10} rotate={open ? 270 : 90} />
      </span>
      {open ? (
        <span className="mtl-menu" role="dialog" aria-label="Select hosts">
          <span className="mtl-menu-row" data-on="true">
            <span className="mtl-menu-name">All hosts</span>
            <Glyph kind="check" size={12} />
          </span>
          {V3_HOSTS.map((h) => (
            <span className="mtl-menu-row" key={h.id}>
              <span className="mtl-menu-dot" data-online={h.online} />
              <span className="mtl-menu-name">{h.label}</span>
              <span className="mtl-menu-state">{h.online ? "Online" : "Offline"}</span>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** The v3 masthead: the Scout mark alone (no wordmark, no accent — the logo
 *  carries the identity) + host scope + search + gear. Fixed 52px so it
 *  pairs with the 44px sub bar as one consistent chrome stack. */
function V3Mast({ hostMenu = false }: { hostMenu?: boolean }) {
  return (
    <div className="iHead mtl-head">
      <div className="iMast">
        <span className="mtl-logo">
          <ScoutMark size={23} />
        </span>
        <V3HostScope open={hostMenu} />
        <span className="iMastGap" />
        <span className="iGear">
          <Glyph kind="search" size={16} />
        </span>
        <span className="iGear">
          <Glyph kind="gear" size={20} />
        </span>
      </div>
      <div className="iMastRule" />
    </div>
  );
}

/** The secondary bar — one fixed-height component under the masthead, on
 *  every surface. Contents change (list filter, scope seg, destination,
 *  section context), the chrome doesn't: 44px, full-bleed hairline below. */
function V3SubBar({ children }: { children: ReactNode }) {
  return <div className="mtl-subbar">{children}</div>;
}

/** The canonical Scout hex (same geometry as the wire mark / app icon), bare —
 *  quiet, small, corners filleted just past the stroke's own round join.
 *  The center seat is a destination like the others. */
function HexCompose() {
  return (
    <span className="mtl-hex" aria-hidden>
      <svg viewBox="0 0 224 236" width="100%" height="100%">
        <path
          className="mtl-hex-body"
          d="M103.01 13.21 Q112 8 120.99 13.21 L198.01 57.79 Q207 63 207 73.39 L207 162.61 Q207 173 198.01 178.21 L120.99 222.79 Q112 228 103.01 222.79 L25.99 178.21 Q17 173 17 162.61 L17 73.39 Q17 63 25.99 57.79 Z"
        />
      </svg>
    </span>
  );
}

type V3Tab = "home" | "chats" | "compose" | "projects" | "alerts";

const V3_TABS_LEFT: { id: V3Tab; label: string; kind: "home" | "comms" }[] = [
  { id: "home", label: "Home", kind: "home" },
  { id: "chats", label: "Chats", kind: "comms" },
];
const V3_TABS_RIGHT: { id: V3Tab; label: string; kind: "folder" | "inbox" }[] = [
  { id: "projects", label: "Projects", kind: "folder" },
  { id: "alerts", label: "Alerts", kind: "inbox" },
];

function V3TabItem({
  label,
  kind,
  on,
  badge,
}: {
  label: string;
  kind: "home" | "comms" | "folder" | "inbox";
  on: boolean;
  badge?: number;
}) {
  return (
    <div className="iTab" data-on={on}>
      <span className="iTabIcon">
        <Glyph kind={kind} size={19} />
        {badge != null && badge > 0 && <span className="iTabBadge">{badge}</span>}
      </span>
      <span className="iTabLabel">{label}</span>
    </div>
  );
}

/** The v3 tab bar — Home · Chats · [hex] · Projects · Alerts. Consumption
 *  left of the hex; the fleet's structure and demands right of it. */
function V3Tabs({ active, alerts }: { active: V3Tab; alerts?: number }) {
  return (
    <div className="iTabs mtl-tabs">
      {V3_TABS_LEFT.map((t) => (
        <V3TabItem key={t.id} label={t.label} kind={t.kind} on={active === t.id} />
      ))}
      <div className="mtl-hexwrap" data-on={active === "compose"}>
        <HexCompose />
      </div>
      {V3_TABS_RIGHT.map((t) => (
        <V3TabItem
          key={t.id}
          label={t.label}
          kind={t.kind}
          on={active === t.id}
          badge={t.id === "alerts" ? alerts : undefined}
        />
      ))}
    </div>
  );
}

/** The cockpit status bar, unchanged from the kit's RootView chrome. */
function V3StatusBar() {
  return (
    <div className="iStatusBar">
      <div className="iSbRun">
        <span className="iSbCell">
          <Glyph kind="signal" size={11} />
          <span className="iSbLabel" style={{ color: "var(--i-accent)" }}>LAN</span>
        </span>
        <span className="iSbDot">·</span>
        <span className="iSbCell">
          <span className="iDot" style={{ background: "var(--i-accent)" }} />
          <span className="iSbLabel">studio</span>
        </span>
      </div>
      <div className="iSbRun">
        <span className="iSbCell">
          <span className="iSbLabel" style={{ color: "var(--i-accent)" }}>3 active</span>
        </span>
        <span className="iSbDot">·</span>
        <span className="iSbCell">
          <span className="iSbLabel" style={{ color: "var(--i-accent)" }}>1/2 online</span>
        </span>
      </div>
    </div>
  );
}

/** One v3 frame: kit PhoneShell, v3 masthead, body, v3 tab bar, status bar.
 *  `chrome={false}` drops the tab/status bars (pushed surfaces; the compose,
 *  whose keyboard covers the tab bar) and `header` swaps the masthead. */
function V3Frame({
  tab,
  alerts = 2,
  children,
  sheet,
  chrome = true,
  header,
}: {
  tab: V3Tab;
  alerts?: number;
  children: ReactNode;
  /** Optional overlay (the peek sheet) — covers the whole screen. */
  sheet?: ReactNode;
  chrome?: boolean;
  header?: ReactNode;
}) {
  return (
    <PhoneShell surface="home" variant="shipped" showChrome={false} header={header ?? <V3Mast />}>
      {children}
      {chrome && <V3Tabs active={tab} alerts={alerts} />}
      {chrome && <V3StatusBar />}
      {sheet}
    </PhoneShell>
  );
}

/* ════════════════════════════════════════════════════════════════════
   1 · Home — the X-like feed.
   ════════════════════════════════════════════════════════════════════ */

const WORKING_NOW = [
  { name: "Quill", project: "openscout", action: "drafting release notes", elapsed: "26m" },
  { name: "Composer", project: "lattices", action: "running solver v2 tests", elapsed: "1h 12m" },
  { name: "Descartes", project: "talkie", action: "reviewing capture pipeline", elapsed: "8m" },
  { name: "broker-smith", project: "openscout", action: "editing HomeSurface.swift", elapsed: "2h 4m" },
];

type PostState = "done" | "failed" | "needs";

/** The context row (X's "reposted by" slot) — the outcome framing, colored by state. */
const STATE_META: Record<PostState, { glyph: string; ctx: string }> = {
  done: { glyph: "✓", ctx: "Done" },
  failed: { glyph: "✕", ctx: "Failed" },
  needs: { glyph: "?", ctx: "Needs you" },
};

interface FeedPostData {
  agent: string;
  project: string;
  harness: string;
  age: string;
  state: PostState;
  /** Extends the context row — "in 26m", "after 3 tries", "2 questions". */
  detail?: string;
  /** The tweet text: the agent-authored outcome line, in primary ink. */
  line: string;
  /** Link-card attachment (PR, artifact) — the quoted-tweet slot. */
  card?: { title: string; meta: string };
  /** X-style action row; the state-appropriate CTA gets accented. */
  actions: string[];
  cta?: string;
}

const POSTS: FeedPostData[] = [
  {
    agent: "Quill", project: "openscout", harness: "claude", age: "12m", state: "done",
    detail: "in 26m",
    line: "Drafted the fleet-timeline release notes — ready for review.",
    card: { title: "PR #412 · Fleet timeline release notes", meta: "openscout · +184 −22 · 6 files" },
    actions: ["Reply", "Review PR", "Open thread"],
    cta: "Review PR",
  },
  {
    agent: "Descartes", project: "openscout", harness: "claude", age: "38m", state: "done",
    detail: "in 9m",
    line: "Finished the mobile nav critique — verdict: the feed-first call is right, post-shaping is the risk. Full writeup in plans/.",
    actions: ["Reply", "Open thread"],
  },
  {
    agent: "Composer", project: "lattices", harness: "codex", age: "51m", state: "needs",
    detail: "2 questions",
    line: "Two open questions on the grid solver before I can land v2 — keep v1 as a fallback?",
    actions: ["Answer", "Open thread"],
    cta: "Answer",
  },
];

const POSTS_SEEN: FeedPostData[] = [
  {
    agent: "tail-tuner", project: "hudson", harness: "codex", age: "2h", state: "failed",
    detail: "after 3 tries",
    line: "Tail token pass failed — the HudsonVoice flag gate blocks the build.",
    actions: ["Reply", "Retry"],
    cta: "Retry",
  },
  {
    agent: "voice tray", project: "talkie", harness: "codex", age: "4h", state: "done",
    line: "Dictation fallback restored — Talkie 0.9.4 is tagged and on TestFlight.",
    actions: ["Reply", "Open thread"],
  },
  {
    agent: "session initiation", project: "openscout", harness: "codex", age: "6h", state: "done",
    line: "One composer now feeds both /api/sessions and the @handle send path.",
    actions: ["Reply", "Open thread"],
  },
];

/** Identity mark — the kit's deterministic accent tile: mono initial, name-hash
 *  tint (same pattern as Comms "Marks"). Color is set inline; the tile's fill
 *  and border derive from currentColor. */
const AVA_TONES = ["var(--i-accent)", "var(--i-info)", "var(--i-ok)", "var(--i-warn)"];
function avaTone(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVA_TONES[h % AVA_TONES.length];
}

/** One post, X anatomy: avatar column · context row (outcome) · name + meta ·
 *  outcome line in primary ink · optional link card · action row. */
function FeedPost({ p }: { p: FeedPostData }) {
  const meta = STATE_META[p.state];
  return (
    <div className="mtl-post">
      <span className="mtl-post-ava" style={{ color: avaTone(p.agent) }}>
        {p.agent.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "•"}
      </span>
      <div className="mtl-post-main">
        <div className="mtl-post-ctx" data-state={p.state}>
          {meta.glyph} {meta.ctx}
          {p.detail ? ` · ${p.detail}` : ""}
        </div>
        <div className="mtl-post-top">
          <span className="mtl-post-agent">{p.agent}</span>
          <span className="mtl-post-meta">
            {p.project} · {p.harness} · {p.age}
          </span>
        </div>
        <div className="mtl-post-line">{p.line}</div>
        {p.card ? (
          <div className="mtl-post-card">
            <span className="mtl-post-card-title">{p.card.title}</span>
            <span className="mtl-post-card-meta">{p.card.meta}</span>
          </div>
        ) : null}
        <div className="mtl-post-actions">
          {p.actions.map((a) => (
            <span className="mtl-act" data-primary={p.cta === a ? "true" : undefined} key={a}>
              {a}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function HomeScreen({ filterOpen = false }: { filterOpen?: boolean }) {
  return (
    <div className="iBody mtl-body">
      {/* list filter — one borderless button naming the current list; the menu
          carries the other lists and the New list… affordance */}
      <V3SubBar>
        <span className="mtl-filterwrap">
          <span className="mtl-filter" role="button" aria-expanded={filterOpen} aria-label="List filter: For you">
            <span className="mtl-filter-label">For you</span>
            <Glyph kind="chevron" size={10} rotate={filterOpen ? 270 : 90} />
          </span>
          {filterOpen ? (
            <span className="mtl-menu" role="dialog" aria-label="Filter feed">
              <span className="mtl-menu-row" data-on="true">
                <span className="mtl-menu-name">For you</span>
                <Glyph kind="check" size={12} />
              </span>
              <span className="mtl-menu-row">
                <span className="mtl-menu-name">Working</span>
              </span>
              <span className="mtl-menu-row">
                <span className="mtl-menu-name">Thinking</span>
              </span>
              <span className="mtl-menu-sep" />
              <span className="mtl-menu-row">
                <span className="mtl-menu-name">New list…</span>
              </span>
            </span>
          ) : null}
        </span>
      </V3SubBar>

      {/* the stories row — Working appears twice on purpose; this is the
          always-live glance, the full list is one filter position away */}
      <div className="iSec">
        <span className="iPulse" />
        <span className="iSecLabel">Working now</span>
      </div>
      <div className="iWorkScroll mtl-workrow">
        {WORKING_NOW.map((w) => (
          <div className="iWorkCard mtl-workcard" key={w.name}>
            <div className="iWorkTop">
              <span className="iDot iDotLive" style={{ background: "var(--i-accent)" }} />
              <span className="iWorkName">{w.name}</span>
              <span className="mtl-work-elapsed">{w.elapsed}</span>
            </div>
            <div className="iWorkAction">{w.action}</div>
            <div className="iWorkMeta">{w.project}</div>
          </div>
        ))}
      </div>

      {/* the feed — conservative sources, agent-authored outcome lines.
          No section label: the active filter already names the list. */}
      <div className="mtl-feed">
        {POSTS.map((p) => (
          <FeedPost key={p.agent} p={p} />
        ))}
        <div className="mtl-since">
          <span className="mtl-since-rule" />
          <span className="mtl-since-label">New since you last looked</span>
          <span className="mtl-since-rule" />
        </div>
        {POSTS_SEEN.map((p) => (
          <FeedPost key={p.agent} p={p} />
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   2 · Chats — Slack-like. Threads involving you, any origin device.
   ════════════════════════════════════════════════════════════════════ */

const DMS: {
  name: string;
  status: CommsStatus;
  preview: string;
  age: string;
  unread?: number;
}[] = [
  { name: "Descartes", status: "ask", preview: "Writeup is in plans/ — want the short version here too?", age: "3m", unread: 2 },
  { name: "Quill", status: "working", preview: "Cutting the release-notes draft down to one page…", age: "11m" },
  { name: "Scoutbot", status: "awaiting", preview: "On it — spinning up a codex session in openscout.", age: "1h" },
  { name: "Composer", status: "idle", preview: "Grid-solver notes attached, v2 numbers inside.", age: "1d" },
];

const CHANNELS: {
  name: string;
  kind: CommsKind;
  preview: string;
  age: string;
  unread?: number;
}[] = [
  { name: "openscout", kind: "channel", preview: "Merge train: PR #409 and #411 land together", age: "18m", unread: 4 },
  { name: "lattices", kind: "channel", preview: "Fable: solver v2 numbers are in, 1.8× on the hard set", age: "2h" },
  { name: "talkie", kind: "channel", preview: "0.9.4 shipped to TestFlight", age: "5h" },
];

function ChatRow({
  name,
  kind,
  status,
  preview,
  age,
  unread,
}: {
  name: string;
  kind: CommsKind;
  status?: CommsStatus;
  preview: string;
  age: string;
  unread?: number;
}) {
  return (
    <div className="mtl-chat" data-unread={unread ? "" : undefined}>
      <span className="mtl-chat-glyph">
        <CommsTypeGlyph kind={kind} />
      </span>
      <div className="mtl-chat-body">
        <div className="mtl-chat-top">
          <span className="mtl-chat-name">{name}</span>
          {status && <CommsStatusGlyph status={status} />}
          <span className="mtl-chat-age">{age}</span>
        </div>
        <div className="mtl-chat-preview">{preview}</div>
      </div>
      {unread != null && <span className="mtl-unread">{unread}</span>}
    </div>
  );
}

function ChatsScreen() {
  return (
    <div className="iBody mtl-body">
      {/* scope toggle — Mine (threads involving you, any device) / Channels */}
      <V3SubBar>
        <div className="mtl-seg">
          <span className="mtl-seg-opt" data-on="true">Mine</span>
          <span className="mtl-seg-opt">Channels</span>
        </div>
      </V3SubBar>

      <div className="iSec">
        <span className="iSecLabel">Direct</span>
      </div>
      <div>
        {DMS.map((d) => (
          <ChatRow key={d.name} name={d.name} kind="direct" status={d.status} preview={d.preview} age={d.age} unread={d.unread} />
        ))}
      </div>

      <div className="iSec">
        <span className="iSecLabel">Channels</span>
      </div>
      <div>
        {CHANNELS.map((c) => (
          <ChatRow key={c.name} name={c.name} kind={c.kind} preview={c.preview} age={c.age} unread={c.unread} />
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   3 · Hex composer — Codex-like. A prompting surface, not a chat bubble.
   ════════════════════════════════════════════════════════════════════ */

function ComposeScreen() {
  return (
    <div className="iBody mtl-body mtl-compose">
      {/* target — the primary agent is the default; the picker is one tap */}
      <V3SubBar>
        <div className="mtl-target">
          <span className="mtl-field-label">To</span>
          <span className="mtl-target-agent">
            Scoutbot
            <span className="mtl-target-sub">primary · codex</span>
          </span>
          <span className="mtl-field-chev"><Glyph kind="chevron" size={13} rotate={90} /></span>
        </div>
      </V3SubBar>

      {/* the prompt — voice-first affordance, text second */}
      <div className="mtl-prompt">
        <div className="mtl-prompt-text">
          Review the v3 mobile study against the timeline plan and file the gaps as a critique…
          <span className="iCaret" />
        </div>
        <span className="mtl-mic" aria-hidden>
          <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M8.5 21h7" />
          </svg>
        </span>
      </div>

      {/* structured fields — corrections to a visible default, not a form */}
      <div className="mtl-fields">
        <div className="mtl-field">
          <span className="mtl-field-label">Project</span>
          <span className="mtl-field-value">openscout</span>
          <span className="mtl-field-chev"><Glyph kind="chevron" size={12} rotate={90} /></span>
        </div>
        <div className="mtl-field">
          <span className="mtl-field-label">Harness</span>
          <span className="mtl-field-value">codex</span>
          <span className="mtl-field-chev"><Glyph kind="chevron" size={12} rotate={90} /></span>
        </div>
        <div className="mtl-field">
          <span className="mtl-field-label">Runtime</span>
          <span className="mtl-field-value">gpt-5.6 · high</span>
          <span className="mtl-field-chev"><Glyph kind="chevron" size={12} rotate={90} /></span>
        </div>
      </div>

      {/* attachment */}
      <div className="mtl-attach">
        <span className="iChip off"><span className="iChipName">+ Attach</span></span>
        <span className="iChip on"><span className="iChipName">plans/scout-mobile-timeline.md ✕</span></span>
      </div>

      <div className="mtl-launch">
        <span className="mtl-launch-label">Launch task</span>
        <Glyph kind="arrow" size={16} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   4 · Projects — the places view. What lives where, who's on it.
   ════════════════════════════════════════════════════════════════════ */

const PLACES: {
  name: string;
  branch: string;
  git: string;
  dirty?: boolean;
  agents: string;
  activity: string;
  terminal?: boolean;
}[] = [
  {
    name: "openscout", branch: "main", git: "clean", agents: "Quill · Descartes · broker-smith",
    activity: "PR #412 opened · 12m ago", terminal: true,
  },
  {
    name: "lattices", branch: "feat/grid-solver", git: "3 uncommitted", dirty: true, agents: "Composer",
    activity: "Solver v2 tests failing · 51m ago",
  },
  {
    name: "talkie", branch: "main", git: "clean", agents: "voice tray · idle",
    activity: "0.9.4 tagged · 4h ago",
  },
  {
    name: "hudson", branch: "feat/tail-tokens", git: "1 uncommitted", dirty: true, agents: "tail-tuner",
    activity: "Build failed · 2h ago",
  },
];

function ProjectsScreen() {
  return (
    <div className="iBody mtl-body">
      <V3SubBar>
        <span className="iSecLabel">Projects · workspaces</span>
        <span className="iSecAll">4 places</span>
      </V3SubBar>
      <div className="mtl-places">
        {PLACES.map((p) => (
          <div className="iCard mtl-place" key={p.name}>
            <div className="mtl-place-top">
              <span className="mtl-place-name">{p.name}</span>
              <span className="mtl-place-git" data-dirty={p.dirty ? "" : undefined}>
                {p.branch} · {p.git}
              </span>
            </div>
            <div className="mtl-place-agents">{p.agents}</div>
            <div className="mtl-place-activity">{p.activity}</div>
            {p.terminal && (
              <div className="mtl-place-term">
                <Glyph kind="terminal" size={14} />
                <span>Open terminal in this workspace</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   5 · Notifications — the action queue. Consequential vs FYI.
   ════════════════════════════════════════════════════════════════════ */

function AlertsScreen() {
  return (
    <div className="iBody mtl-body">
      {/* consequential — an agent is paused until you act */}
      <V3SubBar>
        <span className="iSecLabel" style={{ color: "var(--i-warn)" }}>Needs you · 2</span>
        <span className="iSecAll" style={{ color: "var(--i-dim)" }}>3 FYI</span>
      </V3SubBar>

      <div className="iCard mtl-alert" data-sev="act">
        <div className="mtl-alert-top">
          <span className="mtl-post-glyph" data-state="needs">!</span>
          <span className="mtl-alert-kind">Approval</span>
          <span className="mtl-alert-meta">Quill · openscout · 2m</span>
        </div>
        <div className="mtl-alert-title">Run git push --force-with-lease on main?</div>
        <div className="mtl-alert-sub">Release-notes branch rebased onto origin/main · risk: med</div>
        <div className="mtl-alert-actions">
          <span className="mtl-btn">Deny</span>
          <span className="mtl-btn" data-primary="true">Approve</span>
        </div>
      </div>

      <div className="iCard mtl-alert" data-sev="act">
        <div className="mtl-alert-top">
          <span className="mtl-post-glyph" data-state="needs">?</span>
          <span className="mtl-alert-kind">Question</span>
          <span className="mtl-alert-meta">Composer · lattices · 51m</span>
        </div>
        <div className="mtl-alert-title">Keep the v1 solver as a fallback, or cut it?</div>
        <div className="mtl-alert-opts">
          <span className="mtl-opt">Keep as fallback</span>
          <span className="mtl-opt">Cut it</span>
          <span className="mtl-opt" data-answer="true">Answer…</span>
        </div>
      </div>

      {/* FYI — quiet, dismiss-only; swipe archives, never approves */}
      <div className="iSec">
        <span className="iSecLabel">FYI</span>
      </div>

      <div className="mtl-fyi">
        <span className="mtl-post-glyph" data-state="done"><Glyph kind="check" size={11} /></span>
        <div className="mtl-fyi-body">
          <div className="mtl-fyi-title">Descartes finished the mobile nav critique</div>
          <div className="mtl-fyi-sub">openscout · claude · 38m</div>
        </div>
        <span className="mtl-dismiss" aria-label="Dismiss">✕</span>
      </div>
      <div className="mtl-fyi">
        <span className="mtl-post-glyph" data-state="failed">✕</span>
        <div className="mtl-fyi-body">
          <div className="mtl-fyi-title">tail-tuner: build failed on hudson</div>
          <div className="mtl-fyi-sub">HudsonVoice flag gate · 2h · Retry on the Mac</div>
        </div>
        <span className="mtl-dismiss" aria-label="Dismiss">✕</span>
      </div>
      <div className="mtl-fyi">
        <span className="mtl-post-glyph" data-state="done"><Glyph kind="check" size={11} /></span>
        <div className="mtl-fyi-body">
          <div className="mtl-fyi-title">Talkie 0.9.4 tagged</div>
          <div className="mtl-fyi-sub">talkie · codex · 4h</div>
        </div>
        <span className="mtl-dismiss" aria-label="Dismiss">✕</span>
      </div>

      <div className="mtl-clear-note">Zero-state here means the fleet is unblocked.</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   6 · Peek sheet — tap a feed row → the conversation, one layer deep.
   ════════════════════════════════════════════════════════════════════ */

function PeekSheet() {
  return (
    <div className="mtl-scrim">
      <div className="mtl-sheet">
        <div className="mtl-grabber" />
        <div className="mtl-sheet-head">
          <span className="mtl-sheet-title">Descartes</span>
          <span className="mtl-sheet-sub">openscout · claude · done 38m</span>
        </div>
        <div className="mtl-sheet-msgs">
          <div>
            <div className="iTurnLabel" data-role="user"><span>You · 9:02</span></div>
            <div className="mtl-msg">Critique the mobile nav redesign — be brutal, cite the plan.</div>
          </div>
          <div>
            <div className="iTurnLabel" data-role="agent"><span>Descartes · 9:04</span></div>
            <div className="mtl-msg">Read plans/scout-mobile-timeline.md and the five iOS surfaces. Checking the feed-shaping claims against Tail…</div>
          </div>
          <div>
            <div className="iTurnLabel" data-role="agent"><span>Descartes · 9:11</span></div>
            <div className="mtl-msg">Verdict: the feed-first call is right, but post-shaping is the product risk. Full writeup in plans/scout-mobile-timeline-critique.md.</div>
          </div>
        </div>
        <div className="mtl-sheet-actions">
          <span className="mtl-btn" data-primary="true">Reply</span>
          <span className="mtl-btn">Open thread</span>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Scoped CSS — the v3 deltas, on top of the kit's .i-* classes.
   ════════════════════════════════════════════════════════════════════ */

const MTL_CSS = `
/* body — the kit's .iBody is overflow:hidden with flex:1; ours also lays out */
.mtl-body { display: flex; flex-direction: column; min-height: 0; }

/* ── tab bar: center hex — quiet, same visual weight as the other seats ── */
.mtl-tabs { height: 60px; }
.mtl-hexwrap { flex: 1; display: flex; justify-content: center; align-items: flex-start; }
.mtl-hex { display: block; width: 33px; height: 35px; margin-top: 2px; }
.mtl-hex-body { fill: none; stroke: var(--i-muted);
  stroke-width: 10; stroke-linejoin: round; }
.mtl-hexwrap[data-on="true"] .mtl-hex-body { stroke: var(--i-accent); fill: var(--i-accent-soft); }

/* kit fit fixes, scoped to this page: the cockpit status bar runs flush to
 *  the screen edge with kit padding/typography, and .iWorkAction's rtl
 *  truncation (right for raw shell commands in Ops) eats the start of our
 *  prose action lines. */
.iStatusBar { padding-inline: 10px; }
.iStatusBar .iSbLabel { font-size: 9px; letter-spacing: 0.02em; }
.mtl-workcard .iWorkAction { direction: ltr; }

/* ── chrome stack: fixed-height masthead + one fixed sub bar everywhere ── */
.mtl-head { padding: 0 16px; }
.mtl-head .iMast { height: 52px; }
.mtl-head .iMastRule { margin-top: 0; }
.mtl-logo { display: flex; align-items: center; gap: 8px; }
.mtl-mark { display: block; color: var(--i-ink); }
/* host scope — quiet borderless selector; the counts pill is retired */
.mtl-scope { position: relative; z-index: 12; display: flex; align-items: center; }
.mtl-scope-btn { display: flex; align-items: center; gap: 5px; height: 26px; color: var(--i-dim); }
.mtl-scope-label { font-family: var(--i-mono); font-size: 11px; font-weight: 500; color: var(--i-ink); }

/* shared menu language — the same panel as the kit's masthead host menu
 *  (.iMastHostMenu): elevated surface card, hairline rows, accent check */
.mtl-menu { position: absolute; top: calc(100% + 8px); left: -4px; z-index: 20; display: grid;
  width: 218px; overflow: hidden; border: 1px solid var(--i-hairline-strong); border-radius: 12px;
  background: var(--i-surface); box-shadow: 0 10px 28px rgba(0,0,0,0.34); }
.mtl-menu-row { display: flex; min-height: 40px; align-items: center; gap: 9px; padding: 6px 12px;
  border-bottom: 1px solid var(--i-hairline); color: var(--i-muted); }
.mtl-menu-row:last-child { border-bottom: 0; }
.mtl-menu-row[data-on="true"] { color: var(--i-ink); }
.mtl-menu-row > svg { margin-left: auto; color: var(--i-accent); }
.mtl-menu-name { flex: 1; font-size: var(--text-md); font-weight: 500; white-space: nowrap; }
.mtl-menu-dot { width: 7px; height: 7px; margin: 0 4px; flex: none; border-radius: 50%;
  border: 1px solid var(--i-dim); }
.mtl-menu-dot[data-online="true"] { background: var(--i-accent); border-color: var(--i-accent); }
.mtl-menu-state { font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.mtl-menu-sep { height: 6px; background: var(--i-bg); border-bottom: 1px solid var(--i-hairline); }
.mtl-subbar { flex: none; height: 44px; margin: 0 -14px; padding: 0 14px;
  display: flex; align-items: center; gap: 7px;
  border-bottom: 1px solid var(--i-hairline); }
/* adoption frames — a shipped kit body nested under the v3 sub bar keeps its
 *  own look, not a second round of body padding */
.mtl-body > .iBody { padding: 0; }

/* ── 1 · Home ───────────────────────────────────────────────────────── */
/* list filter — one borderless button; reads as a filter, not a tab */
.mtl-filterwrap { position: relative; z-index: 12; display: flex; align-items: center; }
.mtl-filter { display: flex; align-items: center; gap: 6px; height: 30px; color: var(--i-dim); }
.mtl-filter-label { font-size: var(--text-lg); font-weight: 700; color: var(--i-ink); }
.mtl-workrow { flex: none; }
.mtl-workcard { width: 172px; }
.mtl-work-elapsed { margin-left: auto; flex: none; font-family: var(--i-mono);
  font-size: var(--text-2xs); color: var(--i-accent); }
.mtl-feed { flex: 1; min-height: 0; overflow: hidden; }
.mtl-post { display: flex; gap: 10px; padding: 10px 2px; border-bottom: 1px solid var(--i-hairline); }
.mtl-post-ava { flex: none; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
  font-family: var(--i-mono); font-size: 13px; font-weight: 700;
  background: color-mix(in oklab, currentColor 13%, transparent);
  border: 1px solid color-mix(in oklab, currentColor 32%, transparent); }
.mtl-post-main { flex: 1; min-width: 0; }
.mtl-post-ctx { display: flex; align-items: center; gap: 5px; margin-bottom: 3px;
  font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; }
.mtl-post-ctx[data-state="done"] { color: var(--i-accent); }
.mtl-post-ctx[data-state="failed"] { color: var(--i-error); }
.mtl-post-ctx[data-state="needs"] { color: var(--i-warn); }
.mtl-post-top { display: flex; align-items: baseline; gap: 7px; }
.mtl-post-agent { font-size: var(--text-lg); font-weight: 700; color: var(--i-ink); }
.mtl-post-meta { font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mtl-post-line { margin-top: 3px; font-size: var(--text-md); line-height: 1.45; color: var(--i-ink); }
.mtl-post-card { margin-top: 7px; display: grid; gap: 2px; padding: 8px 10px; border-radius: 10px;
  background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }
.mtl-post-card-title { font-size: var(--text-sm); font-weight: 600; color: var(--i-ink); }
.mtl-post-card-meta { font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.mtl-post-actions { display: flex; gap: 18px; margin-top: 8px; }
.mtl-act { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 500; color: var(--i-dim); }
.mtl-act[data-primary="true"] { color: var(--i-accent); font-weight: 700; }
.mtl-post-glyph { flex: none; display: inline-grid; place-items: center; width: 16px; height: 16px;
  border-radius: 50%; font-size: 9px; font-weight: 700; font-family: var(--i-mono);
  transform: translateY(1px); }
.mtl-post-glyph[data-state="done"] { color: var(--i-accent); background: var(--i-accent-soft);
  border: 1px solid color-mix(in oklab, var(--i-accent) 35%, transparent); }
.mtl-post-glyph[data-state="failed"] { color: var(--i-error);
  border: 1px solid color-mix(in oklab, var(--i-error) 45%, transparent); }
.mtl-post-glyph[data-state="needs"] { color: var(--i-warn);
  border: 1px solid color-mix(in oklab, var(--i-warn) 45%, transparent); }
.mtl-since { display: flex; align-items: center; gap: 9px; padding: 10px 0 2px; }
.mtl-since-rule { flex: 1; height: 1px; background: color-mix(in oklab, var(--i-accent) 30%, transparent); }
.mtl-since-label { font-family: var(--i-mono); font-size: var(--text-3xs); font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--i-accent); white-space: nowrap; }

/* ── 2 · Chats ──────────────────────────────────────────────────────── */
.mtl-seg { flex: 1; display: flex; gap: 3px; padding: 3px;
  border-radius: 10px; background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }
.mtl-seg-opt { flex: 1; text-align: center; padding: 5px 0; border-radius: 7px;
  font-size: var(--text-md); font-weight: 600; color: var(--i-muted); }
.mtl-seg-opt[data-on="true"] { color: var(--i-ink); background: var(--i-accent-soft);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--i-accent) 35%, transparent); }
.mtl-chat { display: flex; align-items: flex-start; gap: 9px; padding: 8px 2px;
  border-bottom: 1px solid var(--i-hairline); }
.mtl-chat-glyph { flex: none; width: 20px; display: grid; place-items: center;
  color: var(--i-dim); padding-top: 2px; }
.mtl-chat-body { flex: 1; min-width: 0; }
.mtl-chat-top { display: flex; align-items: baseline; gap: 6px; }
.mtl-chat-name { font-size: var(--text-lg); font-weight: 500; color: var(--i-ink); }
.mtl-chat[data-unread] .mtl-chat-name { font-weight: 700; }
.mtl-chat-age { margin-left: auto; font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.mtl-chat-preview { margin-top: 2px; font-size: var(--text-sm); line-height: 1.35; color: var(--i-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mtl-chat[data-unread] .mtl-chat-preview { color: var(--i-ink); }
.mtl-unread { flex: none; align-self: center; min-width: 17px; height: 17px; padding: 0 5px;
  border-radius: 999px; background: var(--i-accent); color: var(--i-bg);
  font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 700;
  display: grid; place-items: center; }

/* ── 3 · Composer ───────────────────────────────────────────────────── */
.mtl-compose { gap: 10px; }
.mtl-subbar .mtl-target { flex: 1; padding: 6px 10px; border-radius: 10px; }
.mtl-target { flex: none; display: flex; align-items: center; gap: 10px; padding: 9px 12px;
  border-radius: 12px; background: var(--i-surface); border: 1px solid var(--i-hairline-strong); }
.mtl-target-agent { display: flex; align-items: baseline; gap: 8px; font-size: var(--text-xl);
  font-weight: 600; color: var(--i-ink); }
.mtl-target-sub { font-family: var(--i-mono); font-size: var(--text-2xs); font-weight: 500; color: var(--i-dim); }
.mtl-prompt { flex: none; position: relative; min-height: 118px; padding: 12px;
  border-radius: 14px; background: var(--i-surface);
  border: 1px solid color-mix(in oklab, var(--i-accent) 30%, var(--i-hairline-strong)); }
.mtl-prompt-text { font-size: var(--text-xl); line-height: 1.5; color: var(--i-ink); padding-right: 30px; }
.mtl-mic { position: absolute; right: 10px; bottom: 10px; width: 32px; height: 32px;
  border-radius: 50%; display: grid; place-items: center; color: var(--i-accent);
  background: var(--i-accent-soft); border: 1px solid color-mix(in oklab, var(--i-accent) 35%, transparent); }
.mtl-fields { flex: none; display: grid; gap: 1px; border-radius: 12px; overflow: hidden;
  border: 1px solid var(--i-hairline-strong); }
.mtl-field { display: flex; align-items: center; gap: 10px; padding: 9px 12px; background: var(--i-surface); }
.mtl-field-label { font-family: var(--i-mono); font-size: var(--text-3xs); font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--i-dim); width: 58px; flex: none; }
.mtl-field-value { font-family: var(--i-mono); font-size: var(--text-md); color: var(--i-ink); }
.mtl-field-chev { margin-left: auto; color: var(--i-dim); display: flex; }
.mtl-attach { flex: none; display: flex; gap: 7px; }
.mtl-launch { flex: none; display: flex; align-items: center; justify-content: center; gap: 8px;
  margin-top: auto; margin-bottom: 4px; padding: 12px; border-radius: 13px;
  background: var(--i-accent); color: #04130d; }
.mtl-launch-label { font-size: var(--text-lg); font-weight: 700; }

/* ── 4 · Projects ───────────────────────────────────────────────────── */
.mtl-places { display: grid; gap: 9px; }
.mtl-place { padding: 11px 12px; border-radius: 13px; }
.mtl-place-top { display: flex; align-items: baseline; gap: 8px; }
.mtl-place-name { font-size: var(--text-xl); font-weight: 600; color: var(--i-ink); }
.mtl-place-git { margin-left: auto; font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.mtl-place-git[data-dirty] { color: var(--i-warn); }
.mtl-place-agents { margin-top: 4px; font-size: var(--text-sm); color: var(--i-muted); }
.mtl-place-activity { margin-top: 2px; font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.mtl-place-term { margin-top: 8px; padding-top: 8px; display: flex; align-items: center; gap: 7px;
  border-top: 1px solid var(--i-hairline); color: var(--i-accent);
  font-size: var(--text-sm); font-weight: 500; }

/* ── 5 · Notifications ──────────────────────────────────────────────── */
.mtl-alert { padding: 11px 12px; border-radius: 13px; margin-bottom: 9px; }
.mtl-alert-top { display: flex; align-items: baseline; gap: 8px; }
.mtl-alert-kind { font-family: var(--i-mono); font-size: var(--text-3xs); font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--i-warn); }
.mtl-alert-meta { margin-left: auto; font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.mtl-alert-title { margin-top: 5px; font-size: var(--text-lg); font-weight: 600; line-height: 1.3; color: var(--i-ink); }
.mtl-alert-sub { margin-top: 3px; font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.mtl-alert-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.mtl-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 12px;
  border-radius: 9px; border: 1px solid var(--i-hairline-strong); background: transparent;
  color: var(--i-ink); font-size: var(--text-md); font-weight: 600; }
.mtl-btn[data-primary="true"] { background: var(--i-accent); border-color: var(--i-accent); color: #04130d; }
.mtl-alert-opts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.mtl-opt { padding: 6px 10px; border-radius: 999px; border: 1px solid var(--i-hairline-strong);
  font-size: var(--text-sm); font-weight: 500; color: var(--i-ink); }
.mtl-opt[data-answer="true"] { color: var(--i-accent);
  border-color: color-mix(in oklab, var(--i-accent) 40%, transparent); }
.mtl-fyi { display: flex; align-items: flex-start; gap: 9px; padding: 8px 2px;
  border-bottom: 1px solid var(--i-hairline); }
.mtl-fyi-body { flex: 1; min-width: 0; }
.mtl-fyi-title { font-size: var(--text-md); color: var(--i-muted); }
.mtl-fyi-sub { margin-top: 2px; font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.mtl-dismiss { flex: none; align-self: center; color: var(--i-dim); font-size: 10px; padding: 4px; }
.mtl-clear-note { margin-top: 10px; text-align: center; font-family: var(--i-mono);
  font-size: var(--text-2xs); color: var(--i-dim); }

/* ── 6 · Peek sheet ─────────────────────────────────────────────────── */
.mtl-scrim { position: absolute; inset: 0; z-index: 6; display: flex; align-items: flex-end;
  background: rgba(0,0,0,0.55); }
.mtl-sheet { width: 100%; max-height: 62%; display: flex; flex-direction: column;
  padding: 6px 16px 18px; border-radius: 22px 22px 0 0; background: var(--i-chrome);
  border-top: 1px solid var(--i-card-edge-top); box-shadow: 0 -12px 32px rgba(0,0,0,0.5); }
.mtl-grabber { align-self: center; width: 36px; height: 4px; border-radius: 2px;
  background: var(--i-dim); opacity: 0.6; margin: 4px 0 8px; }
.mtl-sheet-head { display: flex; align-items: baseline; gap: 8px; }
.mtl-sheet-title { font-size: var(--text-2xl); font-weight: 600; color: var(--i-ink); }
.mtl-sheet-sub { font-family: var(--i-mono); font-size: var(--text-2xs); color: var(--i-dim); }
.mtl-sheet-msgs { margin-top: 4px; overflow: hidden; }
.mtl-msg { font-size: var(--text-md); line-height: 1.45; color: var(--i-muted); }
.mtl-sheet-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
`;

/* ════════════════════════════════════════════════════════════════════
   Page.
   ════════════════════════════════════════════════════════════════════ */

export default function MobileTimelineStudy() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <ScoutIOSStyles />
      <style>{MTL_CSS}</style>

      <header className="mb-10 max-w-prose">
        <div className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · ios · mobile-timeline
        </div>
        <h1 className="mt-1 font-display text-6xl font-medium leading-none tracking-tight text-studio-ink">
          Mobile v3 · Fleet Timeline
        </h1>
        <p className="mt-3 font-sans text-lg leading-relaxed text-studio-ink-muted">
          The settled phone shape from{" "}
          <code className="font-mono text-studio-ink">plans/scout-mobile-timeline.md</code>: five destinations —
          Home · Chats · [hex] · Projects · Notifications — with consumption left of the hex and the fleet&rsquo;s
          structure and demands right of it. Home is an X-like feed with a live Working row, Chats is Slack-like,
          the hex is a Codex-like prompting surface, Projects is the places view with contextual terminal access,
          and Notifications is a triage queue where consequential items demand inline action and FYI items only dismiss.
        </p>
      </header>

      <div className="flex flex-wrap items-start gap-x-10 gap-y-10">
        <div>
          <FrameCap k="1 · Home — the X-like feed">
            List filter, the live Working stories row, then the timeline in X anatomy: identity-mark avatar,
            outcome context row, primary-ink line, link cards, dim action row.
          </FrameCap>
          <V3Frame tab="home">
            <HomeScreen />
          </V3Frame>
        </div>

        <div>
          <FrameCap k="2 · Home — list filter, open">
            The chips row becomes one borderless filter button — it reads as a filter, not a tab: no pill on the
            selected value. The menu carries the lists, a divider, and New list….
          </FrameCap>
          <V3Frame tab="home">
            <HomeScreen filterOpen />
          </V3Frame>
        </div>

        <div>
          <FrameCap k="3 · Home — host scope, open">
            The masthead&rsquo;s technical counts become a scope selector: quiet borderless &ldquo;All hosts ⌄&rdquo;,
            per-host rows with online state in the menu.
          </FrameCap>
          <V3Frame tab="home" header={<V3Mast hostMenu />}>
            <HomeScreen />
          </V3Frame>
        </div>

        <div>
          <FrameCap k="4 · Chats — Slack-like">
            Threads involving you, from any origin device. Mine/Channels scope toggle; unread capsules carry the signal.
          </FrameCap>
          <V3Frame tab="chats">
            <ChatsScreen />
          </V3Frame>
        </div>

        <div>
          <FrameCap k="5 · Hex — Codex-like composer">
            A prompting surface, not a chat bubble: primary agent by default, structured project/harness/runtime
            fields, voice affordance, attachments. Feels like launching a task.
          </FrameCap>
          <V3Frame tab="compose">
            <ComposeScreen />
          </V3Frame>
        </div>

        <div>
          <FrameCap k="6 · Projects — the places view">
            What lives where: branch + git state, who&rsquo;s on it, last activity. Terminal access is contextual —
            a shell opens inside a workspace, not from a tab.
          </FrameCap>
          <V3Frame tab="projects">
            <ProjectsScreen />
          </V3Frame>
        </div>

        <div>
          <FrameCap k="7 · Notifications — the action queue">
            Consequential (approvals, questions) vs FYI is structural: deliberate Approve/Deny and Answer affordances
            up top, dismiss-only rows below. Swipe never approves.
          </FrameCap>
          <V3Frame tab="alerts">
            <AlertsScreen />
          </V3Frame>
        </div>

        <div>
          <FrameCap k="8 · Peek sheet — feed row, one layer deep">
            Tap a post: the last few messages of that conversation in a bottom sheet, with Reply / Open thread.
            Full thread stays one tap behind it.
          </FrameCap>
          <V3Frame tab="home" sheet={<PeekSheet />}>
            <HomeScreen />
          </V3Frame>
        </div>
      </div>

      {/* ══ Adoption — the shipped screens as baselines ══════════════════════
          The exercise is how much of v3 lands WITHOUT re-implementing what
          already works. Frames 9–11 render the kit's faithful shipped bodies
          inside the v3 chrome; the map scores every destination. */}
      <header className="mb-8 mt-20 max-w-prose">
        <div className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · adoption — keep what already ships
        </div>
        <h2 className="mt-1 font-display text-4xl font-medium leading-none tracking-tight text-studio-ink">
          Baselines, not rebuilds
        </h2>
        <p className="mt-3 font-sans text-lg leading-relaxed text-studio-ink-muted">
          v3 is a chrome change plus one new surface, not a rewrite. Two destinations adopt their shipped bodies
          verbatim, one gets a single added control, one is a light build on existing data — and only the Home
          feed is genuinely new.
        </p>
      </header>

      <div className="mb-12 grid max-w-[1100px] grid-cols-2 gap-3 md:grid-cols-3">
        {[
          { dest: "Home", verdict: "New build", tone: "new",
            note: "The feed + Working row is the one genuinely new surface — the reason v3 exists." },
          { dest: "Chats", verdict: "Keep · 1 control", tone: "keep",
            note: "Shipped Comms, verbatim. v3 adds only the Mine/Channels seg in the sub bar." },
          { dest: "Hex", verdict: "Keep verbatim", tone: "keep",
            note: "The shipped compose (New session) — dock, smart actions, keyboard. Untouched." },
          { dest: "Projects", verdict: "Light build", tone: "light",
            note: "Places list on the Agents/Projects data we already sync. Moderate, mostly editorial." },
          { dest: "Alerts", verdict: "Keep", tone: "keep",
            note: "The triage queue and the pushed notification detail ship today; the queue only gains the FYI split." },
          { dest: "Chrome", verdict: "New · one pass", tone: "new",
            note: "Mark, host scope, fixed sub bar, five-seat tab bar, bespoke gear — one shared component layer." },
        ].map((m) => (
          <div key={m.dest} className="rounded-[8px] border border-studio-edge bg-studio-canvas-alt p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-sans text-md font-semibold text-studio-ink">{m.dest}</span>
              <span
                className="font-mono text-2xs font-semibold uppercase tracking-[0.12em]"
                style={{ color: m.tone === "new" ? "var(--scout-accent)" : m.tone === "light" ? "#d9a13b" : "var(--studio-ink-faint)" }}
              >
                {m.verdict}
              </span>
            </div>
            <p className="mt-1.5 font-sans text-sm leading-snug text-studio-ink-muted">{m.note}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-x-10 gap-y-10">
        <div>
          <FrameCap k="9 · Chats baseline — shipped Comms">
            The screen the app ships today, verbatim: search field, conversation rows, unread capsules.
            The only body change v3 asks for is the seg above it.
          </FrameCap>
          <V3Frame tab="chats">
            <div className="iBody mtl-body">
              <V3SubBar>
                <div className="mtl-seg">
                  <span className="mtl-seg-opt" data-on="true">Mine</span>
                  <span className="mtl-seg-opt">Channels</span>
                </div>
              </V3SubBar>
              <CommsSurface />
            </div>
          </V3Frame>
        </div>

        <div>
          <FrameCap k="10 · Hex baseline — shipped compose">
            EntrySurface exactly as it ships: docked composer, smart-action line, keyboard up covering the
            tab bar (standard iOS). The hex adopts it untouched — zero reimplementation.
          </FrameCap>
          <V3Frame tab="compose" chrome={false}>
            <EntrySurface />
          </V3Frame>
        </div>

        <div>
          <FrameCap k="11 · Alerts baseline — pushed detail">
            The shipped notification detail, pushed from any alert row: resolve → act → confirm, with
            Open conversation in the triage bar. The peek sheet stays the light layer; this stays the deep one.
          </FrameCap>
          <V3Frame
            tab="alerts"
            chrome={false}
            header={<DetailHeader title="Notification" subtitle="approval · quill · openscout" />}
          >
            <NotificationDetail />
          </V3Frame>
        </div>
      </div>
    </main>
  );
}
