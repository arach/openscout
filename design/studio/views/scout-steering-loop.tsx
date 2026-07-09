"use client";

import { useState, type ReactNode } from "react";
import {
  PhoneShell,
  ScoutIOSStyles,
  Glyph,
  DetailHeader,
  AgentsSurface,
  NewSessionBody,
} from "@/components/scout-ios";
import { SpriteAvatar } from "@/components/SpriteAvatar";

/**
 * Scout · Steering Loop.
 *
 * Scout's surfaces are chat-shaped (rosters + threads), but the operator's real
 * loop is a cycle: DISPATCH work → watch AMBIENT work → get pulled in by
 * ATTENTION. This study rethinks the iOS core surfaces around that loop, as a
 * current ⇄ proposed showcase (frames shown side by side, not toggled away).
 *
 *   A  The loop, diagnosed — the intro + a verified facts row.
 *   B  WORK — lanes that scale down. iPhone current · iPhone summary deck ·
 *      iPad lane deck. The centerpiece.
 *   C  DISPATCH — the session form retires; the destination becomes Home (the
 *      activity feed the app already renders) + an intent-first compose sheet
 *      behind a persistent compose dock (not a floating "+").
 *   D  ATTENTION — a short, honest low-hanging-fruit ledger tied to real
 *      touch points; a full inbox parked deliberately.
 *
 * Phone/tablet content reads only the `--i-*` iOS tokens (dark-locked emerald);
 * everything outside a frame reads the studio `--studio-*` tokens. One accent, a
 * precedence ladder (needs-you ▸ working ▸ idle), never categorical status color.
 */

/* ════════════════════════════════════════════════════════════════════
   Shared studio-token helpers (outside the phone frames).
   ════════════════════════════════════════════════════════════════════ */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
      {children}
    </div>
  );
}
function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-1 font-display text-[19px] font-medium tracking-tight text-studio-ink">{children}</h2>;
}
function Lede({ children }: { children: ReactNode }) {
  return <p className="mb-5 max-w-[82ch] text-[13px] leading-relaxed text-studio-ink-muted">{children}</p>;
}
function Ground({ children }: { children: ReactNode }) {
  return <p className="mt-4 max-w-[92ch] text-[11.5px] leading-snug text-studio-ink-faint">{children}</p>;
}
/** Frame caption — a mono eyebrow over an optional one-line note. */
function FrameCap({ k, tone = "muted", children }: { k: string; tone?: "muted" | "accent"; children?: ReactNode }) {
  return (
    <div className="mb-3">
      <div
        className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: tone === "accent" ? "var(--scout-accent)" : "var(--studio-ink-faint)" }}
      >
        {k}
      </div>
      {children ? <div className="mt-1 max-w-[44ch] text-[11.5px] leading-snug text-studio-ink-muted">{children}</div> : null}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Shared lane model (drives Block B + the compose sheet's steer row).
   ════════════════════════════════════════════════════════════════════ */

type LaneState = "needs" | "working" | "idle" | "offline";
interface Lane {
  name: string;
  project: string;
  harness: string;
  task: string;
  state: LaneState;
  last: string;
  ask?: string;
  events: { t: string; text: string }[];
}

const LANES: Lane[] = [
  {
    name: "broker-smith", project: "openscout", harness: "claude", state: "needs", last: "1m",
    task: "Wiring the in-app session route so a new conversation lands on the operator DM.",
    ask: "Confirm the composer should land on the operator DM, not a fresh channel — before I wire it?",
    events: [
      { t: "09:41:12", text: "Read ScoutSessionService.swift" },
      { t: "09:41:09", text: "Edited ScoutComposeRouting.swift (+8 −2)" },
      { t: "09:41:04", text: "asked · confirm operator DM target" },
    ],
  },
  {
    name: "voice tray", project: "talkie", harness: "codex", state: "needs", last: "3m",
    task: "Restoring the dictation fallback after the HudsonVoice flag gate.",
    ask: "Parakeet or Apple Speech as the fallback when the on-device model is cold?",
    events: [
      { t: "09:38:50", text: "swift build — HudsonVoice gated by flag" },
      { t: "09:38:44", text: "Read ScoutComposeService.swift" },
      { t: "09:38:31", text: "asked · pick a dictation fallback" },
    ],
  },
  {
    name: "session initiation", project: "openscout", harness: "codex", state: "working", last: "now",
    task: "Reconciling POST /api/sessions with the @handle /api/send path so both feed one composer.",
    events: [
      { t: "09:41:15", text: "POST /api/sessions → 200" },
      { t: "09:41:11", text: "Wired SessionInitiationService.start" },
      { t: "09:41:06", text: "Edited create-openscout-web-server.ts (+21 −4)" },
    ],
  },
  {
    name: "tail-tuner", project: "hudson", harness: "codex", state: "working", last: "now",
    task: "Streaming tail tokens through the calmed lanes.",
    events: [
      { t: "09:41:14", text: "streamed 220 tail tokens" },
      { t: "09:41:02", text: "Edited HudTailView.swift (+12 −7)" },
      { t: "09:40:58", text: "Read HudPalette.swift" },
    ],
  },
  {
    name: "theme port", project: "openscout", harness: "claude", state: "idle", last: "41m",
    task: "Ported the ScoutInk contrast lift to the dark presets.",
    events: [
      { t: "09:00:12", text: "git commit — dark-preset contrast lift" },
      { t: "08:58:40", text: "Edited ScoutTheme.swift (+34 −18)" },
    ],
  },
  {
    name: "lattices", project: "lattices", harness: "claude", state: "idle", last: "13h",
    task: "Grid solver — backtracking with constraint propagation.",
    events: [{ t: "yesterday", text: "git commit — solver pass" }],
  },
];

const STATE_RANK: Record<LaneState, number> = { needs: 0, working: 1, idle: 2, offline: 3 };
function lastRank(s: string) {
  if (s === "now") return 0;
  const m = s.match(/^(\d+)\s*m/); if (m) return +m[1];
  const h = s.match(/^(\d+)\s*h/); if (h) return +h[1] * 60;
  const d = s.match(/^(\d+)\s*d/); if (d) return +d[1] * 1440;
  if (s === "yesterday") return 1440;
  return 9999;
}
function sortLanes(a: Lane, b: Lane) {
  return STATE_RANK[a.state] - STATE_RANK[b.state] || lastRank(a.last) - lastRank(b.last);
}
function stateWord(s: LaneState) {
  return s === "needs" ? "needs you" : s;
}
function handleOf(name: string) {
  return name.replace(/\s+/g, "-");
}

/* ── sprite + a corner state dot (phone tokens, not studio) ─────────── */
function CornerAvatar({ name, state, size = 24 }: { name: string; state?: LaneState; size?: number }) {
  return (
    <span className="ssl-avatar" style={{ width: size, height: size }}>
      <SpriteAvatar name={name} size={size} />
      {state ? <span className={`ssl-corner ${state}`} /> : null}
    </span>
  );
}

/* ── the lane "cockpit" — shared by the iPhone deck card + iPad lane ──
   Task leads as the title; the agent + project demote to an attribution line
   under it (the sprite stays). No corner state dot — sort + accent border +
   the status word already carry state; a fourth encoding is just anxiety. */
function CockpitContent({ lane, drill }: { lane: Lane; drill?: boolean }) {
  return (
    <>
      <div className="ssl-card-task">{lane.task}</div>
      <div className="ssl-card-attr-row">
        <CornerAvatar name={lane.name} size={20} />
        <span className="ssl-card-name">{lane.name}</span>
        <span className="ssl-card-attr">{lane.project} · {lane.harness}</span>
        {drill ? <span className="ssl-card-open"><Glyph kind="chevron" size={13} /></span> : null}
      </div>
      {lane.ask ? <div className="ssl-card-ask">&ldquo;{lane.ask}&rdquo;</div> : null}
      <div className="ssl-card-status">
        <span className={`ssl-card-word ${lane.state}`}>{stateWord(lane.state)}</span>
        <span className="ssl-card-dot">·</span>
        <span className="ssl-card-last">{lane.last}</span>
      </div>
    </>
  );
}

/* ── the horizon dial (compact segmented control) ───────────────────── */
const HORIZONS = ["5m", "30m", "4h", "24h"];
function Horizon({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <div className="ssl-horizonwrap">
      {label ? <span className="ssl-horizoncap">{label}</span> : null}
      <div className="ssl-horizon">
        {HORIZONS.map((o) => (
          <button key={o} type="button" className={o === value ? "on" : ""} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── a local mic glyph (kit's MicGlyph is not exported) ──────────────── */
function MicGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

/* ── proposed bottom chrome — the tab bar retires "New" (Home · Work ·
   Tail · Comms) and a persistent compose accessory docks above it
   (iOS-26 tabViewBottomAccessory, the Music mini-player pattern). ─────── */
const PROPOSED_TABS: { label: string; kind: "home" | "agents" | "pulse" | "comms" }[] = [
  { label: "Home", kind: "home" },
  { label: "Work", kind: "agents" },
  { label: "Tail", kind: "pulse" },
  { label: "Comms", kind: "comms" },
];
function ComposeAccessory() {
  return (
    <div className="ssl-accessory">
      <span className="ssl-accessory-plus"><Glyph kind="plus" size={15} /></span>
      <span className="ssl-accessory-text">New conversation…</span>
      <span className="ssl-accessory-mic"><MicGlyph size={15} /></span>
    </div>
  );
}
function ProposedTabs({ active }: { active: string }) {
  return (
    <div className="ssl-tabbar">
      {PROPOSED_TABS.map((t) => (
        <div key={t.label} className="ssl-tab" data-on={t.label === active}>
          <span className="ssl-tab-icon"><Glyph kind={t.kind} size={19} /></span>
          <span className="ssl-tab-label">{t.label}</span>
        </div>
      ))}
    </div>
  );
}

/** The proposed phone chrome: a body, then the persistent compose accessory,
 *  then the retired-"New" tab bar. The optional sheet overlays the whole screen
 *  (its scrim covers the accessory + tab bar). */
function ProposedFrame({ active, children, sheet }: { active: string; children: ReactNode; sheet?: ReactNode }) {
  return (
    <PhoneShell surface="agents" variant="shipped" showChrome={false} header={<PlainMast />}>
      {children}
      <ComposeAccessory />
      <ProposedTabs active={active} />
      {sheet}
    </PhoneShell>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Block A — the loop, diagnosed.
   ════════════════════════════════════════════════════════════════════ */

const FACTS: { n: string; title: string; body: ReactNode; ref: string }[] = [
  {
    n: "01",
    title: "“New conversation” is two machines wearing one name",
    body: (
      <>
        The macOS composer modal opens <code className="ssl-code">POST /api/sessions</code> — up to ~8 decisions before a
        first message. The HUD dock opens <code className="ssl-code">POST /api/send</code> with an <code className="ssl-code">@handle</code> envelope:
        intent-first, type-and-go.
      </>
    ),
    ref: "ScoutSessionService.swift · ScoutComposeService.swift · ScoutComposeRouting.swift",
  },
  {
    n: "02",
    title: "The ask contract survives — but its source was deleted",
    body: (
      <>
        The <code className="ssl-code">ScoutConversationAsk</code> type and its native decoder still run end-to-end, but{" "}
        <code className="ssl-code">#287</code> (&ldquo;Remove unblock request flow&rdquo;) cut the ask&rsquo;s source — the web service went from{" "}
        <code className="ssl-code">ask ? {"{ ask }"} : {"{}"}</code> to a hardcoded <code className="ssl-code">askField = {"{}"}</code>. No surface
        anywhere renders ask text today; the pipeline carries a shape with nothing to fill it, and even the macOS pinned ask band is dark.
      </>
    ),
    ref: "core/conversations/service.ts:579 · commit a638f404 (#287)",
  },
  {
    n: "03",
    title: "Attention is dormant at the source",
    body: (
      <>
        <code className="ssl-code">/api/agents</code> only ever emits <code className="ssl-code">working · in_flight · available</code> — both summarizers
        void their inputs — so every needs-you surface downstream is starved, even though the fleet query already computes the
        awaiting-operator signal.
      </>
    ),
    ref: "create-openscout-web-server.ts:1720 · sql-helpers.ts:131 · fleet.ts:353",
  },
  {
    n: "04",
    title: "iOS guesses “needs you” from a string",
    body: (
      <>
        With no real signal, iOS infers attention by sniffing <code className="ssl-code">[ask:</code> at the front of the last message
        preview.
      </>
    ),
    ref: "CommsSurface.swift:233",
  },
];

function BlockA() {
  return (
    <section className="mb-16">
      <Eyebrow>Block A · Diagnosis — the loop underneath the chat</Eyebrow>
      <H2>Chat-shaped surfaces, a loop-shaped operator</H2>
      <Lede>
        Scout&rsquo;s iOS surfaces are chat-shaped — rosters and threads. But the operator&rsquo;s actual loop is a cycle:
        dispatch work, watch it happen ambiently, and get pulled in only when an agent needs a decision. The roster shows who
        exists; it doesn&rsquo;t show the work, and it can&rsquo;t show attention because attention never arrives.
      </Lede>

      <div className="ssl-loop">
        <div className="ssl-loop-node">
          <span className="ssl-loop-k">01 · Dispatch</span>
          <span className="ssl-loop-v">start work, intent-first</span>
        </div>
        <span className="ssl-loop-arrow">→</span>
        <div className="ssl-loop-node">
          <span className="ssl-loop-k">02 · Ambient work</span>
          <span className="ssl-loop-v">watch the swarm at a calm cadence</span>
        </div>
        <span className="ssl-loop-arrow">→</span>
        <div className="ssl-loop-node accent">
          <span className="ssl-loop-k">03 · Attention</span>
          <span className="ssl-loop-v">pulled in when an agent needs you</span>
        </div>
        <span className="ssl-loop-arrow">↺</span>
      </div>
      <p className="mt-2 font-mono text-[10px] text-studio-ink-faint">
        The dashed link is the starved one — attention has no source today.
      </p>

      <div className="mt-7 grid max-w-[92ch] gap-3" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        {FACTS.map((f) => (
          <div key={f.n} className="rounded-[10px] border border-studio-edge bg-studio-surface p-3.5">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] font-bold text-studio-ink-faint">{f.n}</span>
              <span className="text-[12.5px] font-semibold leading-snug text-studio-ink">{f.title}</span>
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-studio-ink-muted">{f.body}</p>
            <div className="mt-2.5 font-mono text-[9px] leading-snug text-studio-ink-faint">{f.ref}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Block B — WORK: lanes that scale down (the centerpiece).
   ════════════════════════════════════════════════════════════════════ */

/** iPhone current — the faithful shipped Agents surface (kit port). */
function CurrentAgents() {
  const [sort, setSort] = useState<"project" | "recent">("project");
  return <AgentsSurface sort={sort} onSort={setSort} />;
}

/** iPhone proposed — the summary deck of lane cockpits.
 *  No horizon dial on the phone (it has no referent here); search arrives as a
 *  pull-down `.searchable` when fleets grow. The needs count is pinned so it can
 *  never truncate. */
function SummaryDeck() {
  const lanes = [...LANES].sort(sortLanes);
  const needs = lanes.filter((l) => l.state === "needs").length;
  return (
    <div className="iBody">
      <div className="ssl-deckhead">
        <span className="iSecLabel">· Work · {LANES.length} lanes</span>
        {needs ? <span className="ssl-deck-needs">{needs} need you</span> : null}
      </div>
      {lanes.map((l) => (
        <div key={l.name} className={`ssl-card ${l.state === "needs" ? "needs" : ""}`}>
          <CockpitContent lane={l} drill />
        </div>
      ))}
    </div>
  );
}

/** iPad proposed — one full lane: cockpit over its real event stream.
 *  Needs-you lanes take the accent focus treatment (and CockpitContent surfaces
 *  the quoted ask). A quiet/idle lane rests on a single "last: …" line instead
 *  of showing a void below a sparse stream. Streams anchor newest-at-top. */
function AgentLane({ lane }: { lane: Lane }) {
  const resting = lane.state === "idle";
  return (
    <div className={`ssl-lane ${lane.state === "needs" ? "ssl-lane-pinned" : ""}`}>
      <div className={`ssl-lane-cockpit ${lane.state === "needs" ? "needs" : ""}`}>
        <CockpitContent lane={lane} />
      </div>
      <div className="ssl-lane-stream">
        <div className="ssl-lane-streamcap">Stream · newest first</div>
        {resting ? (
          <div className="ssl-lane-rest">
            <span className="ssl-lane-rest-k">last</span>
            <span className="ssl-lane-rest-v">{lane.events[0]?.text} · {lane.last} ago</span>
          </div>
        ) : (
          lane.events.map((e, i) => (
            <div key={i} className="ssl-ev">
              <span className="ssl-ev-time">{e.t}</span>
              <span className="ssl-ev-text">{e.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** The right-edge overflow rail — a narrow vertical strip of the lanes that
 *  didn't fit at this width tier. Tap to bring one into the deck. */
function OverflowRail({ lanes }: { lanes: Lane[] }) {
  return (
    <div className="ssl-overflow">
      <span className="ssl-overflow-count">+{lanes.length}</span>
      <div className="ssl-overflow-list">
        {lanes.map((l) => (
          <span key={l.name} className="ssl-overflow-item">
            <CornerAvatar name={l.name} size={20} />
          </span>
        ))}
      </div>
      <span className="ssl-overflow-cap">more</span>
    </div>
  );
}

function LaneDeckTablet() {
  const [h, setH] = useState("30m");
  const needsLanes = LANES.filter((l) => l.state === "needs");   // pinned left, accent
  const working = LANES.filter((l) => l.state === "working");
  const idle = LANES.filter((l) => l.state === "idle");
  // Density tier: two pinned needs lanes + one visibly-quiet idle lane sit in
  // view; the live working lane bleeds off the right edge (scroll hint). The
  // rest fall to the overflow rail.
  const shown = [...needsLanes, idle[0], working[0]].filter(Boolean) as Lane[];
  const overflow = [working[1], idle[1]].filter(Boolean) as Lane[];
  return (
    <div className="scoutios" data-v="shipped">
      <div className="ssl-pad">
        <div className="ssl-pad-screen">
          <div className="ssl-pad-top">
            <div className="ssl-pad-nav">
              {PROPOSED_TABS.map((t) => (
                <span key={t.label} className={`ssl-pad-navpill ${t.label === "Work" ? "on" : ""}`}>
                  <Glyph kind={t.kind} size={13} />
                  {t.label}
                </span>
              ))}
            </div>
            <span style={{ marginLeft: "auto" }}>
              <Horizon value={h} onChange={setH} label="Window" />
            </span>
          </div>
          <div className="ssl-pad-lanes">
            <div className="ssl-pad-scroll">
              {shown.map((l) => (
                <AgentLane key={l.name} lane={l} />
              ))}
            </div>
            <OverflowRail lanes={overflow} />
          </div>
        </div>
      </div>
    </div>
  );
}

function BlockB() {
  return (
    <section className="mb-16">
      <Eyebrow>Block B · WORK — one lane atom, three tiers</Eyebrow>
      <H2>Lanes that scale down</H2>
      <Lede>
        The centerpiece. Today the phone shows a directory tree — who exists, not what they&rsquo;re doing. The proposal is a
        deck of lane <em>cockpits</em>: the same summary atom the web Lanes surface already ships, resized. Each card leads with
        the work (task-as-title), demotes the agent to an attribution line, and speaks a single accent as a precedence ladder —
        needs-you ▸ working ▸ idle. When an agent needs you, one quoted line of the actual ask appears and the card takes an
        accent border (a focus treatment, never a left bar).
      </Lede>

      <div className="flex flex-wrap items-start gap-x-10 gap-y-8">
        <div>
          <FrameCap k="iPhone · current">
            The shipped Agents directory: a project·agent tree and an &ldquo;N live&rdquo; summary bar. No task, no attention signal.
          </FrameCap>
          <PhoneShell surface="agents" variant="shipped">
            <CurrentAgents />
          </PhoneShell>
        </div>

        <div>
          <FrameCap k="iPhone · proposed — summary deck" tone="accent">
            A stack of lane cockpits, sorted needs ▸ working ▸ recent — no horizon dial (it has no referent on the phone; search
            arrives as a pull-down <code className="ssl-code">.searchable</code> when fleets grow). Tap a card to drill into that
            one full lane (chevron-hinted). The persistent compose pill docks above the retired-&ldquo;New&rdquo; tab bar.
            <br />
            <span className="ssl-dep">Needs-you accent border is contingent on ledger rows 1–2 — the signal reaches no client today.</span>
          </FrameCap>
          <ProposedFrame active="Work">
            <SummaryDeck />
          </ProposedFrame>
        </div>
      </div>

      <div className="mt-10">
        <FrameCap k="iPad · proposed — lane deck" tone="accent">
          Two needs-you lanes pinned leftmost — each a full cockpit (accent border + quoted ask) over its real event stream, not
          a summary card. Healthy lanes sit to the right; the idle one rests on a &ldquo;last: … · 41m ago&rdquo; line instead of a
          void. A right-edge rail overflows the lanes that don&rsquo;t fit this tier; lanes snap-scroll horizontally. A minimal top
          row carries the floating tab bar (Home · Work · Tail · Comms) and the horizon dial — here it has a referent (the streams).
          <br />
          <span className="ssl-dep">
            Web pins its attention lane only opt-in (via the &ldquo;+ Lane&rdquo; menu); this study proposes pinning it by default — and
            bounds it deliberately: reply and open only, no approve/deny/dismiss/archive (or the parked inbox creeps back). Reply
            happens through the persistent compose pill, pre-targeted; tap focuses the lane. Contingent on ledger rows 1–2.
          </span>
        </FrameCap>
        <div className="overflow-x-auto pb-2">
          <LaneDeckTablet />
        </div>
      </div>

      <Ground>
        Grounding: the web deck is TypeScript reference <em>anatomy</em>, not portable code. The cockpit
        (<code className="ssl-code">AgentLaneCockpitPane</code>) sits above the trace stream in <code className="ssl-code">screens/ops/AgentLaneCard.tsx</code>, and the deck
        model at <code className="ssl-code">screens/ops/lane-deck.ts</code> carries per-surface profiles (<code className="ssl-code">web.ops</code> ·{" "}
        <code className="ssl-code">macos.lanes</code> · <code className="ssl-code">hud.tail</code>) with width tiers
        (<code className="ssl-code">sm 408 · md 512 · lg 616</code>) — so the phone is a &ldquo;summary-only&rdquo; tier and the iPad a natural
        fourth profile: the <em>shape</em> ports, the code doesn&rsquo;t. Two honest gaps: the real web cockpit renders a trace-head
        plus tool/edit/token stats (richer than drawn), and task-as-title has no bridge source yet — it needs the{" "}
        <code className="ssl-code">mobile/agents</code> payload extended to carry the current task. Port notes: the stop/interrupt
        verb lives in a drilled lane&rsquo;s <code className="ssl-code">⋯</code> overflow (the lifecycle-in-overflow precedent), so the
        phone keeps an interrupt story; studio sizes are a rendering style — native maps name → subheadline (15), task →
        subheadline, attribution → caption2 (11) floor, all under Dynamic Type. Motion: the state dot is static; a single pulse
        fires on state-change only, and Reduce Motion is respected.
      </Ground>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Block C — DISPATCH: the feed and the compose dock.
   ════════════════════════════════════════════════════════════════════ */

/** A tiny up-down chevron — marks a routing fact as tappable (a menu opens). */
function ChevUpDown() {
  return (
    <svg className="ssl-chev-ud" width="8" height="11" viewBox="0 0 8 11" fill="none"
      stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4l2-2 2 2M2 7l2 2 2-2" />
    </svg>
  );
}

interface FeedItem { agent: string; project: string; harness: string; summary: string; time: string; group: "now" | "earlier"; needs?: boolean; ask?: string; }
const FEED: FeedItem[] = [
  // Needs-you rows — the one upgrade over today: an accent treatment + the
  // quoted ask. (Today every feed row renders identically.)
  {
    agent: "broker-smith", project: "openscout", harness: "claude", needs: true, time: "1m", group: "now",
    summary: "asked · confirm the composer's landing target",
    ask: "Land the composer on the operator DM, not a fresh channel — confirm before I wire it?",
  },
  {
    agent: "voice tray", project: "talkie", harness: "codex", needs: true, time: "3m", group: "now",
    summary: "asked · pick a dictation fallback",
    ask: "Parakeet or Apple Speech as the cold-start fallback?",
  },
  // Ambient agent→agent traffic — kept on purpose: steering by observation.
  { agent: "session initiation", project: "openscout", harness: "codex", time: "now", group: "now", summary: "→ broker-smith · reconciled the create + send paths" },
  { agent: "tail-tuner", project: "hudson", harness: "codex", time: "2m", group: "now", summary: "streamed 220 tail tokens through the calmed lanes" },
  { agent: "theme port", project: "openscout", harness: "claude", time: "41m", group: "earlier", summary: "committed the ScoutInk contrast lift to the dark presets" },
];

/** A feed row. Tap navigates into that agent's conversation; a trailing swipe
 *  reveals "Steer" (the pre-targeted compose sheet). Needs-you rows carry an
 *  accent rail + the quoted ask. */
function FeedRow({ f, swiped }: { f: FeedItem; swiped?: boolean }) {
  return (
    <div className={`ssl-feed-rowwrap ${swiped ? "swiped" : ""}`}>
      <span className="ssl-feed-steer">Steer</span>
      <div className={`ssl-feed-row ${f.needs ? "needs" : ""}`}>
        {f.needs ? <span className="ssl-feed-rail" /> : null}
        <CornerAvatar name={f.agent} size={24} />
        <div className="ssl-feed-body">
          <div className="ssl-feed-line"><b>{f.agent}</b> {f.summary}</div>
          {f.needs && f.ask ? <div className="ssl-feed-ask">&ldquo;{f.ask}&rdquo;</div> : null}
          <div className="ssl-feed-meta">{f.project} · {f.harness}</div>
        </div>
        <span className="ssl-feed-time">{f.time}</span>
      </div>
    </div>
  );
}

/** Home — the activity feed the app already renders (mobile/activity), upgraded
 *  so needs-you rows read at a glance. `swipeRow` draws one row mid-swipe. */
function HomeFeed({ swipeRow }: { swipeRow?: string }) {
  const now = FEED.filter((f) => f.group === "now");
  const earlier = FEED.filter((f) => f.group === "earlier");
  return (
    <div className="iBody">
      <div className="ssl-deckhead">
        <span className="iSecLabel">· Home · latest activity</span>
      </div>
      <div className="ssl-feedgroup">· now</div>
      {now.map((f, i) => (
        <div key={f.agent + f.time}>
          {i > 0 ? <div className="ssl-feed-sep" /> : null}
          <FeedRow f={f} swiped={swipeRow === f.agent} />
        </div>
      ))}
      <div className="ssl-feedgroup">· earlier</div>
      {earlier.map((f, i) => (
        <div key={f.agent + f.time}>
          {i > 0 ? <div className="ssl-feed-sep" /> : null}
          <FeedRow f={f} />
        </div>
      ))}
    </div>
  );
}

/** The @-row lists ALL agents, recency-sorted — idle included (dispatching to an
 *  idle agent with warm context is the most common steer). */
const AGENTS_BY_RECENCY = [...LANES].sort((a, b) => lastRank(a.last) - lastRank(b.last));

/** A stylized iOS keyboard slab — the sheet's primary state is keyboard-up. */
function Keyboard() {
  const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  return (
    <div className="ssl-keyboard" aria-hidden>
      {rows.map((r, ri) => (
        <div key={ri} className={`ssl-kbrow ${ri === 1 ? "indent" : ""}`}>
          {ri === 2 ? <span className="ssl-key ssl-key-mod">⇧</span> : null}
          {r.split("").map((c) => <span key={c} className="ssl-key">{c}</span>)}
          {ri === 2 ? <span className="ssl-key ssl-key-mod">⌫</span> : null}
        </div>
      ))}
      <div className="ssl-kbrow ssl-kbrow-last">
        <span className="ssl-key ssl-key-wide">123</span>
        <span className="ssl-key ssl-key-space">space</span>
        <span className="ssl-key ssl-key-wide ssl-key-go">return</span>
      </div>
    </div>
  );
}

/** The compose sheet — a real bottom sheet: a scrim over the whole screen
 *  (accessory + tab bar included), a grabber, the message well first (mic +
 *  accent send inside it), a human routing line, the @-row, keyboard-up. */
function ComposeSheet({ preTarget }: { preTarget?: string }) {
  const [target, setTarget] = useState<string | null>(preTarget ?? null);
  const steer = target != null;
  const tLane = LANES.find((l) => l.name === target);
  return (
    <>
      <div className="ssl-scrim" />
      <div className="ssl-sheet">
        <div className="ssl-sheet-grip" />
        {/* well FIRST — intent-first; mic + accent up-arrow send live inside it */}
        <div className="ssl-sheet-well">
          <span className="ssl-well-mic"><MicGlyph size={16} /></span>
          <span className="ssl-well-text">New conversation…<span className="iComposerCaret" /></span>
          <span className="ssl-well-send"><Glyph kind="arrow" size={15} rotate={-90} /></span>
        </div>
        {/* routing preview — human SF text; mono is reserved for the path only */}
        <div className="ssl-route">
          <span className="ssl-route-lead">To:</span>
          {steer ? (
            <>
              <span className="ssl-route-verb">{target}</span>
              <span className="ssl-route-cont">— continues their conversation</span>
              <span className="ssl-route-path">{tLane?.project} · {tLane?.harness}</span>
            </>
          ) : (
            <>
              <span className="ssl-route-verb">new conversation</span>
              <span className="ssl-route-dash">—</span>
              <span className="ssl-rchip">scout-web<ChevUpDown /></span>
              <span className="ssl-rchip">claude<ChevUpDown /></span>
              <span className="ssl-route-path">~/dev/openscout</span>
            </>
          )}
        </div>
        {/* @-row — all agents, recency-sorted, horizontally scrollable (a pill
            bleeds off the edge to signal scroll); typed-@ autocompletes too */}
        <div className="ssl-atrow">
          {AGENTS_BY_RECENCY.map((l) => (
            <span
              key={l.name}
              className={`ssl-at ${target === l.name ? "on" : ""}`}
              onClick={() => setTarget(target === l.name ? null : l.name)}
            >
              <CornerAvatar name={l.name} size={18} />
              <span className="ssl-at-handle">@{handleOf(l.name)}</span>
            </span>
          ))}
        </div>
        <Keyboard />
      </div>
    </>
  );
}

/** The corrected-state inset — a routing fact tapped opens a small menu over the
 *  sheet: the workspace chip listing the projects from mobile/workspaces with
 *  per-harness readiness. Decisions become corrections, drawn not asserted. */
function ChipMenuInset() {
  const workspaces = [
    { name: "scout-web", path: "~/dev/openscout", ready: "ready" },
    { name: "hudson", path: "~/dev/hudson", ready: "configured" },
    { name: "talkie", path: "~/dev/talkie", ready: "missing" },
  ];
  return (
    <div className="scoutios" data-v="shipped">
      <div className="ssl-inset">
        <div className="ssl-inset-route">
          <span className="ssl-route-lead">To:</span>
          <span className="ssl-route-verb">new conversation</span>
          <span className="ssl-route-dash">—</span>
          <span className="ssl-rchip on">scout-web<ChevUpDown /></span>
          <span className="ssl-rchip">claude<ChevUpDown /></span>
        </div>
        <div className="ssl-menu">
          <div className="ssl-menu-cap">Workspace · 3</div>
          {workspaces.map((w) => (
            <div key={w.name} className={`ssl-menu-item ${w.name === "scout-web" ? "on" : ""}`}>
              <span className={`ssl-menu-dot r-${w.ready}`} />
              <span className="ssl-menu-name">{w.name}</span>
              <span className="ssl-menu-path">{w.path}</span>
              {w.name === "scout-web" ? <span className="ssl-menu-check"><Glyph kind="check" size={12} /></span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The lock-screen path — three mini-states: a notification quoting the ask →
 *  tap opens the sheet pre-targeted with the ask quoted → send. Pocket to
 *  answered in two taps. */
function LockScreenStrip() {
  const ask = "Land the composer on the operator DM, not a fresh channel — confirm before I wire it?";
  return (
    <div className="scoutios" data-v="shipped">
      <div className="ssl-lock-strip">
        <div className="ssl-lock">
          <div className="ssl-lock-cap">1 · locked</div>
          <div className="ssl-lock-face">
            <div className="ssl-lock-time">9:41</div>
            <div className="ssl-lock-date">Monday · July 6</div>
            <div className="ssl-lock-notif">
              <div className="ssl-lock-notif-top">
                <CornerAvatar name="broker-smith" size={15} />
                <span className="ssl-lock-notif-name">broker-smith</span>
                <span className="ssl-lock-notif-age">now</span>
              </div>
              <div className="ssl-lock-notif-body">&ldquo;{ask}&rdquo;</div>
            </div>
          </div>
        </div>
        <span className="ssl-lock-arrow"><Glyph kind="arrow" size={14} /></span>
        <div className="ssl-lock">
          <div className="ssl-lock-cap">2 · tap → sheet</div>
          <div className="ssl-lock-face dim">
            <div className="ssl-lock-sheet">
              <div className="ssl-lock-sheet-grip" />
              <div className="ssl-lock-quote">&ldquo;{ask}&rdquo;</div>
              <div className="ssl-lock-route">
                <span className="ssl-route-lead">To:</span>
                <span className="ssl-route-verb">broker-smith</span>
                <span className="ssl-lock-route-cont">— continues</span>
              </div>
              <div className="ssl-lock-well">
                <span className="ssl-lock-well-text">Yes — the operator DM.<span className="iComposerCaret" /></span>
                <span className="ssl-well-send sm"><Glyph kind="arrow" size={13} rotate={-90} /></span>
              </div>
            </div>
          </div>
        </div>
        <span className="ssl-lock-arrow"><Glyph kind="arrow" size={14} /></span>
        <div className="ssl-lock">
          <div className="ssl-lock-cap">3 · answered</div>
          <div className="ssl-lock-face">
            <div className="ssl-lock-sent">
              <span className="ssl-lock-sent-mark"><Glyph kind="check" size={18} /></span>
              <span className="ssl-lock-sent-title">Sent to broker-smith</span>
              <span className="ssl-lock-sent-sub">it&rsquo;s back to work</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** RootView masthead — "Scout" wordmark + gear. No compose "+": the persistent
 *  compose accessory above the tab bar is the one dispatch entry now. */
function PlainMast() {
  return (
    <div className="iHead">
      <div className="iMast">
        <span className="iWordmark">Scout</span>
        <span className="iGear"><Glyph kind="gear" size={20} /></span>
      </div>
      <div className="iMastRule" />
    </div>
  );
}

function BlockC() {
  return (
    <section className="mb-16">
      <Eyebrow>Block C · DISPATCH — the feed and the compose dock</Eyebrow>
      <H2>The form retires; the default becomes visible</H2>
      <Lede>
        Today the dispatch destination is a multi-step New session form (project → agent → model → prompt). The proposal
        promotes the HUD dock&rsquo;s grammar — intent-first, @-routing — to the phone: the destination becomes Home (the
        activity feed the app already renders), and a persistent compose pill — docked above the tab bar, not a floating button —
        opens a sheet with the message box first. The decisions don&rsquo;t vanish; they become corrections to a visible default.
      </Lede>

      <div className="flex flex-wrap items-start gap-x-10 gap-y-8">
        <div>
          <FrameCap k="iPhone · current — the New session form">
            Project → agent → model → prompt → submit. Every dispatch pays the full toll up front — this is{" "}
            <code className="ssl-code">mobile/session/create</code>&rsquo;s payload, spelled out as a form.
          </FrameCap>
          <PhoneShell
            surface="agents"
            variant="shipped"
            showChrome={false}
            header={<DetailHeader title="New session" subtitle="openscout · studio" />}
          >
            <NewSessionBody />
          </PhoneShell>
        </div>

        <div>
          <FrameCap k="iPhone · proposed — Home (activity, upgraded)" tone="accent">
            The same feed <code className="ssl-code">mobile/activity</code> already renders, re-sited as Home. Needs-you rows get
            the accent (rail + quoted ask); agent→agent chatter stays — steering by observation. Tapping a row navigates into
            that conversation; a trailing swipe reveals <em>Steer</em> (drawn on the tail-tuner row). The compose pill docks above
            the tab bar.
          </FrameCap>
          <ProposedFrame active="Home">
            <HomeFeed swipeRow="tail-tuner" />
          </ProposedFrame>
        </div>

        <div>
          <FrameCap k="iPhone · proposed — the compose sheet" tone="accent">
            A real sheet, keyboard-up: the message well first (mic + an accent send inside it), then a human routing line whose
            facts are tappable chips, then the @-row — all agents, recency-sorted, scrollable. Tap an agent to flip{" "}
            <em>new conversation</em> → <em>steer</em>; the scrim covers the accessory + tab bar.
          </FrameCap>
          <ProposedFrame active="Home" sheet={<ComposeSheet />}>
            <HomeFeed />
          </ProposedFrame>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-start gap-x-12 gap-y-9">
        <div>
          <FrameCap k="corrected state — a chip tapped" tone="accent">
            The &ldquo;decisions become corrections&rdquo; claim, drawn: tap the workspace chip and a menu opens over the sheet —
            the three projects from <code className="ssl-code">mobile/workspaces</code>, each with a per-harness readiness dot
            (ready · configured · missing).
          </FrameCap>
          <ChipMenuInset />
        </div>
        <div>
          <FrameCap k="lock-screen — the #1 phone steer" tone="accent">
            The most common phone path: a lock-screen notification quotes the ask → tap opens the sheet pre-targeted, the ask
            quoted above the well → send. Pocket to answered in two taps.
          </FrameCap>
          <LockScreenStrip />
        </div>
      </div>

      <Ground>
        Grounding: the phone never speaks <code className="ssl-code">POST /api/send</code> — the iOS bridge has its own RPCs that
        back this UI directly. <code className="ssl-code">mobile/message/send</code> takes an explicit <code className="ssl-code">agentId</code> +{" "}
        <code className="ssl-code">body</code> (the @-chip semantics, exactly); <code className="ssl-code">mobile/session/create</code> takes{" "}
        <code className="ssl-code">workspaceId</code>/<code className="ssl-code">harness</code>/<code className="ssl-code">model</code>/<code className="ssl-code">seed</code> (the create
        path); <code className="ssl-code">mobile/workspaces</code> carries the project inventory + per-harness readiness that fills the
        routing chips (<code className="ssl-code">bridge/server.ts:633–732</code>). And the feed isn&rsquo;t new machinery:{" "}
        <code className="ssl-code">mobile/activity</code> is a curated, name-resolved, thread-linked feed{" "}
        <em>already consumed</em> by iOS <code className="ssl-code">HomeSurface.swift</code> — this is a re-siting + accent upgrade of a
        shipped surface, not new plumbing.
      </Ground>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Block D — ATTENTION: low-hanging fruit only (the ledger).
   ════════════════════════════════════════════════════════════════════ */

type Disposition = "ship" | "refine" | "defer";
const DISPO: Record<Disposition, { label: string; bg: string; fg: string }> = {
  ship: { label: "Ship", bg: "var(--status-ok-bg)", fg: "var(--status-ok-fg)" },
  refine: { label: "Refine", bg: "var(--status-info-bg)", fg: "var(--status-info-fg)" },
  defer: { label: "Defer", bg: "var(--status-neutral-bg)", fg: "var(--status-neutral-fg)" },
};

const ATTN_LEDGER: { change: string; layer: string; dispo: Disposition; where: ReactNode }[] = [
  {
    change: "Emit needs_attention from the /api/agents state summarizers",
    layer: "Server",
    dispo: "ship",
    where: (
      <>
        <code className="ssl-code">summarizeBrokerAgentState</code> (create-openscout-web-server.ts:1720) and{" "}
        <code className="ssl-code">summarizeAgentState</code> (sql-helpers.ts:131) void their inputs and return only
        working·in_flight·available; the fleet query already computes the awaiting-operator signal (fleet.ts:353). One server
        change lights four macOS/HUD surfaces free — local notifications + dock badge, the HUD AttentionPip + PENDING ASK block,
        and the macOS Agents-tree warn dot. (Local macOS notifications fire today; the APNs question/approval push trigger is
        still an open gap — not shipped.)
      </>
    ),
  },
  {
    change: "iOS bridge: extend mobile state + wire enum + mapping",
    layer: "Server + Client",
    dispo: "refine",
    where: (
      <>
        iOS doesn&rsquo;t ride row 1 free: the bridge computes its own state (<code className="ssl-code">buildMobileAgentSummary</code>,
        mobile/service.ts:424–447 → working·available·offline) and the wire enum (<code className="ssl-code">AgentSummary.State</code>,
        Listing.swift:69 → live·idle·offline·unknown) has no needs-attention case. Add the case to both, plus the mapping between them.
      </>
    ),
  },
  {
    change: "Choose the ask's new source, then repopulate it",
    layer: "Server",
    dispo: "ship",
    where: (
      <>
        #287 deleted the ask&rsquo;s source (core/conversations/service.ts:579 now hardcodes <code className="ssl-code">askField = {"{}"}</code>),
        so this isn&rsquo;t un-stubbing — it&rsquo;s a decision: pick the source of truth (fleet asks vs{" "}
        <code className="ssl-code">collaboration_records</code> questions), then plumb it into web <em>and</em> the{" "}
        <code className="ssl-code">mobile/*</code> payloads. The type + native decoder already exist to carry it.
      </>
    ),
  },
  {
    change: "Render ask text as one quiet line in rows",
    layer: "Client",
    dispo: "ship",
    where: (
      <>
        Once ask text is real, show it inline — the macOS Agents tree and the iOS deck cards as drawn in Block B. Rides on the
        two server rows above; no new UI machinery.
      </>
    ),
  },
  {
    change: "Reconcile two different “needs you” definitions",
    layer: "Web",
    dispo: "refine",
    where: (
      <>
        The Agents/Projects lenses key on <code className="ssl-code">activeAsks</code> — in-flight invocations (fleet.ts:497) — while the Home rail keys
        on <code className="ssl-code">collaboration_records</code> where next-move = operator (fleet.ts:504 · home/left.tsx:77). Same words, different truths.
      </>
    ),
  },
  {
    change: "A full attention queue / inbox",
    layer: "—",
    dispo: "defer",
    where: (
      <>
        The typed <code className="ssl-code">/api/operator-attention</code> API with approve/deny/dismiss (create-openscout-web-server.ts:3780) makes a
        real inbox possible — parked deliberately. The rows above light the surfaces we already ship first.
      </>
    ),
  },
];

function BlockD() {
  return (
    <section className="mb-10">
      <Eyebrow>Block D · ATTENTION — low-hanging fruit</Eyebrow>
      <H2>Not a redesign — one server change, four surfaces</H2>
      <Lede>
        Attention isn&rsquo;t a new screen; it&rsquo;s a signal that never leaves the server. This ledger is the honest short
        list — each row tied to a real touch point — with a full attention inbox parked deliberately.
      </Lede>

      <div className="overflow-hidden rounded-[8px] border border-studio-edge">
        <div
          className="grid gap-x-4 border-b border-studio-edge bg-studio-canvas-alt px-4 py-2 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint"
          style={{ gridTemplateColumns: "1.5fr 62px 82px 2.6fr" }}
        >
          <span>Change</span>
          <span>Layer</span>
          <span>Disposition</span>
          <span>Where it lands</span>
        </div>
        {ATTN_LEDGER.map((r, i) => {
          const d = DISPO[r.dispo];
          return (
            <div
              key={r.change}
              className={["grid items-start gap-x-4 px-4 py-3", i > 0 ? "border-t border-studio-edge" : ""].join(" ")}
              style={{ gridTemplateColumns: "1.5fr 62px 82px 2.6fr" }}
            >
              <span className="text-[12px] font-semibold leading-snug text-studio-ink">{r.change}</span>
              <span className="font-mono text-[10px] leading-snug text-studio-ink-muted">{r.layer}</span>
              <span>
                <span
                  className="inline-block rounded-[3px] px-1.5 py-px font-mono text-[8px] font-semibold uppercase tracking-eyebrow"
                  style={{ background: d.bg, color: d.fg }}
                >
                  {d.label}
                </span>
              </span>
              <span className="text-[11px] leading-snug text-studio-ink-muted">{r.where}</span>
            </div>
          );
        })}
      </div>

      <p className="mt-4 max-w-[82ch] text-[12.5px] font-medium leading-relaxed text-studio-ink">
        The loop closes cheaply: dispatch already has a grammar (the HUD dock), work already has an atom (the lane cockpit), and
        attention already has a source (the fleet query) — it just needs to be emitted. Three ships plus two refines (the iOS
        bridge and the two-definitions reconcile) wake the whole cycle before a single new screen is drawn.
      </p>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Scoped CSS — raw <style>, following the scout-ios idiom.
   Phone/tablet classes read --i-* (inside .scoutios); loop/fact/code
   classes read --studio-* (document root).
   ════════════════════════════════════════════════════════════════════ */

const STEERING_CSS = `
/* ── inline code (studio-token, outside frames) ─────────────────────── */
.ssl-code { font-family:"JetBrains Mono", ui-monospace, monospace; font-size:10.5px;
  color:var(--studio-ink); background:color-mix(in oklab, var(--studio-ink) 8%, transparent);
  padding:0 4px; border-radius:3px; white-space:nowrap; }
/* dependency marker in a frame caption (studio-token) */
.ssl-dep { display:inline-block; margin-top:5px; font-size:10.5px; line-height:1.42; font-style:italic;
  color:var(--studio-ink-faint); }

/* ── loop diagram (studio-token) ────────────────────────────────────── */
.ssl-loop { display:flex; align-items:stretch; gap:10px; flex-wrap:wrap; margin:6px 0 0; }
.ssl-loop-node { flex:1; min-width:180px; display:flex; flex-direction:column; gap:3px;
  padding:12px 14px; border-radius:10px; border:1px solid var(--studio-edge); background:var(--studio-surface); }
.ssl-loop-node.accent { border-style:dashed; border-color:color-mix(in oklab, var(--scout-accent) 45%, var(--studio-edge)); }
.ssl-loop-k { font-family:"JetBrains Mono", monospace; font-size:9px; font-weight:700; letter-spacing:0.1em;
  text-transform:uppercase; color:var(--studio-ink-faint); }
.ssl-loop-node.accent .ssl-loop-k { color:var(--scout-accent); }
.ssl-loop-v { font-size:12.5px; color:var(--studio-ink); }
.ssl-loop-arrow { align-self:center; font-family:"JetBrains Mono", monospace; color:var(--studio-ink-faint); font-size:15px; }

/* ── sprite + corner state dot (phone-token) — static; a single pulse
   fires on state-change only, never an idle loop (Reduce Motion honored) ─ */
.ssl-avatar { position:relative; display:inline-grid; place-items:center; flex:none; }
.ssl-corner { position:absolute; right:-2px; bottom:-2px; width:8px; height:8px; border-radius:50%;
  background:var(--i-muted); box-shadow:0 0 0 2px var(--i-surface); }
.ssl-corner.needs, .ssl-corner.working { background:var(--i-accent); }
.ssl-corner.offline { background:transparent; border:1px solid var(--i-dim); }

/* ── deck header + horizon dial (phone-token) ───────────────────────── */
.ssl-deckhead { display:flex; align-items:center; gap:8px; padding:8px 4px 10px; }
.ssl-deckhead .iSecLabel { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ssl-deck-needs { flex:none; font-family:var(--i-mono); font-size:9.5px; font-weight:700; letter-spacing:0.05em;
  text-transform:uppercase; color:var(--i-accent); background:var(--i-accent-soft);
  padding:2px 8px; border-radius:999px; margin-left:auto; white-space:nowrap; }
.ssl-horizonwrap { display:inline-flex; align-items:center; gap:8px; }
.ssl-horizoncap { font-family:var(--i-mono); font-size:9px; font-weight:700; letter-spacing:0.08em;
  text-transform:uppercase; color:var(--i-dim); }
.ssl-horizon { display:inline-flex; padding:2px; border-radius:9px; background:var(--i-bg);
  border:1px solid var(--i-hairline-strong); flex:none; }
.ssl-horizon button { font-family:var(--i-mono); font-size:9.5px; font-weight:700; letter-spacing:0.03em;
  padding:4px 9px; border-radius:6px; border:none; background:transparent; color:var(--i-dim); cursor:pointer; }
.ssl-horizon button.on { background:var(--i-surface); color:var(--i-accent);
  box-shadow:inset 0 0 0 1px color-mix(in oklab, var(--i-accent) 35%, transparent); }

/* ── lane cockpit card (phone-token) — task-as-title, active via border ─ */
.ssl-card { position:relative; border-radius:14px; padding:11px 12px; background:var(--i-surface);
  border:1px solid var(--i-hairline-strong);
  box-shadow:inset 0 1px 0 var(--i-keylight), 0 2px 6px rgba(0,0,0,0.28); }
.ssl-card + .ssl-card { margin-top:9px; }
.ssl-card.needs { border-color:color-mix(in oklab, var(--i-accent) 55%, transparent);
  box-shadow:inset 0 1px 0 var(--i-keylight),
    0 0 0 1px color-mix(in oklab, var(--i-accent) 22%, transparent),
    0 2px 10px color-mix(in oklab, var(--i-accent) 14%, transparent); }
.ssl-card-task { font-size:13px; font-weight:600; line-height:1.35; color:var(--i-ink);
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.ssl-card-attr-row { display:flex; align-items:center; gap:8px; margin-top:8px; }
.ssl-card-name { font-size:11.5px; font-weight:500; color:var(--i-muted); white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; flex:none; max-width:42%; }
.ssl-card-attr { font-size:10px; font-family:var(--i-mono); color:var(--i-dim); min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ssl-card-open { color:var(--i-dim); flex:none; margin-left:auto; }
.ssl-card-ask { font-size:12px; line-height:1.45; color:var(--i-ink); margin-top:8px;
  padding:7px 9px; border-radius:8px; background:var(--i-accent-soft); }
.ssl-card-status { display:flex; align-items:center; gap:6px; margin-top:9px;
  font-family:var(--i-mono); font-size:10px; }
.ssl-card-word { font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:var(--i-dim); }
.ssl-card-word.needs, .ssl-card-word.working { color:var(--i-accent); }
.ssl-card-dot { color:var(--i-dim); }
.ssl-card-last { color:var(--i-muted); }

/* ── persistent compose accessory + retired-"New" tab bar (phone-token) ─ */
.ssl-accessory { flex:none; display:flex; align-items:center; gap:9px; margin:6px 12px 8px; padding:9px 13px;
  border-radius:16px; position:relative; z-index:2;
  background:linear-gradient(180deg, color-mix(in oklab, var(--i-ink) 5%, var(--i-surface)), var(--i-surface));
  border:1px solid var(--i-hairline-strong);
  box-shadow:inset 0 1px 0 var(--i-keylight), 0 6px 16px -9px rgba(0,0,0,0.7); }
.ssl-accessory-plus { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; flex:none;
  background:var(--i-accent-soft); color:var(--i-accent);
  border:1px solid color-mix(in oklab, var(--i-accent) 35%, transparent); }
.ssl-accessory-text { flex:1; font-size:13px; color:var(--i-dim); }
.ssl-accessory-mic { color:var(--i-muted); display:grid; place-items:center; flex:none; }
.ssl-tabbar { flex:none; height:64px; display:flex; padding:8px 8px 22px; position:relative; z-index:2;
  border-top:1.5px solid var(--i-card-edge-top); background:var(--i-chrome); box-shadow:0 -6px 11px rgba(0,0,0,0.5); }
.ssl-tab { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; color:var(--i-muted); padding-top:2px; }
.ssl-tab[data-on="true"] { color:var(--i-accent); }
.ssl-tab-icon { display:grid; place-items:center; }
.ssl-tab-label { font-size:9px; font-weight:500; font-family:var(--i-mono); letter-spacing:0.02em; }

/* ── iPad frame + lane deck (phone-token) ───────────────────────────── */
.ssl-pad { width:1024px; border-radius:34px; padding:12px; background:#000; border:1px solid #2a2a2a;
  box-shadow:0 30px 70px -30px rgba(0,0,0,0.85); }
.ssl-pad-screen { height:744px; border-radius:24px; overflow:hidden; display:flex; flex-direction:column;
  font-family:var(--i-font); color:var(--i-ink);
  background:
    radial-gradient(120% 50% at 50% 0%, var(--i-keylight), rgba(255,255,255,0) 60%),
    linear-gradient(180deg, var(--i-wash-top) 0%, var(--i-bg) 34%, var(--i-wash-bottom) 100%); }
.ssl-pad-top { flex:none; display:flex; align-items:center; gap:12px; padding:12px 16px;
  border-bottom:1px solid var(--i-hairline-strong); }
.ssl-pad-nav { display:flex; align-items:center; gap:6px; }
.ssl-pad-navpill { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600;
  color:var(--i-muted); padding:6px 12px; border-radius:999px; border:1px solid transparent; }
.ssl-pad-navpill.on { color:var(--i-accent); background:var(--i-accent-soft);
  border-color:color-mix(in oklab, var(--i-accent) 30%, transparent); }
.ssl-pad-lanes { flex:1; min-height:0; display:flex; overflow:hidden; }
.ssl-pad-scroll { flex:1; min-width:0; display:flex; gap:1px; background:var(--i-hairline);
  overflow-x:auto; scroll-snap-type:x mandatory; }
.ssl-lane { flex:none; width:312px; scroll-snap-align:start; display:flex; flex-direction:column;
  background:var(--i-bg); overflow:hidden; }
.ssl-lane-pinned { background:color-mix(in oklab, var(--i-accent) 4%, var(--i-bg)); }
.ssl-lane-cockpit { flex:none; padding:12px 13px; border-bottom:1px solid var(--i-hairline-strong); }
.ssl-lane-cockpit.needs { background:color-mix(in oklab, var(--i-accent) 7%, transparent);
  box-shadow:inset 0 0 0 1px color-mix(in oklab, var(--i-accent) 26%, transparent); }
.ssl-lane-stream { flex:1; min-height:0; overflow:hidden; padding:8px 13px 12px; display:flex; flex-direction:column; }
.ssl-lane-streamcap { font-family:var(--i-mono); font-size:8.5px; font-weight:700; letter-spacing:0.13em;
  text-transform:uppercase; color:var(--i-dim); padding:2px 0 6px; }
.ssl-ev { display:flex; gap:9px; padding:4px 0; align-items:baseline; }
.ssl-ev-time { font-family:var(--i-mono); font-size:9.5px; color:var(--i-dim); flex:none; }
.ssl-ev-text { font-family:var(--i-mono); font-size:10.5px; color:var(--i-muted); line-height:1.4;
  min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* a quiet lane rests on a "last: …" line rather than a void */
.ssl-lane-rest { display:flex; align-items:baseline; gap:8px; padding:6px 0; margin-top:2px; }
.ssl-lane-rest-k { font-family:var(--i-mono); font-size:8.5px; font-weight:700; letter-spacing:0.1em;
  text-transform:uppercase; color:var(--i-dim); flex:none; }
.ssl-lane-rest-v { font-family:var(--i-mono); font-size:10.5px; color:var(--i-muted); line-height:1.4; }
/* the right-edge overflow rail */
.ssl-overflow { flex:none; width:56px; display:flex; flex-direction:column; align-items:center; gap:9px;
  padding:12px 0; border-left:1px solid var(--i-hairline-strong);
  background:color-mix(in oklab, var(--i-ink) 3%, var(--i-bg)); }
.ssl-overflow-count { font-family:var(--i-mono); font-size:12px; font-weight:700; color:var(--i-accent); }
.ssl-overflow-list { display:flex; flex-direction:column; gap:9px; align-items:center; }
.ssl-overflow-cap { font-family:var(--i-mono); font-size:8px; font-weight:700; letter-spacing:0.12em;
  text-transform:uppercase; color:var(--i-dim); writing-mode:vertical-rl; margin-top:2px; }

/* ── activity feed (phone-token) ────────────────────────────────────── */
.ssl-feedgroup { font-family:var(--i-mono); font-size:8.5px; font-weight:700; letter-spacing:0.13em;
  text-transform:uppercase; color:var(--i-dim); padding:10px 4px 5px; }
.ssl-feed-rowwrap { position:relative; overflow:hidden; }
.ssl-feed-steer { position:absolute; right:0; top:0; bottom:0; width:74px; display:grid; place-items:center;
  background:var(--i-accent); color:#04130d; font-size:11.5px; font-weight:700; font-family:var(--i-font); opacity:0; }
.ssl-feed-rowwrap.swiped .ssl-feed-steer { opacity:1; }
.ssl-feed-row { position:relative; z-index:1; display:flex; align-items:flex-start; gap:9px; padding:9px 4px;
  cursor:pointer; transition:transform 0.16s; }
.ssl-feed-rowwrap.swiped .ssl-feed-row { transform:translateX(-74px); background:var(--i-bg); }
.ssl-feed-row.needs { padding-left:12px; }
.ssl-feed-rail { position:absolute; left:1px; top:9px; bottom:9px; width:3px; border-radius:2px; background:var(--i-accent); }
.ssl-feed-body { flex:1; min-width:0; }
.ssl-feed-line { font-size:12.5px; line-height:1.4; color:var(--i-ink); }
.ssl-feed-line b { font-weight:600; }
.ssl-feed-ask { font-size:11.5px; line-height:1.4; color:var(--i-ink); margin-top:5px;
  padding:6px 9px; border-radius:8px; background:var(--i-accent-soft); }
.ssl-feed-meta { font-family:var(--i-mono); font-size:9.5px; color:var(--i-dim); margin-top:3px; }
.ssl-feed-time { font-family:var(--i-mono); font-size:10px; color:var(--i-dim); flex:none; margin-top:2px; }
.ssl-feed-sep { height:1px; background:var(--i-hairline); margin-left:37px; }

/* ── compose sheet (phone-token) — real bottom sheet, keyboard-up ────── */
.ssl-scrim { position:absolute; inset:0; background:rgba(0,0,0,0.5); z-index:6; }
.ssl-sheet { position:absolute; left:0; right:0; bottom:0; z-index:7; padding:12px 14px 18px;
  border-radius:20px 20px 0 0; border-top:1px solid var(--i-hairline-strong);
  background:linear-gradient(180deg, color-mix(in oklab, var(--i-ink) 3%, var(--i-chrome)), var(--i-chrome));
  box-shadow:0 -14px 34px rgba(0,0,0,0.5); }
.ssl-sheet-grip { width:38px; height:4px; border-radius:2px; background:var(--i-hairline-strong); margin:0 auto 12px; }
.ssl-sheet-well { display:flex; align-items:center; gap:9px; min-height:52px; padding:9px 11px; border-radius:14px;
  background:var(--i-bg); border:1px solid color-mix(in oklab, var(--i-accent) 45%, var(--i-hairline-strong));
  box-shadow:inset 0 1px 2px rgba(0,0,0,0.3), 0 0 0 3px color-mix(in oklab, var(--i-accent) 12%, transparent); }
.ssl-well-mic { color:var(--i-muted); flex:none; display:grid; place-items:center; }
.ssl-well-text { flex:1; font-size:14px; line-height:1.4; color:var(--i-ink); min-width:0; }
.ssl-well-send { width:32px; height:32px; border-radius:50%; display:grid; place-items:center; flex:none;
  background:linear-gradient(180deg, var(--i-accent-2), var(--i-accent)); color:#04130d;
  border:1px solid color-mix(in oklab, var(--i-accent) 60%, #000);
  box-shadow:inset 0 1px 0 color-mix(in oklab, #fff 22%, transparent), 0 2px 9px color-mix(in oklab, var(--i-accent) 32%, transparent); }
.ssl-well-send.sm { width:26px; height:26px; }
.ssl-route { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:12px; font-size:12px; color:var(--i-muted); }
.ssl-route-lead { color:var(--i-dim); font-weight:600; }
.ssl-route-verb { color:var(--i-ink); font-weight:700; }
.ssl-route-cont { color:var(--i-muted); }
.ssl-route-dash { color:var(--i-dim); }
.ssl-route-path { font-family:var(--i-mono); font-size:11px; color:var(--i-dim); }
.ssl-rchip { display:inline-flex; align-items:center; gap:4px; font-size:11.5px; color:var(--i-ink);
  padding:3px 7px 3px 9px; border-radius:999px; background:var(--i-surface);
  border:1px solid var(--i-hairline-strong); cursor:pointer; }
.ssl-rchip.on { border-color:color-mix(in oklab, var(--i-accent) 55%, transparent);
  background:var(--i-accent-soft); color:var(--i-accent); }
.ssl-chev-ud { color:var(--i-dim); flex:none; }
.ssl-rchip.on .ssl-chev-ud { color:var(--i-accent); }
.ssl-atrow { display:flex; align-items:center; gap:8px; margin-top:14px; padding:12px 0 2px;
  border-top:1px solid var(--i-hairline); overflow-x:auto; }
.ssl-at { display:inline-flex; align-items:center; gap:6px; padding:3px 10px 3px 3px; border-radius:999px;
  background:var(--i-surface); border:1px solid var(--i-hairline-strong); cursor:pointer; flex:none; }
.ssl-at.on { border-color:color-mix(in oklab, var(--i-accent) 55%, transparent); background:var(--i-accent-soft); }
.ssl-at-handle { font-family:var(--i-mono); font-size:10.5px; color:var(--i-ink); white-space:nowrap; }
/* keyboard slab — the sheet's primary (keyboard-up) state */
.ssl-keyboard { margin:14px -14px -18px; padding:8px 4px 12px; background:var(--i-chrome);
  border-top:1px solid var(--i-hairline); display:flex; flex-direction:column; gap:7px; }
.ssl-kbrow { display:flex; justify-content:center; gap:5px; }
.ssl-kbrow.indent { padding:0 15px; }
.ssl-key { min-width:26px; height:34px; display:grid; place-items:center; border-radius:5px; flex:none;
  background:linear-gradient(180deg, color-mix(in oklab, #fff 6%, var(--i-surface)), var(--i-surface));
  border:1px solid var(--i-hairline-strong); box-shadow:0 1px 0 rgba(0,0,0,0.4);
  font-size:13px; color:var(--i-ink); font-family:var(--i-font); }
.ssl-key-mod { min-width:32px; background:var(--i-bg); color:var(--i-muted); }
.ssl-key-wide { min-width:44px; font-size:11px; color:var(--i-muted); }
.ssl-key-space { flex:1; font-size:11px; color:var(--i-dim); }
.ssl-key-go { background:var(--i-accent); color:#04130d; border-color:var(--i-accent); }

/* ── corrected-state inset — a chip's menu over the sheet (phone-token) ─ */
.ssl-inset { width:300px; border-radius:16px; padding:12px 13px 13px; background:var(--i-chrome);
  border:1px solid var(--i-hairline-strong); box-shadow:0 18px 42px -18px rgba(0,0,0,0.85); }
.ssl-inset-route { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:12px; color:var(--i-muted); }
.ssl-menu { margin-top:11px; border-radius:12px; background:var(--i-surface);
  border:1px solid var(--i-hairline-strong); overflow:hidden; }
.ssl-menu-cap { font-family:var(--i-mono); font-size:8.5px; font-weight:700; letter-spacing:0.12em;
  text-transform:uppercase; color:var(--i-dim); padding:9px 12px 6px; }
.ssl-menu-item { display:flex; align-items:center; gap:9px; padding:9px 12px; border-top:1px solid var(--i-hairline); }
.ssl-menu-item.on { background:var(--i-accent-soft); }
.ssl-menu-dot { width:7px; height:7px; border-radius:50%; flex:none; box-sizing:border-box; }
.ssl-menu-dot.r-ready { background:var(--i-accent); }
.ssl-menu-dot.r-configured { background:var(--i-dim); }
.ssl-menu-dot.r-missing { background:transparent; border:1px solid var(--i-dim); }
.ssl-menu-name { font-size:13px; color:var(--i-ink); font-weight:500; }
.ssl-menu-path { font-family:var(--i-mono); font-size:10px; color:var(--i-dim); margin-left:auto; }
.ssl-menu-check { color:var(--i-accent); flex:none; display:grid; place-items:center; }

/* ── lock-screen strip (phone-token) — three mini-states ────────────── */
.ssl-lock-strip { display:flex; align-items:center; gap:10px; }
.ssl-lock { width:176px; flex:none; }
.ssl-lock-cap { font-family:var(--i-mono); font-size:8.5px; font-weight:700; letter-spacing:0.1em;
  text-transform:uppercase; color:var(--i-dim); margin-bottom:6px; }
.ssl-lock-face { height:300px; border-radius:26px; overflow:hidden; padding:18px 13px; position:relative;
  border:1px solid #2a2a2a; display:flex; flex-direction:column;
  background:linear-gradient(180deg, #0c0c0d, #050506); }
.ssl-lock-face.dim { justify-content:flex-end; }
.ssl-lock-time { font-size:40px; font-weight:600; letter-spacing:-0.02em; color:var(--i-ink); text-align:center; margin-top:8px; }
.ssl-lock-date { font-size:11px; color:var(--i-muted); text-align:center; margin-top:2px; }
.ssl-lock-notif { margin-top:auto; border-radius:15px; padding:10px 11px;
  background:color-mix(in oklab, #fff 8%, rgba(22,22,24,0.55)); border:1px solid var(--i-hairline-strong); }
.ssl-lock-notif-top { display:flex; align-items:center; gap:7px; }
.ssl-lock-notif-name { font-size:11.5px; font-weight:600; color:var(--i-ink); }
.ssl-lock-notif-age { font-family:var(--i-mono); font-size:9px; color:var(--i-dim); margin-left:auto; }
.ssl-lock-notif-body { font-size:11px; line-height:1.4; color:var(--i-muted); margin-top:6px; }
.ssl-lock-arrow { color:var(--i-dim); flex:none; display:grid; place-items:center; }
.ssl-lock-sheet { margin:0 -13px -18px; border-radius:18px 18px 0 0; padding:11px 12px 15px;
  border-top:1px solid var(--i-hairline-strong); box-shadow:0 -12px 30px rgba(0,0,0,0.55);
  background:linear-gradient(180deg, color-mix(in oklab, var(--i-ink) 4%, var(--i-chrome)), var(--i-chrome)); }
.ssl-lock-sheet-grip { width:30px; height:4px; border-radius:2px; background:var(--i-hairline-strong); margin:0 auto 9px; }
.ssl-lock-quote { font-size:10.5px; line-height:1.4; color:var(--i-muted); padding:7px 9px; border-radius:9px;
  background:var(--i-accent-soft); }
.ssl-lock-route { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin-top:9px; font-size:10.5px; color:var(--i-muted); }
.ssl-lock-route-cont { color:var(--i-muted); }
.ssl-lock-well { display:flex; align-items:center; gap:7px; margin-top:9px; padding:8px 10px; border-radius:11px;
  background:var(--i-bg); border:1px solid color-mix(in oklab, var(--i-accent) 45%, var(--i-hairline-strong)); }
.ssl-lock-well-text { flex:1; font-size:11.5px; color:var(--i-ink); }
.ssl-lock-sent { margin:auto; display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center; }
.ssl-lock-sent-mark { width:40px; height:40px; border-radius:50%; display:grid; place-items:center;
  color:var(--i-accent); background:var(--i-accent-soft); border:1px solid color-mix(in oklab, var(--i-accent) 40%, transparent); }
.ssl-lock-sent-title { font-size:13px; font-weight:600; color:var(--i-ink); }
.ssl-lock-sent-sub { font-size:11px; font-family:var(--i-mono); color:var(--i-muted); }
`;

/* ════════════════════════════════════════════════════════════════════
   Page.
   ════════════════════════════════════════════════════════════════════ */

export default function ScoutSteeringLoopStudy() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <ScoutIOSStyles />
      <style>{STEERING_CSS}</style>

      <header className="mb-10 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · ios · scout-steering-loop
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Scout · Steering Loop
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-muted">
          Scout&rsquo;s iOS surfaces are chat-shaped, but the operator&rsquo;s real loop is a cycle: <strong className="text-studio-ink">dispatch</strong> work →
          watch <strong className="text-studio-ink">ambient</strong> work → get pulled in by <strong className="text-studio-ink">attention</strong>. This study rethinks
          the core surfaces around that loop as a current ⇄ proposed showcase — WORK as a lane deck that scales from phone to
          tablet, DISPATCH as Home behind a persistent compose dock, and ATTENTION as a short ledger of low-hanging fruit.
          Every fact is checked against the codebase.
        </p>
      </header>

      <BlockA />
      <BlockB />
      <BlockC />
      <BlockD />
    </main>
  );
}
