/**
 * HUD Native — study (v5 — one cockpit + N slotted web views).
 *
 * v5 reframes the HUD around a new model:
 *
 *   ONE  native, deeply-iterated surface
 *        — the always-on AI assistant, Ranger-DNA cockpit (~860×540).
 *        Three Miller-style columns (fleet / context / focus), a vim mode
 *        strip on top, a conversational input dock pinned to the bottom.
 *        This is the centerpiece we own end-to-end: keyboard-driven,
 *        conversational (mic + text), QB-as-cockpit. Real fleet ops
 *        driven from a single, deterministic place.
 *
 *   N    web view slots, each bound to a hotkey by the operator
 *        — tail, fleet, mission, agent detail, canvas, brief in-flight,
 *        and whatever the operator wires up next. The HUD shell handles
 *        glass / position / always-on-top / multi-space and hosts a
 *        studio surface inside; the surface renders itself.
 *
 * The earlier work — bar / panel / sheet form family, IA explorations,
 * chord-summon, anatomy — is preserved in full. Those become reference
 * sketches for IA density at different scales. They continue to inform
 * what the cockpit's columns render and what gets shown in each slot.
 *
 * Visual lineage from v2/v3/v4 is preserved verbatim: HUD_TOKENS,
 * HudPanel primitive, layered specular, rim light, corner halos,
 * gradient hairlines, row temperatures, cyan/rose palette. v5 extends —
 * never replaces.
 */

import type { CSSProperties, ReactNode } from "react";

import { SteerActionGlyph } from "../components/QuickSteer";

// ── Agent data model (deepened from v2) ──────────────────────────────

type HudAgentState = "working" | "waiting" | "done" | "needs-attention";

interface HudAgent {
  id: string;
  name: string;
  hue: number;
  state: HudAgentState;
  /** One-line headline of what the agent is doing right now. */
  task: string;
  /** "2s" / "47m" — short relative timestamp. */
  ago: string;
  /** "47m" — how long the agent has been alive in its current spawn. */
  runtime?: string;
  /** Last-turn summary in the agent's own voice. 2-3 sentences. */
  lastTurn?: string;
  /** Most recent cross-agent message — `→ @drover: "..."`. */
  lastMessage?: { to: string; text: string };
  /** What the agent wants from the operator, if anything. */
  pendingAsk?: string;
  /** Number of files touched in this run. */
  files?: number;
  /** Token consumption, e.g. "184k". */
  tokens?: string;
  /** Model identifier, e.g. "opus-4-7". */
  model?: string;
  /** Branch or worktree, e.g. "feat/audit-trail". */
  branch?: string;
  /** Project context, e.g. "openscout/control-plane". */
  project?: string;
  /** Role line — what kind of work this spawn is doing. */
  role?: string;
  /** Who spawned this agent — "operator" or another agent name. */
  spawnedBy?: string;
  /**
   * Recent activity pulse (12-step), 0..1 each step. Drives the
   * sparkline / pulse-dot rendering. Highest-recency = last.
   */
  pulse?: number[];
}

// Avatar/hue convention from components/AgentRow.tsx — same agent,
// same color across every surface.
const HUES: Record<string, number> = {
  Scout: 125,
  Hudson: 210,
  QB: 25,
  Cody: 85,
  Ranger: 295,
  Vox: 340,
  Atlas: 175,
  Drover: 50,
  Vault: 250,
  Pike: 305,
  Quill: 195,
  Cobalt: 235,
};

// ── Mocked agent corpus ──────────────────────────────────────────────
//
// Six named agents with substantive state. Drover is the rose attention
// agent — explicit pending ask, carried consistently across all forms.

const HUDSON: HudAgent = {
  id: "hudson",
  name: "Hudson",
  hue: HUES.Hudson,
  state: "working",
  role: "review · auth middleware",
  task: "validating SOC 2 audit trail on auth-mw",
  ago: "11s",
  runtime: "1h 14m",
  lastTurn:
    "Walked the audit-trail emit calls across the four sign-in paths. Magic-link and SSO are clean; password reset is missing a `reason` field on the failure branch. Drafting the patch before I flag it.",
  lastMessage: {
    to: "drover",
    text: "hand me the migration file when you're done — I want to verify the trail spans both schemas",
  },
  files: 14,
  tokens: "212k",
  model: "opus-4-7",
  branch: "feat/audit-trail",
  project: "openscout/control-plane",
  spawnedBy: "operator",
  pulse: [0.2, 0.3, 0.5, 0.4, 0.6, 0.8, 0.7, 0.9, 0.85, 0.95, 0.8, 0.9],
};

const DROVER: HudAgent = {
  id: "drover",
  name: "Drover",
  hue: HUES.Drover,
  state: "needs-attention",
  role: "infra · db migrations",
  task: "two migrations queued, order matters — needs operator call",
  ago: "1m",
  runtime: "47m",
  lastTurn:
    "Both migrations touch the `sessions` table. If I roll the index split first, the foreign-key rename becomes a six-line patch; if I roll the rename first, the index becomes a rebuild. I can't pick this one without you.",
  lastMessage: {
    to: "hudson",
    text: "blocked on operator — will hand off the file the moment it lands",
  },
  pendingAsk:
    "which migration to roll first — index split or fk rename? Hudson is downstream of this.",
  files: 6,
  tokens: "98k",
  model: "opus-4-7",
  branch: "infra/sessions-split",
  project: "openscout/control-plane",
  spawnedBy: "hudson",
  pulse: [0.6, 0.7, 0.5, 0.3, 0.2, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05],
};

const PIKE: HudAgent = {
  id: "pike",
  name: "Pike",
  hue: HUES.Pike,
  state: "working",
  role: "frontend · sheet animation",
  task: "tuning pull-down sheet ease curve to match HUD breath",
  ago: "4s",
  runtime: "22m",
  lastTurn:
    "Swapped the linear-out for a critically-damped spring at 0.62 / 0.88. The sheet lands without bounce and stays under 220ms door-to-rest. Looks right; want a second pair of eyes before I push.",
  lastMessage: {
    to: "atlas",
    text: "the new ease lives in `motion/HudCurves.ts` — your icon-set transition can reuse it",
  },
  files: 3,
  tokens: "64k",
  model: "opus-4-7",
  branch: "feat/sheet-motion",
  project: "openscout/design/studio",
  spawnedBy: "operator",
  pulse: [0.4, 0.5, 0.7, 0.8, 0.7, 0.6, 0.9, 0.85, 0.7, 0.8, 0.9, 0.85],
};

const QUILL: HudAgent = {
  id: "quill",
  name: "Quill",
  hue: HUES.Quill,
  state: "working",
  role: "docs · agent reference",
  task: "drafting the spawn-lineage doc section",
  ago: "32s",
  runtime: "1h 02m",
  lastTurn:
    "Reorganized the lineage examples around `operator → hudson → drover` so the chain reads in the order an operator would think about it. Three diagrams in place; rewriting the prose around them now.",
  lastMessage: {
    to: "hudson",
    text: "can I quote the audit-trail review as the canonical 'operator-spawned working agent' example?",
  },
  files: 8,
  tokens: "146k",
  model: "sonnet-4-7",
  branch: "docs/agent-ref",
  project: "openscout/docs",
  spawnedBy: "operator",
  pulse: [0.5, 0.6, 0.5, 0.6, 0.7, 0.5, 0.6, 0.7, 0.65, 0.7, 0.6, 0.7],
};

const ATLAS: HudAgent = {
  id: "atlas",
  name: "Atlas",
  hue: HUES.Atlas,
  state: "done",
  role: "frontend · icon set",
  task: "icon-set v3 — 24 glyphs shipped",
  ago: "12s",
  runtime: "3h 18m",
  lastTurn:
    "Twenty-four glyphs landed. Stripped the SF Symbols leftovers, redrew the spawn-arrow as a single-stroke quill mark, and gave the morse cluster a 6° rotation that scans as 'animation about to start' without actually moving.",
  lastMessage: {
    to: "pike",
    text: "icons are sized for 14/18/24px — none of them need the new ease curve, but thanks",
  },
  files: 24,
  tokens: "286k",
  model: "opus-4-7",
  branch: "feat/icons-v3",
  project: "openscout/design/studio",
  spawnedBy: "operator",
  pulse: [0.7, 0.8, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1],
};

const COBALT: HudAgent = {
  id: "cobalt",
  name: "Cobalt",
  hue: HUES.Cobalt,
  state: "waiting",
  role: "infra · CI runner pool",
  task: "scale-out blocked on quota — backing off",
  ago: "4m",
  runtime: "28m",
  lastTurn:
    "Tried to spin three more runners; the quota request needs manual approval upstream. Backing off to a 90-second retry. No code in flight, no files dirty — just the retry timer.",
  lastMessage: {
    to: "operator",
    text: "FYI quota approval still pending — not blocking anything yet, will escalate at 1h",
  },
  files: 0,
  tokens: "22k",
  model: "haiku-4-7",
  branch: "infra/runner-quota",
  project: "openscout/ops",
  spawnedBy: "drover",
  pulse: [0.5, 0.6, 0.4, 0.3, 0.2, 0.15, 0.1, 0.08, 0.08, 0.08, 0.08, 0.08],
};

// Fleet rosters per surface.
const FLEET_FULL: HudAgent[] = [HUDSON, DROVER, PIKE, QUILL, ATLAS, COBALT];
const FLEET_PANEL: HudAgent[] = [HUDSON, DROVER, PIKE]; // 3 deep rows
const FLEET_PANEL_QUIET: HudAgent[] = [HUDSON, PIKE, QUILL];
const FLEET_PANEL_DONE: HudAgent[] = [ATLAS, HUDSON, PIKE];
const FLEET_BAR: HudAgent[] = [HUDSON, DROVER, PIKE, QUILL, ATLAS, COBALT];

// ── HUD tokens (translated from lattices HUDChrome.swift) ───────────

const HUD_TOKENS: CSSProperties = {
  ["--hud-base-top" as string]: "rgb(14, 15, 18)",
  ["--hud-base-bottom" as string]: "rgb(6, 7, 10)",
  ["--hud-glass-fill" as string]: "rgba(255,255,255,0.045)",
  ["--hud-glass-fill-strong" as string]: "rgba(255,255,255,0.075)",
  ["--hud-glass-fill-hover" as string]: "rgba(255,255,255,0.060)",
  ["--hud-glass-stroke" as string]: "rgba(255,255,255,0.13)",
  ["--hud-glass-stroke-soft" as string]: "rgba(255,255,255,0.07)",
  // Single-accent strip: the original cyan/rose binary collapses to one
  // scout-accent lime. State differentiation reads from labels + halo
  // treatment, not a color flip.
  ["--hud-cyan" as string]: "var(--scout-accent)",
  ["--hud-cyan-soft" as string]: "color-mix(in oklab, var(--scout-accent) 28%, transparent)",
  ["--hud-rose" as string]: "var(--scout-accent)",
  ["--hud-rose-soft" as string]: "color-mix(in oklab, var(--scout-accent) 32%, transparent)",
};

// Form dimensions.
const BAR_W = 300;
const BAR_H = 110;
const HUD_W = 340;
const HUD_H = 460;
const SHEET_W = 1360;
const SHEET_H = 420;

// Mock desktop scale for the form-family orientation frame.
const DESK_W = 1280;
const DESK_H = 760;

// ── Page ─────────────────────────────────────────────────────────────

export default function HudNativePage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8" style={HUD_TOKENS}>
      <PageHeader />
      <CockpitSection />
      <FormFamilySection />
      <VariantABarSection />
      <VariantBPanelSection />
      <VariantCSheetSection />
      <IAExplorationsSection />
      <SummonGesturesSection />
      <SlotModelSection />
      <AnatomySection />
      <PageFooter />
    </main>
  );
}

// ── Header ───────────────────────────────────────────────────────────

function PageHeader() {
  return (
    <header className="mb-9 max-w-prose">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · studies · macos · hud-native · v5
      </div>
      <h1 className="mt-1.5 font-display text-[40px] font-medium leading-[1.05] tracking-tight text-studio-ink">
        HUD Native — one cockpit, N slotted views
      </h1>
      <p className="mt-3 font-sans text-[14px] leading-relaxed text-studio-ink-muted">
        The HUD has two halves. One native, deeply-iterated surface — the
        always-on AI assistant in Ranger DNA — is the centerpiece we own
        and refine. Everything else (tail, fleet, mission, canvas, brief
        in-flight, …) is a studio web view slotted into the HUD shell and
        bound to a hotkey by the operator. This study works through both:
        the conversational cockpit first, then the form-family explorations
        that fed thinking on IA density, then the slot model that brings
        the rest of the studio into the shell.
      </p>
      <p className="mt-3 font-sans text-[13px] italic leading-relaxed text-studio-ink-faint">
        Same glass DNA holds throughout — dark base, layered white
        overlays, top-edge rim, mesh-light specular, gradient hairlines.
        Color is reserved: cyan for focus, rose for an explicit ask;
        everything else carries in ink.
      </p>
    </header>
  );
}

// ── 1 · Form family orientation ──────────────────────────────────────

function FormFamilySection() {
  return (
    <section className="mt-16">
      <p className="mb-6 max-w-prose font-sans text-[12.5px] italic leading-relaxed text-studio-ink-faint">
        Earlier explorations of agent-state IA at three depths — bar,
        panel, sheet. These remain useful as reference for slot content
        density at different scales; the cockpit above subsumes their job
        as the primary native surface, but the IA work continues to inform
        what gets shown where.
      </p>
      <SectionHead
        kicker="the form family"
        title="Three postures, one chrome"
        lede="One mock desktop, all three postures drawn at roughly the right relative scale, so the reader sees the family before drilling into any one. Bar in the top-left, panel anchored to the top-right, sheet pulled down from the menu bar. They coexist: each can be on while the others are, and one chord brings the operator into the family."
      />

      <div className="mt-6 flex justify-center">
        <FormFamilyDesktop />
      </div>

      <div className="mx-auto mt-5 grid max-w-[1080px] grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-3">
        <FormFamilyTradeoff
          mark="A"
          title="Top-left bar"
          size="~300 × 110"
          summon="always-on · the entry point"
          note="Ambient pulse. Hue chips for the fleet, a one-line current-attention headline. No depth — that's the form constraint, and the form earns its keep by being always-there. Stays visible when the panel or sheet are summoned alongside."
        />
        <FormFamilyTradeoff
          mark="B"
          title="Floating panel"
          size="340 × 460"
          summon="→ from the family"
          note="The cockpit. Three rich rows, each with last-turn summary + stat strip + cross-agent message. Where the operator goes when something on the bar caught the eye — and where the panel sits while the sheet drops."
        />
        <FormFamilyTradeoff
          mark="C"
          title="Pull-down sheet"
          size="~1360 × 420"
          summon="↓ from the family"
          note="The briefing. Multi-column grid of full agent cards with prose summaries, full stat blocks, pending asks. Drops down without dismissing the bar or panel — the whole picture without losing your place."
        />
      </div>
    </section>
  );
}

function FormFamilyDesktop() {
  // Position the three variants on the desktop at correct relative scale.
  // Real form widths get downscaled to fit the desktop mock.
  const SCALE = 0.46; // shared scale so widths are mutually accurate
  const barW = BAR_W * SCALE;
  const barH = BAR_H * SCALE;
  const panelW = HUD_W * SCALE;
  const panelH = HUD_H * SCALE;
  const sheetW = SHEET_W * SCALE;
  const sheetH = SHEET_H * SCALE;

  return (
    <div
      className="relative overflow-hidden rounded-[12px] border border-studio-edge-strong"
      style={{
        width: DESK_W,
        height: DESK_H,
        background:
          "radial-gradient(ellipse at top, var(--studio-canvas-alt) 0%, var(--studio-canvas) 80%)",
        boxShadow:
          "0 24px 48px -24px rgba(0,0,0,0.4), 0 0 0 1px var(--studio-edge) inset",
      }}
    >
      {/* Wallpaper-ish soft gradient field */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.16 0.018 250) 0%, oklch(0.11 0.015 280) 100%)",
        }}
      />
      {/* Mock menu bar */}
      <div
        className="absolute inset-x-0 top-0 flex items-center gap-3 px-3"
        style={{
          height: 26,
          background: "rgba(20, 22, 28, 0.85)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(8px)",
        }}
      >
        <span className="font-mono text-[10px] text-studio-ink-faint"></span>
        <span className="font-mono text-[10px] text-studio-ink-faint">File</span>
        <span className="font-mono text-[10px] text-studio-ink-faint">Edit</span>
        <span className="font-mono text-[10px] text-studio-ink-faint">View</span>
        <div className="ml-auto flex items-center gap-3">
          <MenuBarOpenScoutGlyph />
          <span className="font-mono text-[10px] text-studio-ink-faint">9:24</span>
        </div>
      </div>

      {/* A — top-left bar (anchored under the menu bar, left side) */}
      <FormFamilyAnchor
        x={12}
        y={36}
        w={barW}
        h={barH}
        label="A · top-left bar"
        side="bottom"
      >
        <div style={{ transform: `scale(${SCALE})`, transformOrigin: "top left" }}>
          <TopLeftBar
            fleet={FLEET_BAR}
            headline={{ agent: DROVER, msg: "needs your call on which migration to roll first" }}
          />
        </div>
      </FormFamilyAnchor>

      {/* B — floating panel (top-right) */}
      <FormFamilyAnchor
        x={DESK_W - panelW - 24}
        y={42}
        w={panelW}
        h={panelH}
        label="B · floating panel"
        side="bottom"
      >
        <div style={{ transform: `scale(${SCALE})`, transformOrigin: "top left" }}>
          <HudPanel
            header="OpenScout"
            subhead="3 agents · 1 on you"
            agents={FLEET_PANEL}
            specular={{ x: 0.34, y: 0.30 }}
            activeRowId="hudson"
          />
        </div>
      </FormFamilyAnchor>

      {/* C — pull-down sheet (descended from the menu bar, centered) */}
      <FormFamilyAnchor
        x={(DESK_W - sheetW) / 2}
        y={26}
        w={sheetW}
        h={sheetH}
        label="C · pull-down sheet"
        side="bottom"
        muted
      >
        <div style={{ transform: `scale(${SCALE})`, transformOrigin: "top left" }}>
          <PullDownSheet fleet={FLEET_FULL} />
        </div>
      </FormFamilyAnchor>

      {/* Faint working-window suggestion behind everything */}
      <div
        aria-hidden
        className="absolute"
        style={{
          left: 100,
          top: DESK_H - 280,
          width: DESK_W - 200,
          height: 220,
          borderRadius: 8,
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.04)",
        }}
      />
    </div>
  );
}

function FormFamilyAnchor({
  x,
  y,
  w,
  h,
  label,
  side,
  muted,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  side: "top" | "bottom";
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute"
      style={{ left: x, top: y, width: w, height: h }}
    >
      {children}
      <div
        className="absolute left-0 right-0 text-center font-mono text-[9px] uppercase tracking-eyebrow"
        style={{
          [side === "bottom" ? "top" : "bottom"]: side === "bottom" ? h + 6 : h + 6,
          color: "var(--studio-ink)",
          opacity: muted ? 0.45 : 0.75,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function FormFamilyTradeoff({
  mark,
  title,
  size,
  summon,
  note,
}: {
  mark: string;
  title: string;
  size: string;
  summon: string;
  note: string;
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[3px] border border-studio-edge font-mono text-[10px] font-semibold text-studio-ink-faint"
      >
        {mark}
      </span>
      <div className="flex-1">
        <div className="font-display text-[15px] text-studio-ink">{title}</div>
        <div className="mt-0.5 font-mono text-[10px] text-studio-ink-faint">
          {size} · {summon}
        </div>
        <p className="mt-1.5 font-sans text-[12px] leading-relaxed text-studio-ink-muted">
          {note}
        </p>
      </div>
    </div>
  );
}

// ── 2 · Variant A · Top-left bar ─────────────────────────────────────

function VariantABarSection() {
  return (
    <section className="mt-16">
      <SectionHead
        kicker="variant A · top-left bar"
        title="The ambient pulse"
        lede="A 300-wide strip that lives near the menu bar, opposite the OpenScout menu bar icon. Always visible while the app is running. Six hue chips, one current-attention headline, a heartbeat sparkline. Nothing the operator has to act on — purely a 'fleet is alive and Drover wants you' signal."
      />

      <div className="mt-6 flex justify-center">
        <ScreenFrame width={1080} height={300}>
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, oklch(0.16 0.018 250) 0%, oklch(0.11 0.015 280) 100%)",
            }}
          />
          <DesktopMenuBar />
          <div className="absolute" style={{ left: 12, top: 36 }}>
            <TopLeftBar
              fleet={FLEET_BAR}
              headline={{ agent: DROVER, msg: "needs your call on which migration to roll first" }}
            />
          </div>
        </ScreenFrame>
      </div>

      <Caption>variant A · hero — bar anchored beside the menu bar, fleet in pulse, Drover carrying the rose accent</Caption>

      <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
        <StateCardBar
          label="Calm"
          caption="no flagged agent — chips pulse cool, headline reads the most-recent working agent."
        >
          <TopLeftBar
            fleet={[HUDSON, PIKE, QUILL, ATLAS, COBALT]}
            headline={{ agent: HUDSON, msg: "validating SOC 2 audit trail on auth-mw" }}
          />
        </StateCardBar>
        <StateCardBar
          label="Needs attention"
          caption="Drover's chip warms to rose; the headline is the explicit ask, not the task."
        >
          <TopLeftBar
            fleet={FLEET_BAR}
            headline={{ agent: DROVER, msg: "needs your call on which migration to roll first" }}
          />
        </StateCardBar>
        <StateCardBar
          label="Just-completed"
          caption="Atlas's chip glows green-check briefly; the sparkline tails off as work winds down."
        >
          <TopLeftBar
            fleet={[ATLAS, HUDSON, PIKE, QUILL, COBALT]}
            headline={{ agent: ATLAS, msg: "icon-set v3 shipped — 24 glyphs in studio" }}
            completedId="atlas"
          />
        </StateCardBar>
      </div>

      <p className="mx-auto mt-6 max-w-prose font-sans text-[12.5px] italic leading-relaxed text-studio-ink-faint">
        Always-on rather than hotkey-summoned because the form is small
        enough that it doesn&apos;t earn its keep otherwise — if you have to
        summon it, you may as well summon the panel and get the row depth.
        The bar&apos;s job is to be in the operator&apos;s peripheral vision
        so the menu bar icon never has to badge.
      </p>
    </section>
  );
}

function StateCardBar({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {label}
      </div>
      <div
        className="mt-2 grid place-items-center rounded-[6px] border border-studio-edge p-6"
        style={{
          background:
            "radial-gradient(ellipse at top, var(--studio-canvas-alt) 0%, var(--studio-canvas) 80%)",
          minHeight: BAR_H + 60,
        }}
      >
        {children}
      </div>
      <p className="mt-2 font-sans text-[11.5px] italic leading-relaxed text-studio-ink-faint">
        {caption}
      </p>
    </div>
  );
}

/** The top-left bar form. */
function TopLeftBar({
  fleet,
  headline,
  completedId,
}: {
  fleet: HudAgent[];
  headline: { agent: HudAgent; msg: string };
  completedId?: string;
}) {
  const isAttention = headline.agent.state === "needs-attention";
  return (
    <div
      className="relative overflow-hidden rounded-[8px]"
      style={{
        width: BAR_W,
        height: BAR_H,
        background:
          "linear-gradient(135deg, var(--hud-base-top), var(--hud-base-bottom))",
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
        boxShadow:
          "0 12px 28px -12px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05) inset",
      }}
    >
      {/* accent wash — rose only carries meaning (attention), cyan whisper at most */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: isAttention
            ? "linear-gradient(135deg, transparent 0%, transparent 40%, color-mix(in oklab, var(--hud-rose) 10%, transparent) 100%)"
            : "linear-gradient(135deg, rgba(255,255,255,0.025) 0%, transparent 60%)",
        }}
      />
      {/* mesh-light specular — pure white, no cyan tint */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 26% 30%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 24%, transparent 60%)",
        }}
      />
      {/* top rim — cyan whisper, not sing */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: 1.5,
          background:
            "linear-gradient(to right, transparent 0%, rgba(255,255,255,0.28) 30%, color-mix(in oklab, var(--hud-cyan) 28%, transparent) 50%, rgba(255,255,255,0.28) 70%, transparent 100%)",
        }}
      />

      <div className="relative flex h-full flex-col px-3 py-2.5">
        {/* Row 1 — identity + clock */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MenuBarOpenScoutGlyph />
            <span className="font-display text-[12px] leading-none text-studio-ink">
              OpenScout
            </span>
            <span
              aria-hidden
              className="h-3 w-px"
              style={{ background: "var(--hud-glass-stroke-soft)" }}
            />
            <span className="font-mono text-[9.5px] tabular-nums text-studio-ink-muted">
              {fleet.length} agents
            </span>
          </div>
          <BarSparkline pulse={mergePulse(fleet)} attention={isAttention} />
        </div>

        {/* Row 2 — fleet hue chips */}
        <div className="mt-2 flex items-center gap-1">
          {fleet.map((a) => (
            <FleetChip
              key={a.id}
              agent={a}
              attention={a.state === "needs-attention"}
              completed={a.id === completedId}
            />
          ))}
        </div>

        {/* Row 3 — current-attention headline */}
        <div className="mt-auto flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              background: isAttention ? "var(--hud-rose)" : "rgba(255,255,255,0.55)",
              boxShadow: isAttention ? "0 0 8px var(--hud-rose-soft)" : undefined,
            }}
          />
          <span
            className="truncate font-sans text-[11px] leading-tight text-studio-ink"
            style={{ opacity: 0.95 }}
          >
            <span className="font-medium">{headline.agent.name}</span>{" "}
            <span style={{ opacity: 0.78 }}>{headline.msg}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function FleetChip({
  agent,
  attention,
  completed,
}: {
  agent: HudAgent;
  attention?: boolean;
  completed?: boolean;
}) {
  const hue = `oklch(0.42 0.008 80)`;
  const bg = attention
    ? "var(--hud-rose)"
    : completed
    ? "var(--hud-cyan)"
    : hue;
  return (
    <span
      title={`${agent.name} · ${agent.task}`}
      className="relative grid h-[18px] place-items-center rounded-[3px] px-1.5"
      style={{
        background: `color-mix(in oklab, ${bg} 14%, transparent)`,
        border: `0.75px solid color-mix(in oklab, ${bg} 38%, transparent)`,
      }}
    >
      <span
        className="font-mono text-[8.5px] font-semibold leading-none"
        style={{
          color: attention || completed ? bg : `color-mix(in oklab, ${bg} 90%, white)`,
          letterSpacing: "0.02em",
        }}
      >
        {agent.name.slice(0, 2).toUpperCase()}
      </span>
      {/* status pip */}
      <span
        aria-hidden
        className="absolute -top-[2px] -right-[2px] h-[5px] w-[5px] rounded-full"
        style={{
          background: bg,
          boxShadow: attention ? "0 0 4px var(--hud-rose-soft)" : undefined,
        }}
      />
    </span>
  );
}

function BarSparkline({
  pulse,
  attention,
}: {
  pulse: number[];
  attention?: boolean;
}) {
  const W = 64;
  const H = 14;
  const step = W / (pulse.length - 1);
  const points = pulse
    .map((v, i) => `${(i * step).toFixed(1)},${(H - v * H).toFixed(1)}`)
    .join(" ");
  // Monochrome ink by default; rose only when attention is the headline.
  const color = attention ? "var(--hud-rose)" : "rgba(255,255,255,0.75)";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={attention ? 0.85 : 1}
      />
      <circle
        cx={W}
        cy={H - pulse[pulse.length - 1] * H}
        r={1.6}
        fill={color}
      />
    </svg>
  );
}

function mergePulse(fleet: HudAgent[]): number[] {
  const len = 12;
  const out = new Array(len).fill(0);
  for (const a of fleet) {
    if (!a.pulse) continue;
    for (let i = 0; i < len; i++) out[i] += a.pulse[i];
  }
  // normalize to ~1
  const max = Math.max(...out, 1);
  return out.map((v) => Math.min(1, v / max));
}

function DesktopMenuBar() {
  return (
    <div
      className="absolute inset-x-0 top-0 flex items-center gap-3 px-3"
      style={{
        height: 26,
        background: "rgba(20, 22, 28, 0.85)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(8px)",
      }}
    >
      <span className="font-mono text-[10px] text-studio-ink-faint"></span>
      <span className="font-mono text-[10px] text-studio-ink-faint">File</span>
      <span className="font-mono text-[10px] text-studio-ink-faint">Edit</span>
      <div className="ml-auto flex items-center gap-3">
        <MenuBarOpenScoutGlyph />
        <span className="font-mono text-[10px] text-studio-ink-faint">9:24</span>
      </div>
    </div>
  );
}

// ── 3 · Variant B · Floating panel (v2 centerpiece, deepened rows) ───

function VariantBPanelSection() {
  return (
    <section className="mt-16">
      <SectionHead
        kicker="variant B · floating panel"
        title="The focused glance — three rich rows, not five sparse ones"
        lede="The v2 cockpit, recalibrated. Drops to three visible rows so each one can carry the agent's last-turn summary, a stat strip, and the most recent cross-agent message. Same 340×460 glass, same chrome, materially deeper per row."
      />

      <div className="mt-6 flex justify-center">
        <ScreenFrame width={1080} height={680}>
          <BackdropEditor />
          <FloatingHudWrapper anchor="top-right">
            <HudPanel
              header="OpenScout"
              subhead="3 agents · 1 on you"
              agents={FLEET_PANEL}
              specular={{ x: 0.30, y: 0.32 }}
              activeRowId="hudson"
            />
          </FloatingHudWrapper>
        </ScreenFrame>
      </div>

      <Caption>
        centerpiece — Hudson active (cyan stroke), Drover flagged (rose accent + ask line), Pike steady. Each row carries last-turn + stat strip + outbound message.
      </Caption>

      <div className="mt-12">
        <h3 className="font-display text-[18px] font-medium text-studio-ink">Content range</h3>
        <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
          Same shell, different fleet states. The deepened row pays off here — the operator gets enough on each row to decide whether to drill in without summoning the sheet.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <StateCard
            label="Idle"
            caption="empty doesn't mean silent — sleeping-dots glyph + a calm copy line."
          >
            <HudPanel
              header="OpenScout"
              subhead="quiet"
              agents={[]}
              emptyMessage="Nothing in flight. Fleet is at rest."
              specular={{ x: 0.50, y: 0.50 }}
            />
          </StateCard>
          <StateCard
            label="Three steady"
            caption="all-cyan — the panel reads as a working trio. No ask, no done state."
          >
            <HudPanel
              header="OpenScout"
              subhead="3 agents"
              agents={FLEET_PANEL_QUIET}
              specular={{ x: 0.78, y: 0.42 }}
            />
          </StateCard>
          <StateCard
            label="One on you"
            caption="Drover's ask owns the panel — rose row, rose accent in the subhead count."
          >
            <HudPanel
              header="OpenScout"
              subhead="3 agents · 1 on you"
              agents={FLEET_PANEL}
              specular={{ x: 0.20, y: 0.62 }}
            />
          </StateCard>
          <StateCard
            label="Just-completed"
            caption="Atlas done at top, cyan handoff pip at the foot — the bridge to studio."
          >
            <HudPanel
              header="OpenScout"
              subhead="3 agents · 1 just done"
              agents={FLEET_PANEL_DONE}
              showOpenInStudio
              specular={{ x: 0.62, y: 0.78 }}
            />
          </StateCard>
        </div>
      </div>

      <div className="mt-12">
        <h3 className="font-display text-[18px] font-medium text-studio-ink">Calibrated for dark hosts</h3>
        <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
          The panel only earns its keep over dark surfaces — coding, terminal, dim desktop. On a light host it would still draw, but the rim light and cool palette stop being the right vocabulary.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <BackdropCell label="Dark editor" note="blur smooths the monospace into a soft field — panel reads cleanly.">
            <ScreenFrame width={520} height={460} compact>
              <BackdropEditor />
              <FloatingHudWrapper anchor="center" scale={0.72}>
                <HudPanel header="OpenScout" subhead="3 agents · 1 on you" agents={FLEET_PANEL} specular={{ x: 0.34, y: 0.30 }} />
              </FloatingHudWrapper>
            </ScreenFrame>
          </BackdropCell>
          <BackdropCell label="Terminal (green)" note="loud backdrop, cool palette holds — cyan rim picks up against the green ambience without competing.">
            <ScreenFrame width={520} height={460} compact>
              <BackdropTerminal />
              <FloatingHudWrapper anchor="center" scale={0.72}>
                <HudPanel header="OpenScout" subhead="3 agents · 1 on you" agents={FLEET_PANEL} specular={{ x: 0.70, y: 0.55 }} />
              </FloatingHudWrapper>
            </ScreenFrame>
          </BackdropCell>
          <BackdropCell label="Dim desktop" note="rim light does the work of saying 'panel' when the host barely tints the substrate.">
            <ScreenFrame width={520} height={460} compact>
              <BackdropDimDesktop />
              <FloatingHudWrapper anchor="center" scale={0.72}>
                <HudPanel header="OpenScout" subhead="3 agents · 1 on you" agents={FLEET_PANEL} specular={{ x: 0.48, y: 0.40 }} />
              </FloatingHudWrapper>
            </ScreenFrame>
          </BackdropCell>
        </div>
      </div>
    </section>
  );
}

function StateCard({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {label}
      </div>
      <div
        className="mt-2 grid place-items-center rounded-[6px] border border-studio-edge p-5"
        style={{
          background:
            "radial-gradient(ellipse at top, var(--studio-canvas-alt) 0%, var(--studio-canvas) 80%)",
          minHeight: HUD_H + 60,
        }}
      >
        <div style={{ transform: "scale(0.78)", transformOrigin: "center" }}>
          {children}
        </div>
      </div>
      <p className="mt-2 font-sans text-[11.5px] italic leading-relaxed text-studio-ink-faint">
        {caption}
      </p>
    </div>
  );
}

function BackdropCell({
  label,
  note,
  children,
}: {
  label: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {label}
      </div>
      <div className="mt-2 flex justify-center">{children}</div>
      <p className="mt-2 font-sans text-[11.5px] leading-relaxed text-studio-ink-muted">
        {note}
      </p>
    </div>
  );
}

// ── 4 · Variant C · Pull-down sheet ──────────────────────────────────

function VariantCSheetSection() {
  return (
    <section className="mt-16">
      <SectionHead
        kicker="variant C · pull-down sheet"
        title="The briefing — a third of the screen, the whole picture"
        lede="Dropped down from the menu bar with ↓ from the family. ~1/3 of typical screen height. This is where the IA stretches — and where the form has room to take multiple IA stances on the same data. The first stance is the Standard layout: left rail · filter strip · 4 full agent cards. Two further stances follow."
      />

      {/* Layout 1 — Standard (hero) */}
      <div className="mt-6">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · layout 1 · standard
        </div>
        <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
          The default. Fleet rail on the left, filter strip across the top, a 4-column grid of full agent cards underneath. Every card carries a real last-turn summary, a stat block, the most recent cross-agent message, and an explicit ask if there is one.
        </p>
        <div className="mt-4 flex justify-center">
          <PullDownSheet fleet={FLEET_FULL} />
        </div>
      </div>

      <div className="mt-10 flex flex-col gap-10">
        <div>
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · standard · filter on "needs you"
          </div>
          <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
            Filter strip collapses the grid to just the agent(s) waiting on the operator. Drover's card grows to fill the freed column, and the empty columns get a sleeping-dots glyph so the sheet doesn&apos;t look broken.
          </p>
          <div className="mt-4 flex justify-center">
            <PullDownSheet fleet={FLEET_FULL} filter="attention" />
          </div>
        </div>

        <div>
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · standard · just-completed run
          </div>
          <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
            Atlas just finished its icon-set run. The card flips to a check-notch posture; the cross-agent message and a single &quot;open in studio&quot; CTA replace the live pulse. Operator can act on the handoff without leaving the briefing.
          </p>
          <div className="mt-4 flex justify-center">
            <PullDownSheet fleet={[ATLAS, HUDSON, PIKE, QUILL, COBALT, DROVER]} highlightId="atlas" />
          </div>
        </div>
      </div>

      {/* Alternative IA stances — Mission view + Conversation graph */}
      <div className="mt-14">
        <h3 className="font-display text-[18px] font-medium text-studio-ink">
          Three sheet stances — same data, different IA
        </h3>
        <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
          The sheet has the real estate to take radically different stances on the same fleet. Pick what serves the moment; switch with a re-summon, or — eventually — a cycle key. Above is Layout 1 · Standard. Below are two alternatives.
        </p>

        <div className="mt-8">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · layout 2 · mission view
          </div>
          <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
            Agents grouped by what they&apos;re working on, not as a flat list. Each mission is a labeled cluster. The operator sees which <em>initiatives</em> are active — not just which agents. The mission with the rose left-border is the one carrying the operator-blocked agent.
          </p>
          <div className="mt-4 flex justify-center">
            <PullDownSheetMission fleet={FLEET_FULL} />
          </div>
        </div>

        <div className="mt-10">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · layout 3 · conversation graph
          </div>
          <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
            Agents as positioned nodes; cross-agent messages as arcs between them. The shape of the graph answers a question the standard layout can&apos;t: who is talking to whom, and about what. The operator sits in the corner as a larger node; rose arc points at the operator from any agent waiting on a call.
          </p>
          <div className="mt-4 flex justify-center">
            <PullDownSheetGraph fleet={FLEET_FULL} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Layout 2 · Mission view ──────────────────────────────────────────

interface MissionGroup {
  id: string;
  title: string;
  agentIds: string[];
  attention?: boolean;
}

const MISSION_GROUPS: MissionGroup[] = [
  { id: "auth", title: "Auth audit", agentIds: ["hudson", "quill"] },
  { id: "migration", title: "Migration roll", agentIds: ["drover", "cobalt", "pike"], attention: true },
  { id: "landing", title: "Landing copy", agentIds: ["atlas"] },
];

function PullDownSheetMission({ fleet }: { fleet: HudAgent[] }) {
  const byId = Object.fromEntries(fleet.map((a) => [a.id, a]));
  return (
    <SheetShell>
      <div className="relative grid h-full" style={{ gridTemplateColumns: "260px 1fr" }}>
        <SheetLeftRail fleet={fleet} />
        <div className="flex min-w-0 flex-col">
          <SheetFilterStrip fleet={fleet} />
          <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4 pt-3">
            {MISSION_GROUPS.map((g) => {
              const agents = g.agentIds.map((id) => byId[id]).filter(Boolean) as HudAgent[];
              if (agents.length === 0) return null;
              return <MissionRow key={g.id} group={g} agents={agents} />;
            })}
          </div>
        </div>
      </div>
    </SheetShell>
  );
}

function MissionRow({ group, agents }: { group: MissionGroup; agents: HudAgent[] }) {
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-[5px] px-3 py-2.5"
      style={{
        background: group.attention
          ? "color-mix(in oklab, var(--hud-rose) 5%, transparent)"
          : "rgba(255,255,255,0.025)",
        borderLeft: group.attention
          ? "2px solid var(--hud-rose)"
          : "2px solid rgba(255,255,255,0.10)",
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[13px] text-studio-ink">{group.title}</span>
          <span
            className="font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint"
          >
            {agents.length} {agents.length === 1 ? "agent" : "agents"}
          </span>
        </div>
        {group.attention ? (
          <span
            className="font-mono text-[8.5px] uppercase tracking-eyebrow"
            style={{ color: "var(--hud-rose)" }}
          >
            blocked on you
          </span>
        ) : null}
      </div>
      <div
        className="grid min-w-0 gap-2"
        style={{ gridTemplateColumns: `repeat(${Math.min(agents.length, 4)}, minmax(0, 1fr))` }}
      >
        {agents.map((a) => (
          <MissionAgentCard key={a.id} agent={a} />
        ))}
      </div>
    </div>
  );
}

function MissionAgentCard({ agent }: { agent: HudAgent }) {
  const isAttention = agent.state === "needs-attention";
  const hue = `oklch(0.42 0.008 80)`;
  const stripe = isAttention ? "var(--hud-rose)" : hue;
  const glyphColor = isAttention
    ? "var(--hud-rose)"
    : agent.state === "working" || agent.state === "done"
    ? "var(--hud-cyan)"
    : "rgba(255,255,255,0.55)";
  return (
    <div
      className="relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-[4px] px-2.5 py-2"
      style={{
        background: isAttention
          ? "color-mix(in oklab, var(--hud-rose) 7%, var(--hud-glass-fill))"
          : "var(--hud-glass-fill)",
        border: `0.75px solid ${isAttention ? "var(--hud-rose-soft)" : "var(--hud-glass-stroke-soft)"}`,
      }}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full"
        style={{ width: 2, background: stripe }}
      />
      <div className="flex items-center gap-1.5 pl-1">
        <StatusGlyph state={agent.state} color={glyphColor} />
        <span className="truncate font-sans text-[12px] font-medium text-studio-ink">
          {agent.name}
        </span>
        <span
          className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-studio-ink"
          style={{ opacity: 0.65 }}
        >
          {agent.ago}
        </span>
      </div>
      <p
        className="font-sans text-[10.5px] leading-snug text-studio-ink pl-1"
        style={{
          opacity: 0.85,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {isAttention ? agent.pendingAsk : agent.task}
      </p>
      {agent.lastMessage ? (
        <div className="flex min-w-0 items-center gap-1 pl-1">
          <MessageArrow />
          <span
            className="shrink-0 font-mono text-[9px] text-studio-ink"
            style={{ opacity: 0.92 }}
          >
            @{agent.lastMessage.to}
          </span>
          <span
            className="truncate font-sans text-[9.5px] italic text-studio-ink"
            style={{ opacity: 0.72 }}
          >
            “{agent.lastMessage.text}”
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ── Layout 3 · Conversation graph ────────────────────────────────────

interface GraphNode {
  id: string;
  x: number; // 0..1
  y: number; // 0..1
}

const GRAPH_NODES: GraphNode[] = [
  { id: "hudson", x: 0.18, y: 0.30 },
  { id: "drover", x: 0.36, y: 0.62 },
  { id: "pike", x: 0.50, y: 0.22 },
  { id: "quill", x: 0.62, y: 0.48 },
  { id: "atlas", x: 0.78, y: 0.30 },
  { id: "cobalt", x: 0.86, y: 0.72 },
];

interface GraphEdge {
  from: string;
  to: string; // "operator" or an agent id
  text: string;
  attention?: boolean;
}

const GRAPH_EDGES: GraphEdge[] = [
  { from: "hudson", to: "drover", text: "hand me the migration file when done" },
  { from: "drover", to: "operator", text: "blocked on operator — order matters", attention: true },
  { from: "drover", to: "hudson", text: "will hand off the file the moment it lands" },
  { from: "pike", to: "atlas", text: "new ease curve lives in HudCurves.ts" },
  { from: "atlas", to: "pike", text: "icons sized for 14/18/24px — thanks" },
  { from: "quill", to: "hudson", text: "quote the audit review as canonical example?" },
  { from: "cobalt", to: "operator", text: "quota approval still pending — not blocking" },
];

function PullDownSheetGraph({ fleet }: { fleet: HudAgent[] }) {
  return (
    <SheetShell>
      <div className="relative grid h-full" style={{ gridTemplateColumns: "260px 1fr" }}>
        <SheetLeftRail fleet={fleet} />
        <div className="flex min-w-0 flex-col">
          <SheetFilterStrip fleet={fleet} />
          <div className="flex flex-1 overflow-hidden p-4 pt-3">
            <ConversationGraphCanvas fleet={fleet} />
          </div>
        </div>
      </div>
    </SheetShell>
  );
}

function ConversationGraphCanvas({ fleet }: { fleet: HudAgent[] }) {
  // Canvas dimensions for math. Rendered as percent positions inside a flexible box.
  const W = 1024;
  const H = 332;
  const NODE_R = 22;
  const OP_R = 32;

  const byId = Object.fromEntries(fleet.map((a) => [a.id, a]));
  const nodes = GRAPH_NODES.map((n) => {
    const a = byId[n.id];
    return { ...n, agent: a, px: n.x * W, py: n.y * H };
  });
  const operator = { id: "operator", px: W - 60, py: H - 40, r: OP_R };

  function nodePos(id: string) {
    if (id === "operator") return { px: operator.px, py: operator.py, r: operator.r };
    const n = nodes.find((x) => x.id === id);
    return n ? { px: n.px, py: n.py, r: NODE_R } : null;
  }

  // Build arc paths: a curved cubic between endpoints; arrowhead near midpoint.
  function arcPath(x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    // perpendicular offset for curvature
    const len = Math.sqrt(dx * dx + dy * dy);
    const ox = (-dy / len) * Math.min(48, len * 0.18);
    const oy = (dx / len) * Math.min(48, len * 0.18);
    const cx = mx + ox;
    const cy = my + oy;
    return { d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, mx: cx, my: cy };
  }

  return (
    <div
      className="relative w-full"
      style={{
        background: "rgba(0,0,0,0.18)",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
        borderRadius: 5,
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full"
        aria-hidden
      >
        {/* edges first (under nodes) */}
        {GRAPH_EDGES.map((e, i) => {
          const a = nodePos(e.from);
          const b = nodePos(e.to);
          if (!a || !b) return null;
          // Trim line so it stops at node radius
          const dx = b.px - a.px;
          const dy = b.py - a.py;
          const len = Math.sqrt(dx * dx + dy * dy);
          const ux = dx / len;
          const uy = dy / len;
          const x1 = a.px + ux * a.r;
          const y1 = a.py + uy * a.r;
          const x2 = b.px - ux * b.r;
          const y2 = b.py - uy * b.r;
          const path = arcPath(x1, y1, x2, y2);
          const stroke = e.attention ? "var(--hud-rose)" : "rgba(255,255,255,0.42)";
          const textColor = e.attention ? "var(--hud-rose)" : "rgba(255,255,255,0.78)";
          // arrowhead near midpoint of arc
          const ahLen = 7;
          // angle along path at midpoint approximated from endpoints
          const ang = Math.atan2(y2 - y1, x2 - x1);
          const ahx = path.mx;
          const ahy = path.my;
          const ax1 = ahx - Math.cos(ang - 0.45) * ahLen;
          const ay1 = ahy - Math.sin(ang - 0.45) * ahLen;
          const ax2 = ahx - Math.cos(ang + 0.45) * ahLen;
          const ay2 = ahy - Math.sin(ang + 0.45) * ahLen;
          return (
            <g key={i}>
              <path
                d={path.d}
                fill="none"
                stroke={stroke}
                strokeWidth={e.attention ? 1.2 : 0.85}
                opacity={e.attention ? 0.95 : 0.85}
              />
              <path
                d={`M ${ax1} ${ay1} L ${ahx} ${ahy} L ${ax2} ${ay2}`}
                fill="none"
                stroke={stroke}
                strokeWidth={e.attention ? 1.2 : 0.85}
                opacity={e.attention ? 0.95 : 0.85}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* snippet text near midpoint, offset perpendicular to the arc */}
              <text
                x={path.mx}
                y={path.my - 6}
                fontSize={9}
                fill={textColor}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                textAnchor="middle"
                style={{ pointerEvents: "none" }}
              >
                {truncateWords(e.text, 7)}
              </text>
            </g>
          );
        })}

        {/* agent nodes */}
        {nodes.map((n) => {
          if (!n.agent) return null;
          const isAttention = n.agent.state === "needs-attention";
          const hue = `oklch(0.42 0.008 80)`;
          const fill = isAttention
            ? "color-mix(in oklab, var(--hud-rose) 22%, rgb(8,10,14))"
            : "rgb(12, 14, 18)";
          const stroke = isAttention ? "var(--hud-rose)" : hue;
          return (
            <g key={n.id}>
              <circle
                cx={n.px}
                cy={n.py}
                r={NODE_R}
                fill={fill}
                stroke={stroke}
                strokeWidth={1.3}
              />
              <text
                x={n.px}
                y={n.py + 4}
                fontSize={11}
                fill={isAttention ? "var(--hud-rose)" : "rgba(255,255,255,0.92)"}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fontWeight={600}
                textAnchor="middle"
              >
                {n.agent.name.slice(0, 2)}
              </text>
              <text
                x={n.px}
                y={n.py + NODE_R + 12}
                fontSize={10}
                fill="rgba(255,255,255,0.92)"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                textAnchor="middle"
              >
                {n.agent.name}
              </text>
              {/* status corner glyph */}
              <foreignObject
                x={n.px + NODE_R - 8}
                y={n.py - NODE_R - 2}
                width={14}
                height={14}
              >
                <div style={{ width: 14, height: 14 }}>
                  <StatusGlyph
                    state={n.agent.state}
                    color={
                      isAttention
                        ? "var(--hud-rose)"
                        : n.agent.state === "working" || n.agent.state === "done"
                        ? "var(--hud-cyan)"
                        : "rgba(255,255,255,0.6)"
                    }
                  />
                </div>
              </foreignObject>
            </g>
          );
        })}

        {/* operator node */}
        <g>
          <circle
            cx={operator.px}
            cy={operator.py}
            r={operator.r}
            fill="rgb(20, 22, 28)"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={1.5}
          />
          <text
            x={operator.px}
            y={operator.py + 4}
            fontSize={11}
            fill="rgba(255,255,255,0.95)"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontWeight={600}
            textAnchor="middle"
          >
            you
          </text>
          <text
            x={operator.px}
            y={operator.py + operator.r + 12}
            fontSize={9}
            fill="rgba(255,255,255,0.65)"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            textAnchor="middle"
          >
            OPERATOR
          </text>
        </g>
      </svg>
    </div>
  );
}

function truncateWords(s: string, n: number) {
  const words = s.split(/\s+/);
  if (words.length <= n) return s;
  return words.slice(0, n).join(" ") + "…";
}

/** Shared shell for the sheet — extracted so alt layouts can reuse the glass without duplicating chrome. */
function SheetShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative overflow-hidden rounded-b-[12px]"
      style={{
        width: SHEET_W,
        height: SHEET_H,
        background:
          "linear-gradient(180deg, var(--hud-base-top), var(--hud-base-bottom))",
        backdropFilter: "blur(24px) saturate(150%)",
        WebkitBackdropFilter: "blur(24px) saturate(150%)",
        borderLeft: "0.75px solid var(--hud-glass-stroke-soft)",
        borderRight: "0.75px solid var(--hud-glass-stroke-soft)",
        borderBottom: "0.75px solid var(--hud-glass-stroke-soft)",
        boxShadow:
          "0 24px 56px -16px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05) inset",
      }}
    >
      {/* accent tint wash — whisper only */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.020) 0%, transparent 50%, color-mix(in oklab, var(--hud-rose) 4%, transparent) 100%)",
        }}
      />
      {/* top-edge wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: SHEET_H / 2,
          background: "linear-gradient(to bottom, rgba(255,255,255,0.06), transparent)",
        }}
      />
      {/* mesh-light specular — pure white */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 28%, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.025) 22%, transparent 55%)",
        }}
      />
      {/* top rim — cyan whisper */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: 1.5,
          background:
            "linear-gradient(to right, transparent 0%, rgba(255,255,255,0.22) 25%, color-mix(in oklab, var(--hud-cyan) 24%, transparent) 50%, rgba(255,255,255,0.22) 75%, transparent 100%)",
        }}
      />
      {children}
    </div>
  );
}

/** The pull-down sheet form. */
function PullDownSheet({
  fleet,
  filter,
  highlightId,
}: {
  fleet: HudAgent[];
  filter?: "attention";
  highlightId?: string;
}) {
  const visible = filter === "attention" ? fleet.filter((a) => a.state === "needs-attention") : fleet.slice(0, 4);
  // Pad to 4 slots so the grid stays steady when filtered.
  const slots: (HudAgent | null)[] = [...visible];
  while (slots.length < 4) slots.push(null);

  return (
    <div
      className="relative overflow-hidden rounded-b-[12px]"
      style={{
        width: SHEET_W,
        height: SHEET_H,
        background:
          "linear-gradient(180deg, var(--hud-base-top), var(--hud-base-bottom))",
        backdropFilter: "blur(24px) saturate(150%)",
        WebkitBackdropFilter: "blur(24px) saturate(150%)",
        borderLeft: "0.75px solid var(--hud-glass-stroke-soft)",
        borderRight: "0.75px solid var(--hud-glass-stroke-soft)",
        borderBottom: "0.75px solid var(--hud-glass-stroke-soft)",
        boxShadow:
          "0 24px 56px -16px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05) inset",
      }}
    >
      {/* accent tint wash — dropped to a whisper; dark base + top-edge rim carry the look */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.020) 0%, transparent 50%, color-mix(in oklab, var(--hud-rose) 4%, transparent) 100%)",
        }}
      />
      {/* top-edge wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: SHEET_H / 2,
          background: "linear-gradient(to bottom, rgba(255,255,255,0.06), transparent)",
        }}
      />
      {/* mesh-light specular — pure white, no cyan tint */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 28%, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.025) 22%, transparent 55%)",
        }}
      />
      {/* top rim — cyan center stop pulled down to a whisper */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: 1.5,
          background:
            "linear-gradient(to right, transparent 0%, rgba(255,255,255,0.22) 25%, color-mix(in oklab, var(--hud-cyan) 24%, transparent) 50%, rgba(255,255,255,0.22) 75%, transparent 100%)",
        }}
      />

      <div className="relative grid h-full" style={{ gridTemplateColumns: "260px 1fr" }}>
        {/* Left rail — fleet summary */}
        <SheetLeftRail fleet={fleet} />

        {/* Right side — filter strip + agent cards */}
        <div className="flex min-w-0 flex-col">
          <SheetFilterStrip activeFilter={filter} fleet={fleet} />
          <div
            className="grid flex-1 gap-3 p-4 pt-3"
            style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
          >
            {slots.map((a, i) =>
              a ? (
                <AgentCard
                  key={a.id}
                  agent={a}
                  emphasized={a.id === highlightId}
                  expanded={filter === "attention" && visible.length === 1}
                />
              ) : (
                <SleepingCardSlot key={`empty-${i}`} />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SheetLeftRail({ fleet }: { fleet: HudAgent[] }) {
  const totals = {
    working: fleet.filter((a) => a.state === "working").length,
    attention: fleet.filter((a) => a.state === "needs-attention").length,
    waiting: fleet.filter((a) => a.state === "waiting").length,
    done: fleet.filter((a) => a.state === "done").length,
  };
  const attentionAgent = fleet.find((a) => a.state === "needs-attention");

  return (
    <div
      className="relative flex flex-col gap-4 px-5 py-5"
      style={{
        background: "rgba(0,0,0,0.18)",
        borderRight: "1px solid var(--hud-glass-stroke-soft)",
      }}
    >
      {/* Identity */}
      <div className="flex items-center gap-2.5">
        <MenuBarOpenScoutGlyph />
        <span className="font-display text-[16px] leading-none text-studio-ink">
          OpenScout
        </span>
      </div>
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
        · fleet briefing · 9:24am
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-2">
        <RailStat label="Working" value={totals.working} tone="cyan" />
        <RailStat label="On you" value={totals.attention} tone="rose" />
        <RailStat label="Waiting" value={totals.waiting} tone="neutral" />
        <RailStat label="Just done" value={totals.done} tone="cyan-check" />
      </div>

      {/* Attention call-out */}
      {attentionAgent ? (
        <div
          className="rounded-[5px] px-3 py-2.5"
          style={{
            background: "color-mix(in oklab, var(--hud-rose) 12%, transparent)",
            border: "0.75px solid var(--hud-rose-soft)",
          }}
        >
          <div className="flex items-center gap-1.5">
            <StatusGlyph state="needs-attention" color="var(--hud-rose)" />
            <span
              className="font-mono text-[9px] uppercase tracking-eyebrow"
              style={{ color: "var(--hud-rose)" }}
            >
              waiting on you
            </span>
          </div>
          <div className="mt-1 font-sans text-[12px] font-medium text-studio-ink">
            {attentionAgent.name}
          </div>
          <p className="mt-0.5 font-sans text-[11px] leading-snug text-studio-ink">
            {attentionAgent.pendingAsk}
          </p>
        </div>
      ) : null}

      {/* Fleet hue legend */}
      <div className="mt-auto flex flex-col gap-1.5">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          · fleet
        </div>
        {fleet.map((a) => (
          <RailLegendRow key={a.id} agent={a} />
        ))}
      </div>

      {/* Hotkey hint */}
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span style={{ color: "var(--studio-ink)" }}>⌥⇧ space</span> to dismiss
      </div>
    </div>
  );
}

function RailStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "cyan" | "rose" | "neutral" | "cyan-check";
}) {
  // Only rose carries meaning here — every other numeral is ink.
  const color = tone === "rose" ? "var(--hud-rose)" : "var(--studio-ink)";
  return (
    <div
      className="flex flex-col gap-0.5 rounded-[4px] px-2.5 py-2"
      style={{
        background: "var(--hud-glass-fill)",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
      }}
    >
      <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
      <span
        className="font-mono text-[18px] font-medium leading-none tabular-nums"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}

function RailLegendRow({ agent }: { agent: HudAgent }) {
  const isAttention = agent.state === "needs-attention";
  const hue = `oklch(0.42 0.008 80)`;
  const color = isAttention ? "var(--hud-rose)" : hue;
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="block h-2 w-2 rounded-[1.5px]"
        style={{ background: color }}
      />
      <span className="flex-1 font-sans text-[11px] text-studio-ink">
        {agent.name}
      </span>
      <span
        className="font-mono text-[9px] tabular-nums text-studio-ink"
        style={{ opacity: 0.65 }}
      >
        {agent.runtime}
      </span>
    </div>
  );
}

function SheetFilterStrip({
  activeFilter,
  fleet,
}: {
  activeFilter?: "attention";
  fleet: HudAgent[];
}) {
  const counts = {
    all: fleet.length,
    attention: fleet.filter((a) => a.state === "needs-attention").length,
    working: fleet.filter((a) => a.state === "working").length,
    done: fleet.filter((a) => a.state === "done").length,
  };
  const chips: Array<{ id: string; label: string; n: number; active: boolean; tone: "neutral" | "rose" | "cyan" }> = [
    { id: "all", label: "All", n: counts.all, active: !activeFilter, tone: "neutral" },
    { id: "attention", label: "Needs you", n: counts.attention, active: activeFilter === "attention", tone: "rose" },
    { id: "working", label: "Working", n: counts.working, active: false, tone: "neutral" },
    { id: "done", label: "Just done", n: counts.done, active: false, tone: "neutral" },
  ];

  return (
    <div
      className="flex items-center justify-between px-4 py-2.5"
      style={{ borderBottom: "1px solid var(--hud-glass-stroke-soft)" }}
    >
      <div className="flex items-center gap-1.5">
        {chips.map((c) => (
          <FilterChip key={c.id} {...c} />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Hotkey keys={["⌥", "⇧", "space"]} compact />
        <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          toggle to dismiss
        </span>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  n,
  active,
  tone,
}: {
  label: string;
  n: number;
  active: boolean;
  tone: "neutral" | "rose" | "cyan";
}) {
  const color = tone === "rose" ? "var(--hud-rose)" : tone === "cyan" ? "var(--hud-cyan)" : "var(--studio-ink)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1"
      style={{
        background: active
          ? `color-mix(in oklab, ${color} 16%, transparent)`
          : "var(--hud-glass-fill)",
        border: `0.75px solid ${active ? `color-mix(in oklab, ${color} 38%, transparent)` : "var(--hud-glass-stroke-soft)"}`,
      }}
    >
      <span
        className="font-sans text-[11px] leading-none"
        style={{ color: active ? color : "var(--studio-ink)" }}
      >
        {label}
      </span>
      <span
        className="font-mono text-[9.5px] tabular-nums leading-none"
        style={{
          color: active ? color : "var(--studio-ink)",
          opacity: active ? 1 : 0.65,
        }}
      >
        {n}
      </span>
    </span>
  );
}

/** Sheet agent card — the deepest IA in the family. */
function AgentCard({
  agent,
  emphasized,
  expanded,
}: {
  agent: HudAgent;
  emphasized?: boolean;
  expanded?: boolean;
}) {
  const isAttention = agent.state === "needs-attention";
  const isDone = agent.state === "done";
  const hue = `oklch(0.42 0.008 80)`;
  const accent = isAttention ? "var(--hud-rose)" : isDone ? "var(--hud-cyan)" : hue;
  const stripeColor = isAttention ? "var(--hud-rose)" : hue;

  const fillBg = emphasized
    ? "var(--hud-glass-fill-strong)"
    : isAttention
    ? "color-mix(in oklab, var(--hud-rose) 8%, var(--hud-glass-fill))"
    : "var(--hud-glass-fill)";

  return (
    <div
      className="relative flex flex-col gap-2.5 overflow-hidden rounded-[6px] px-3 py-3"
      style={{
        gridColumn: expanded ? "span 2" : undefined,
        background: fillBg,
        border: `0.75px solid ${isAttention ? "var(--hud-rose-soft)" : emphasized ? "var(--hud-cyan-soft)" : "var(--hud-glass-stroke-soft)"}`,
        boxShadow: emphasized || isAttention
          ? "0 4px 12px -4px rgba(0,0,0,0.45)"
          : "0 2px 6px -3px rgba(0,0,0,0.3)",
      }}
    >
      {/* hue stripe */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full"
        style={{ width: isAttention ? 2.5 : 3, background: stripeColor }}
      />

      {/* identity row */}
      <div className="flex items-start gap-2 pl-1">
        <div className="mt-0.5 shrink-0">
          <StatusGlyph state={agent.state} color={accent} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-sans text-[13px] font-medium text-studio-ink">
              {agent.name}
            </span>
            <span
              className="shrink-0 font-mono text-[9px] tabular-nums text-studio-ink"
              style={{ opacity: 0.65 }}
            >
              {agent.ago}
            </span>
          </div>
          <span className="truncate font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            {agent.role}
          </span>
        </div>
      </div>

      {/* Pending ask, if any (rose card only) */}
      {isAttention && agent.pendingAsk ? (
        <div
          className="rounded-[4px] px-2 py-1.5"
          style={{
            background: "color-mix(in oklab, var(--hud-rose) 14%, transparent)",
            border: "0.75px solid var(--hud-rose-soft)",
          }}
        >
          <div className="font-mono text-[8.5px] uppercase tracking-eyebrow" style={{ color: "var(--hud-rose)" }}>
            waiting on you
          </div>
          <p className="mt-0.5 font-sans text-[11px] leading-snug text-studio-ink">
            {agent.pendingAsk}
          </p>
        </div>
      ) : null}

      {/* Last turn summary */}
      <div className="flex flex-col gap-1">
        <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          · last turn
        </div>
        <p
          className="font-sans text-[11.5px] italic leading-snug text-studio-ink"
          style={{
            opacity: 0.92,
            display: "-webkit-box",
            WebkitLineClamp: expanded ? 7 : 4,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {agent.lastTurn}
        </p>
      </div>

      {/* Stat block */}
      <StatBlock agent={agent} />

      {/* Cross-agent message */}
      {agent.lastMessage ? (
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            · last message
          </div>
          <CrossAgentSnippet to={agent.lastMessage.to} text={agent.lastMessage.text} />
        </div>
      ) : null}

      {/* Footer: lineage + pulse */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <SpawnLineage spawnedBy={agent.spawnedBy} self={agent.name} />
        <Sparkline
          pulse={agent.pulse ?? []}
          color={emphasized ? "var(--hud-cyan)" : "rgba(255,255,255,0.7)"}
          width={56}
          height={12}
        />
      </div>

      {/* Done state CTA — demoted to ink; the check-notch status glyph carries the cyan signal */}
      {isDone ? (
        <div
          className="flex items-center justify-between rounded-[3px] px-2 py-1.5"
          style={{
            background: "var(--hud-glass-fill)",
            border: "0.75px solid var(--hud-glass-stroke-soft)",
          }}
        >
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-muted">
            handoff ready
          </span>
          <span
            className="inline-flex items-center gap-1 font-mono text-[9.5px] text-studio-ink"
            style={{ opacity: 0.92 }}
          >
            open in studio
            <OpenArrow />
          </span>
        </div>
      ) : null}
    </div>
  );
}

function StatBlock({ agent }: { agent: HudAgent }) {
  return (
    <div
      className="grid gap-y-1 rounded-[4px] px-2 py-1.5"
      style={{
        gridTemplateColumns: "auto 1fr auto 1fr",
        background: "rgba(0,0,0,0.18)",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
        columnGap: 8,
      }}
    >
      <StatKV k="runtime" v={agent.runtime ?? "—"} />
      <StatKV k="files" v={(agent.files ?? 0).toString()} mono />
      <StatKV k="tokens" v={agent.tokens ?? "—"} mono />
      <StatKV k="model" v={agent.model ?? "—"} />
      <StatKV k="branch" v={agent.branch ?? "—"} span={3} />
    </div>
  );
}

function StatKV({
  k,
  v,
  mono,
  span,
}: {
  k: string;
  v: string;
  mono?: boolean;
  span?: number;
}) {
  return (
    <>
      <span
        className="font-mono text-[8.5px] uppercase leading-tight tracking-eyebrow text-studio-ink"
        style={{ opacity: 0.65 }}
      >
        {k}
      </span>
      <span
        className={`leading-tight tabular-nums ${mono ? "font-mono text-[10px]" : "font-sans text-[10.5px]"} text-studio-ink truncate`}
        style={span ? { gridColumn: `span ${span}` } : undefined}
      >
        {v}
      </span>
    </>
  );
}

function CrossAgentSnippet({ to, text }: { to: string; text: string }) {
  return (
    <div
      className="flex items-start gap-1.5 rounded-[4px] px-2 py-1.5"
      style={{
        background: "var(--hud-glass-fill)",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
      }}
    >
      <span className="mt-[1px] shrink-0">
        <MessageArrow />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="font-mono text-[10px] text-studio-ink"
          style={{ opacity: 0.92 }}
        >
          @{to}
        </span>
        <span
          className="font-sans text-[10.5px] leading-snug text-studio-ink"
          style={{ opacity: 0.85 }}
        >
          {" "}
          “{text}”
        </span>
      </span>
    </div>
  );
}

function SpawnLineage({ spawnedBy, self }: { spawnedBy?: string; self: string }) {
  if (!spawnedBy) return <span />;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[9px] text-studio-ink" style={{ opacity: 0.6 }}>
      <span>{spawnedBy === "operator" ? "you" : `@${spawnedBy.toLowerCase()}`}</span>
      <LineageArrow />
      <span>{self.toLowerCase()}</span>
    </span>
  );
}

function LineageArrow() {
  return (
    <svg width={10} height={6} viewBox="0 0 10 6" aria-hidden>
      <line x1={0} y1={3} x2={8} y2={3} stroke="currentColor" strokeWidth={0.8} />
      <path d="M6 1 L9 3 L6 5" fill="none" stroke="currentColor" strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MessageArrow() {
  return (
    <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden>
      <path d="M1 4.5 L7 4.5" stroke="rgba(255,255,255,0.78)" strokeWidth={1.1} strokeLinecap="round" />
      <path d="M5 2 L7.5 4.5 L5 7" fill="none" stroke="rgba(255,255,255,0.78)" strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Sparkline({
  pulse,
  color,
  width = 56,
  height = 12,
}: {
  pulse: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (!pulse.length) return null;
  const step = width / (pulse.length - 1);
  const pts = pulse
    .map((v, i) => `${(i * step).toFixed(1)},${(height - v * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.8}
      />
      <circle cx={width} cy={height - pulse[pulse.length - 1] * height} r={1.4} fill={color} />
    </svg>
  );
}

function SleepingCardSlot() {
  return (
    <div
      className="grid place-items-center rounded-[6px]"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "0.75px dashed var(--hud-glass-stroke-soft)",
      }}
    >
      <EmptyGlyph />
    </div>
  );
}

// ── 5 · IA explorations ──────────────────────────────────────────────

function IAExplorationsSection() {
  return (
    <section className="mt-16">
      <SectionHead
        kicker="IA explorations"
        title="Same agent, four stances"
        lede="Drover, rendered four ways at panel-row scale (~360px wide). Sketches to react to, not finished design. Each treatment foregrounds a different dimension: numbers, narrative, timeline, chat-snippet. Picking one means picking what the operator is allowed to feel about an agent at a glance."
      />

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <IATreatmentCard
          label="Treatment 1 · Dense numerical"
          caption="numbers carry the row. KV table dominant, narrative shrinks to a one-line caption. Reads like a process monitor."
        >
          <IATreatmentDense agent={DROVER} />
        </IATreatmentCard>
        <IATreatmentCard
          label="Treatment 2 · Narrative-led"
          caption="the agent's last turn IS the row. Stats compress to a thin foot strip; identity moves to the kicker."
        >
          <IATreatmentNarrative agent={DROVER} />
        </IATreatmentCard>
        <IATreatmentCard
          label="Treatment 3 · Timeline-led"
          caption="recent events along a 5-minute axis. Spawn · checkpoint · message · file burst · waiting. Reads like an activity strip."
        >
          <IATreatmentTimeline agent={DROVER} />
        </IATreatmentCard>
        <IATreatmentCard
          label="Treatment 4 · Chat-snippet-led"
          caption="the cross-agent message is the lede; identity and stats live around the periphery. Reads like a notification."
        >
          <IATreatmentSnippet agent={DROVER} />
        </IATreatmentCard>
      </div>

      <p className="mx-auto mt-5 max-w-prose font-sans text-[12.5px] italic leading-relaxed text-studio-ink-faint">
        Same agent, four IA stances — sketches to react to, not finished design. The panel ships one of these; the sheet may compose two or three on the same card.
      </p>
    </section>
  );
}

function IATreatmentCard({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {label}
      </div>
      <div
        className="mt-2 grid place-items-center rounded-[6px] border border-studio-edge p-6"
        style={{
          background:
            "radial-gradient(ellipse at top, var(--studio-canvas-alt) 0%, var(--studio-canvas) 80%)",
          minHeight: 240,
        }}
      >
        {children}
      </div>
      <p className="mt-2 font-sans text-[11.5px] italic leading-relaxed text-studio-ink-faint">
        {caption}
      </p>
    </div>
  );
}

/** Shared shell — same glass body for all four IA treatments. */
function IAShell({
  children,
  width = 380,
  height = 168,
  attention,
}: {
  children: ReactNode;
  width?: number;
  height?: number;
  attention?: boolean;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[6px]"
      style={{
        width,
        height,
        background:
          "linear-gradient(135deg, var(--hud-base-top), var(--hud-base-bottom))",
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        border: `0.75px solid ${attention ? "var(--hud-rose-soft)" : "var(--hud-glass-stroke-soft)"}`,
        boxShadow:
          "0 12px 28px -12px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05) inset",
      }}
    >
      {/* accent wash — rose only when attention; otherwise pure dark + thin white wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: attention
            ? "linear-gradient(135deg, transparent 0%, transparent 40%, color-mix(in oklab, var(--hud-rose) 10%, transparent) 100%)"
            : "linear-gradient(135deg, rgba(255,255,255,0.025) 0%, transparent 60%)",
        }}
      />
      {/* mesh-light */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 28% 30%, rgba(255,255,255,0.08) 0%, transparent 55%)",
        }}
      />
      {/* rim — cyan center stop dropped to a whisper */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: 1,
          background:
            "linear-gradient(to right, transparent 0%, rgba(255,255,255,0.22) 30%, color-mix(in oklab, var(--hud-cyan) 24%, transparent) 50%, rgba(255,255,255,0.22) 70%, transparent 100%)",
        }}
      />
      {/* left stripe — rose for attention, neutral ink otherwise (cyan reserved for focused/active) */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full"
        style={{
          width: attention ? 2.5 : 3,
          background: attention ? "var(--hud-rose)" : "rgba(255,255,255,0.22)",
        }}
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}

function IATreatmentDense({ agent }: { agent: HudAgent }) {
  const isAttention = agent.state === "needs-attention";
  return (
    <IAShell attention={isAttention}>
      <div className="flex h-full flex-col gap-2 px-3.5 py-3 pl-4">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <StatusGlyph state={agent.state} color={isAttention ? "var(--hud-rose)" : "var(--hud-cyan)"} />
            <span className="font-sans text-[13px] font-medium text-studio-ink">
              {agent.name}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              {agent.role}
            </span>
          </div>
          <span className="font-mono text-[9.5px] tabular-nums text-studio-ink" style={{ opacity: 0.65 }}>
            {agent.ago}
          </span>
        </div>
        <p
          className="font-sans text-[10.5px] leading-snug text-studio-ink"
          style={{ opacity: 0.78 }}
        >
          {agent.task}
        </p>
        <div
          className="mt-1 grid flex-1 items-center gap-y-1 rounded-[4px] px-3 py-2"
          style={{
            gridTemplateColumns: "auto 1fr auto 1fr auto 1fr",
            background: "rgba(0,0,0,0.22)",
            border: "0.75px solid var(--hud-glass-stroke-soft)",
            columnGap: 12,
          }}
        >
          <StatKV k="runtime" v={agent.runtime!} />
          <StatKV k="files" v={agent.files!.toString()} mono />
          <StatKV k="tokens" v={agent.tokens!} mono />
          <StatKV k="model" v={agent.model!} />
          <StatKV k="branch" v={agent.branch!} />
          <StatKV k="proj" v={agent.project!.split("/")[1]} />
        </div>
      </div>
    </IAShell>
  );
}

function IATreatmentNarrative({ agent }: { agent: HudAgent }) {
  const isAttention = agent.state === "needs-attention";
  return (
    <IAShell attention={isAttention}>
      <div className="flex h-full flex-col gap-2 px-3.5 py-3 pl-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusGlyph state={agent.state} color={isAttention ? "var(--hud-rose)" : "var(--hud-cyan)"} />
            <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              {agent.name} · {agent.role}
            </span>
          </div>
          <span className="font-mono text-[9.5px] tabular-nums text-studio-ink" style={{ opacity: 0.65 }}>
            {agent.ago} · {agent.runtime}
          </span>
        </div>
        <p
          className="flex-1 font-sans text-[12px] italic leading-snug text-studio-ink"
          style={{ opacity: 0.95 }}
        >
          “{agent.lastTurn}”
        </p>
        <div
          className="flex items-center justify-between rounded-[3px] px-2 py-1.5"
          style={{
            background: "rgba(0,0,0,0.2)",
            border: "0.75px solid var(--hud-glass-stroke-soft)",
          }}
        >
          <span className="font-mono text-[9.5px] tabular-nums text-studio-ink" style={{ opacity: 0.75 }}>
            {agent.files}f · {agent.tokens} · {agent.model}
          </span>
          <span className="font-mono text-[9.5px] tabular-nums text-studio-ink" style={{ opacity: 0.6 }}>
            {agent.branch}
          </span>
        </div>
      </div>
    </IAShell>
  );
}

function IATreatmentTimeline({ agent }: { agent: HudAgent }) {
  const isAttention = agent.state === "needs-attention";
  return (
    <IAShell attention={isAttention}>
      <div className="flex h-full flex-col gap-2 px-3.5 py-3 pl-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusGlyph state={agent.state} color={isAttention ? "var(--hud-rose)" : "var(--hud-cyan)"} />
            <span className="font-sans text-[13px] font-medium text-studio-ink">{agent.name}</span>
            <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              {agent.role}
            </span>
          </div>
          <span className="font-mono text-[9.5px] tabular-nums text-studio-ink" style={{ opacity: 0.65 }}>
            since {agent.runtime}
          </span>
        </div>
        <EventTimeline
          events={[
            { t: "−47m", label: "spawned", glyph: "spawn" },
            { t: "−32m", label: "checkpoint", glyph: "check" },
            { t: "−8m", label: "→ @hudson", glyph: "msg" },
            { t: "−3m", label: "6 files", glyph: "burst" },
            { t: "now", label: "waiting", glyph: "wait", attention: isAttention },
          ]}
        />
        <p
          className="font-sans text-[11px] leading-snug text-studio-ink"
          style={{ opacity: 0.85 }}
        >
          {isAttention ? agent.pendingAsk : agent.task}
        </p>
      </div>
    </IAShell>
  );
}

function EventTimeline({
  events,
}: {
  events: Array<{ t: string; label: string; glyph: "spawn" | "check" | "msg" | "burst" | "wait"; attention?: boolean }>;
}) {
  return (
    <div className="relative">
      {/* timeline rail */}
      <div className="absolute left-0 right-0" style={{ top: 18, height: 1, background: "var(--hud-glass-stroke-soft)" }} />
      <div className="grid" style={{ gridTemplateColumns: `repeat(${events.length}, 1fr)` }}>
        {events.map((e, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <span
              className="font-mono text-[8.5px] tabular-nums text-studio-ink"
              style={{ opacity: 0.65 }}
            >
              {e.t}
            </span>
            <span className="relative grid h-3.5 w-3.5 place-items-center">
              <TimelineGlyph kind={e.glyph} attention={e.attention} />
            </span>
            <span
              className="font-mono text-[8.5px] uppercase tracking-eyebrow"
              style={{
                color: e.attention ? "var(--hud-rose)" : "var(--studio-ink)",
                opacity: e.attention ? 1 : 0.78,
              }}
            >
              {e.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineGlyph({
  kind,
  attention,
}: {
  kind: "spawn" | "check" | "msg" | "burst" | "wait";
  attention?: boolean;
}) {
  const cyan = "var(--hud-cyan)";
  const rose = "var(--hud-rose)";
  const dark = "rgb(8,10,14)";
  const color = attention ? rose : cyan;

  if (kind === "spawn") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
        <circle cx={7} cy={7} r={6} fill={dark} stroke={color} strokeWidth={1} />
        <circle cx={7} cy={7} r={1.5} fill={color} />
      </svg>
    );
  }
  if (kind === "check") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
        <circle cx={7} cy={7} r={6} fill={dark} stroke={color} strokeWidth={1} />
        <path d="M4.5 7 L6.3 8.6 L9.5 5.4" fill="none" stroke={color} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "msg") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
        <circle cx={7} cy={7} r={6} fill={dark} stroke={color} strokeWidth={1} />
        <path d="M4 7 L9 7" stroke={color} strokeWidth={1.1} strokeLinecap="round" />
        <path d="M7.5 5.5 L9.5 7 L7.5 8.5" fill="none" stroke={color} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "burst") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
        <circle cx={7} cy={7} r={6} fill={dark} stroke={color} strokeWidth={1} />
        <circle cx={5} cy={7} r={1} fill={color} />
        <circle cx={7} cy={7} r={1} fill={color} />
        <circle cx={9} cy={7} r={1} fill={color} />
      </svg>
    );
  }
  // wait
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
      <circle cx={7} cy={7} r={6} fill={attention ? color : dark} stroke={color} strokeWidth={1} />
      <line x1={7} y1={7} x2={7} y2={4} stroke={attention ? dark : color} strokeWidth={1.2} strokeLinecap="round" />
      <line x1={7} y1={7} x2={9.5} y2={7} stroke={attention ? dark : color} strokeWidth={1.2} strokeLinecap="round" />
    </svg>
  );
}

function IATreatmentSnippet({ agent }: { agent: HudAgent }) {
  const isAttention = agent.state === "needs-attention";
  const m = agent.lastMessage!;
  return (
    <IAShell attention={isAttention}>
      <div className="flex h-full flex-col gap-2 px-3.5 py-3 pl-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            {agent.name} · {agent.runtime} · {agent.files}f
          </span>
          <span className="font-mono text-[9.5px] tabular-nums text-studio-ink" style={{ opacity: 0.65 }}>
            {agent.ago}
          </span>
        </div>
        <div className="flex flex-1 flex-col justify-center gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[14px]">
              <MessageArrowLarge />
            </span>
            <span
              className="font-mono text-[14px] text-studio-ink"
              style={{ opacity: 0.95 }}
            >
              @{m.to}
            </span>
          </div>
          <p className="font-sans text-[13px] italic leading-snug text-studio-ink">
            “{m.text}”
          </p>
        </div>
        <div className="flex items-center justify-between">
          <StatusGlyph state={agent.state} color={isAttention ? "var(--hud-rose)" : "var(--hud-cyan)"} />
          <span
            className="font-mono text-[9.5px] tabular-nums text-studio-ink"
            style={{ opacity: 0.65 }}
          >
            {agent.branch} · {agent.model}
          </span>
        </div>
      </div>
    </IAShell>
  );
}

function MessageArrowLarge() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
      <path d="M2 7 L11 7" stroke="rgba(255,255,255,0.85)" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M8 3.5 L12 7 L8 10.5" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── 6 · Chord-driven summon ──────────────────────────────────────────

function SummonGesturesSection() {
  return (
    <section className="mt-16">
      <SectionHead
        kicker="summon · navigate · dismiss"
        title="One chord enters; arrows navigate"
        lede="Not three independent hotkeys — one chord summons the family, and the operator steps between postures with arrow keys. Forms are not mutually exclusive: the bar can stay on while the panel sits in the corner, and the sheet can drop without dismissing either."
      />

      {/* Chord legend — the navigation pattern as a single flow */}
      <div className="mt-6">
        <ChordLegend />
      </div>

      <p className="mx-auto mt-5 max-w-prose text-center font-sans text-[12.5px] italic leading-relaxed text-studio-ink-faint">
        One chord enters the family; arrows navigate between postures.
        Forms are not mutually exclusive — the bar can stay on while the
        sheet drops. <span className="not-italic font-mono text-[11px] text-studio-ink">⎋</span> dismisses everything.
      </p>

      {/* Live state sequence — 4 panels showing coexistence */}
      <div className="mt-10">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · live state sequence
        </div>
        <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
          The chord opens the bar; the panel slides in alongside; the sheet drops while everything else stays put; Esc clears the surface. Each frame is a snapshot of the mock desktop at the moment after the keypress.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ChordSequenceFrame
            step="1"
            keypress={<HyperA />}
            caption="Hyper+A summons the family — bar appears in the top-left."
            showBar
          />
          <ChordSequenceFrame
            step="2"
            keypress={<ArrowKey kind="right" />}
            caption="→ promotes to the panel. Bar stays on; panel anchors top-right."
            showBar
            showPanel
          />
          <ChordSequenceFrame
            step="3"
            keypress={<ArrowKey kind="down" />}
            caption="↓ drops the sheet. Bar and panel are still alive underneath."
            showBar
            showPanel
            showSheet
          />
          <ChordSequenceFrame
            step="4"
            keypress={<EscKey />}
            caption="⎋ dismisses the family. The bar resumes its always-on baseline."
            showBar
          />
        </div>
      </div>
    </section>
  );
}

/** Compact chord legend: form thumbnails connected by chord glyphs and arrows. */
function ChordLegend() {
  return (
    <div
      className="rounded-[10px] border border-studio-edge px-6 py-7"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-6">
        {/* Hyper+A → bar */}
        <div className="flex flex-col items-center gap-2">
          <HyperA />
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            summons family
          </span>
        </div>
        <ChordArrow />
        <ChordFormThumb label="Bar" mark="A">
          <BarMiniGlyph />
        </ChordFormThumb>
        <ChordArrow withKey={<ArrowKey kind="right" />} caption="promote" />
        <ChordFormThumb label="Panel" mark="B">
          <PanelMiniGlyph />
        </ChordFormThumb>
        <ChordArrow withKey={<ArrowKey kind="down" />} caption="drop" />
        <ChordFormThumb label="Sheet" mark="C">
          <SheetMiniGlyph />
        </ChordFormThumb>
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 font-mono text-[10.5px] text-studio-ink">
        <span className="flex items-center gap-2">
          <ArrowKey kind="left" />
          <span className="text-studio-ink-faint">step back / collapse</span>
        </span>
        <span className="flex items-center gap-2">
          <ArrowKey kind="up" />
          <span className="text-studio-ink-faint">collapse back to bar</span>
        </span>
        <span className="flex items-center gap-2">
          <EscKey />
          <span className="text-studio-ink-faint">dismiss the family</span>
        </span>
      </div>
    </div>
  );
}

function ChordFormThumb({
  label,
  mark,
  children,
}: {
  label: string;
  mark: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="grid place-items-center rounded-[4px] border border-studio-edge px-3 py-2"
        style={{ background: "var(--studio-canvas)" }}
      >
        {children}
      </div>
      <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {mark} · {label}
      </span>
    </div>
  );
}

function ChordArrow({
  withKey,
  caption,
}: {
  withKey?: ReactNode;
  caption?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <SummonArrow />
      {withKey ? <div className="-mt-1">{withKey}</div> : null}
      {caption ? (
        <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          {caption}
        </span>
      ) : null}
    </div>
  );
}

/** Hyper-key chord glyph: ⌃⌥⇧⌘ + A, rendered as five compact key-caps. */
function HyperA() {
  return (
    <div className="flex items-center gap-[3px]">
      <ModCap glyph="⌃" />
      <ModCap glyph="⌥" />
      <ModCap glyph="⇧" />
      <ModCap glyph="⌘" />
      <span className="mx-[2px] font-mono text-[10px] text-studio-ink-faint">+</span>
      <LetterCap letter="A" />
    </div>
  );
}

function ModCap({ glyph }: { glyph: string }) {
  return (
    <span
      className="inline-grid h-[22px] w-[22px] place-items-center rounded-[4px] border border-studio-edge font-mono text-[11px] text-studio-ink"
      style={{
        background: "var(--studio-canvas)",
        boxShadow: "0 1px 0 var(--studio-edge), 0 2px 0 var(--studio-canvas-alt)",
      }}
    >
      {glyph}
    </span>
  );
}

function LetterCap({ letter }: { letter: string }) {
  return (
    <span
      className="inline-grid h-[22px] w-[22px] place-items-center rounded-[4px] border border-studio-edge font-mono text-[11px] font-semibold text-studio-ink"
      style={{
        background: "var(--studio-canvas)",
        boxShadow: "0 1px 0 var(--studio-edge), 0 2px 0 var(--studio-canvas-alt)",
      }}
    >
      {letter}
    </span>
  );
}

function ArrowKey({ kind }: { kind: "left" | "right" | "up" | "down" }) {
  const glyph = kind === "left" ? "←" : kind === "right" ? "→" : kind === "up" ? "↑" : "↓";
  return (
    <span
      className="inline-grid h-[22px] w-[22px] place-items-center rounded-[4px] border border-studio-edge font-mono text-[11px] text-studio-ink"
      style={{
        background: "var(--studio-canvas)",
        boxShadow: "0 1px 0 var(--studio-edge), 0 2px 0 var(--studio-canvas-alt)",
      }}
    >
      {glyph}
    </span>
  );
}

function EscKey() {
  return (
    <span
      className="inline-grid h-[22px] place-items-center rounded-[4px] border border-studio-edge px-2 font-mono text-[10px] text-studio-ink"
      style={{
        background: "var(--studio-canvas)",
        boxShadow: "0 1px 0 var(--studio-edge), 0 2px 0 var(--studio-canvas-alt)",
      }}
    >
      esc
    </span>
  );
}

/** Single frame of the live-state sequence — mock desktop with which forms are showing. */
function ChordSequenceFrame({
  step,
  keypress,
  caption,
  showBar,
  showPanel,
  showSheet,
}: {
  step: string;
  keypress: ReactNode;
  caption: string;
  showBar?: boolean;
  showPanel?: boolean;
  showSheet?: boolean;
}) {
  const W = 320;
  const H = 200;
  const SCALE = 0.16;
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · step {step}
        </span>
        {keypress}
      </div>
      <div
        className="relative mt-2 overflow-hidden rounded-[6px] border border-studio-edge"
        style={{
          width: W,
          height: H,
          background:
            "linear-gradient(135deg, oklch(0.16 0.018 250) 0%, oklch(0.11 0.015 280) 100%)",
        }}
      >
        {/* mini menu bar */}
        <div
          className="absolute inset-x-0 top-0 flex items-center justify-end px-2"
          style={{
            height: 14,
            background: "rgba(20, 22, 28, 0.85)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <MenuBarOpenScoutGlyph />
        </div>

        {/* Bar */}
        {showBar ? (
          <div
            className="absolute"
            style={{
              left: 6,
              top: 20,
              transform: `scale(${SCALE * 1.55})`,
              transformOrigin: "top left",
            }}
          >
            <TopLeftBar
              fleet={FLEET_BAR}
              headline={{ agent: DROVER, msg: "needs your call on which migration to roll first" }}
            />
          </div>
        ) : null}

        {/* Panel */}
        {showPanel ? (
          <div
            className="absolute"
            style={{
              right: 6,
              top: 20,
              transform: `scale(${SCALE})`,
              transformOrigin: "top right",
            }}
          >
            <HudPanel
              header="OpenScout"
              subhead="3 agents · 1 on you"
              agents={FLEET_PANEL}
              specular={{ x: 0.30, y: 0.32 }}
              activeRowId="hudson"
            />
          </div>
        ) : null}

        {/* Sheet */}
        {showSheet ? (
          <div
            className="absolute"
            style={{
              left: "50%",
              top: 14,
              transform: `translateX(-50%) scale(${SCALE * 0.72})`,
              transformOrigin: "top center",
            }}
          >
            <PullDownSheet fleet={FLEET_FULL} />
          </div>
        ) : null}
      </div>
      <p className="mt-2 font-sans text-[11.5px] italic leading-relaxed text-studio-ink-faint">
        {caption}
      </p>
    </div>
  );
}

function BarMiniGlyph() {
  return (
    <div
      className="relative overflow-hidden rounded-[3px]"
      style={{
        width: 56,
        height: 22,
        background: "linear-gradient(135deg, var(--hud-base-top), var(--hud-base-bottom))",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(to right, transparent, rgba(255,255,255,0.45), transparent)" }}
      />
      <div className="absolute inset-x-2 top-1 flex gap-1">
        {[125, 50, 210, 195, 175].map((h, i) => (
          <span key={i} className="block h-1 w-2 rounded-[1px]" style={{ background: `oklch(0.42 0.008 80)` }} />
        ))}
      </div>
      <div className="absolute inset-x-2 bottom-1 h-[3px] rounded-[1px]" style={{ background: "rgba(255,255,255,0.12)" }} />
    </div>
  );
}

function PanelMiniGlyph() {
  return (
    <div
      className="relative overflow-hidden rounded-[3px]"
      style={{
        width: 32,
        height: 44,
        background: "linear-gradient(135deg, var(--hud-base-top), var(--hud-base-bottom))",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(255,255,255,0.45), transparent)" }} />
      <div className="absolute inset-x-1.5 top-2 flex flex-col gap-1">
        <div className="h-1 w-full rounded-[1px]" style={{ background: "oklch(0.42 0.008 80)" }} />
        <div className="h-1 w-full rounded-[1px]" style={{ background: "var(--hud-rose)" }} />
        <div className="h-1 w-full rounded-[1px]" style={{ background: "oklch(0.42 0.008 80)" }} />
      </div>
    </div>
  );
}

function SheetMiniGlyph() {
  return (
    <div
      className="relative overflow-hidden rounded-b-[3px]"
      style={{
        width: 60,
        height: 26,
        background: "linear-gradient(180deg, var(--hud-base-top), var(--hud-base-bottom))",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
        borderTop: "none",
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(255,255,255,0.45), transparent)" }} />
      <div className="absolute inset-y-1 left-1 w-3 rounded-[1px]" style={{ background: "rgba(0,0,0,0.4)" }} />
      <div className="absolute inset-y-1 left-6 right-1 grid grid-cols-4 gap-0.5">
        {[210, 50, 305, 175].map((h, i) => (
          <span key={i} className="block rounded-[1px]" style={{ background: `oklch(0.42 0.008 80)`, opacity: 0.55 }} />
        ))}
      </div>
    </div>
  );
}

function Hotkey({ keys, compact }: { keys: string[]; compact?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {keys.map((k, i) => (
        <span
          key={i}
          className={`inline-grid place-items-center rounded-[4px] border border-studio-edge font-mono text-studio-ink ${
            compact ? "h-6 min-w-[24px] text-[10px]" : "h-9 min-w-[36px] text-[12px]"
          } px-2`}
          style={{
            background: "var(--studio-canvas)",
            boxShadow: "0 1px 0 var(--studio-edge), 0 2px 0 var(--studio-canvas-alt)",
          }}
        >
          {k}
        </span>
      ))}
    </div>
  );
}

function SummonArrow() {
  return (
    <svg width={48} height={20} viewBox="0 0 48 20" aria-hidden>
      <line x1={2} y1={10} x2={42} y2={10} stroke="var(--studio-ink-faint)" strokeWidth={1} strokeDasharray="2 3" />
      <path d="M38 5 L46 10 L38 15" fill="none" stroke="var(--studio-ink-faint)" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── 7 · Anatomy (now lives on the richest form — a sheet card) ───────

function AnatomySection() {
  return (
    <section className="mt-16">
      <SectionHead
        kicker="anatomy"
        title="What's in a sheet card"
        lede="The richest form gets the anatomy treatment. Drover's card with eight load-bearing parts called out. The bar and the panel are subsets of this — fewer parts, same vocabulary."
      />

      <div className="mt-6 grid grid-cols-1 items-start gap-10 lg:grid-cols-[auto_1fr]">
        <div className="flex justify-center">
          <div className="relative" style={{ width: 320 }}>
            <AgentCard agent={DROVER} />
            <CalloutPip mark="A" left={-22} top={26} tone="rose" />
            <CalloutPip mark="B" left={-2} top={2} tone="rose" />
            <CalloutPip mark="C" right={-22} top={26} tone="cyan" />
            <CalloutPip mark="D" right={-22} top={94} tone="rose" />
            <CalloutPip mark="E" right={-22} top={148} tone="cyan" />
            <CalloutPip mark="F" right={-22} top={228} tone="cyan" />
            <CalloutPip mark="G" right={-22} top={296} tone="cyan" />
            <CalloutPip mark="H" left={-22} top={358} tone="cyan" />
          </div>
        </div>

        <ol className="m-0 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <AnatomyItem mark="A" name="Status glyph" body="Hand-drawn, geometric. Rose asterisk for needs-attention; cyan arc for working; cyan-checked for done; paired dots for waiting." />
          <AnatomyItem mark="B" name="Hue stripe" body="3px column (2.5px on rose). Encodes agent identity at the wavelength level so the eye sorts the grid before reading any name." />
          <AnatomyItem mark="C" name="Identity + role" body="Name in sans 13px medium; role line in mono eyebrow underneath. Same agent reads the same on every surface." />
          <AnatomyItem mark="D" name="Pending ask" body="Rose-tinted block. Only renders when the agent is waiting on the operator. The ask is in operator voice, not agent voice." />
          <AnatomyItem mark="E" name="Last-turn summary" body="2-3 sentences in the agent's own voice, italic. The single most expensive line in the card and the one that pays back the most." />
          <AnatomyItem mark="F" name="Stat block" body="Five-key KV grid: runtime · files · tokens · model · branch. Mono numerals carry the row." />
          <AnatomyItem mark="G" name="Cross-agent message" body="The most recent outbound. `@to` in cyan, message in quoted italic. Lets the operator follow the back-channel without opening studio." />
          <AnatomyItem mark="H" name="Lineage + pulse" body="Who spawned this agent (operator vs other) on the left; a 12-step sparkline of recent activity on the right. Footer-weight — peripheral." />
        </ol>
      </div>
    </section>
  );
}

function AnatomyItem({
  mark,
  name,
  body,
}: {
  mark: string;
  name: string;
  body: string;
}) {
  return (
    <li className="flex list-none gap-3">
      <span
        aria-hidden
        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[3px] border border-studio-edge font-mono text-[10px] font-semibold text-studio-ink-faint"
      >
        {mark}
      </span>
      <div className="flex-1">
        <div className="font-display text-[15px] text-studio-ink">{name}</div>
        <p className="mt-1 font-sans text-[12px] leading-relaxed text-studio-ink-muted">
          {body}
        </p>
      </div>
    </li>
  );
}

function CalloutPip({
  mark,
  left,
  right,
  top,
  tone,
}: {
  mark: string;
  left?: number;
  right?: number;
  top: number;
  tone?: "cyan" | "rose";
}) {
  const bg = tone === "rose" ? "var(--hud-rose)" : "var(--hud-cyan)";
  return (
    <span
      className="absolute grid h-4 w-4 place-items-center rounded-full font-mono text-[9px] font-semibold"
      style={{ left, right, top, background: bg, color: "rgb(8,10,14)" }}
    >
      {mark}
    </span>
  );
}

// ── HUD Panel (v2 primitive, retained verbatim) ──────────────────────

function HudPanel({
  header,
  subhead,
  agents,
  emptyMessage,
  showOpenInStudio,
  specular = { x: 0.30, y: 0.35 },
  activeRowId,
}: {
  header: string;
  subhead: string;
  agents: HudAgent[];
  emptyMessage?: string;
  showOpenInStudio?: boolean;
  specular?: { x: number; y: number };
  activeRowId?: string;
}) {
  return (
    <div className="relative">
      <div
        className="relative overflow-hidden rounded-[10px]"
        style={{
          width: HUD_W,
          height: HUD_H,
          background:
            "linear-gradient(135deg, var(--hud-base-top), var(--hud-base-bottom))",
          backdropFilter: "blur(20px) saturate(150%)",
          WebkitBackdropFilter: "blur(20px) saturate(150%)",
          border: "0.75px solid var(--hud-glass-stroke-soft)",
          boxShadow:
            "0 18px 48px -12px rgba(0,0,0,0.65), 0 1px 0 rgba(255,255,255,0.05) inset",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.025) 0%, transparent 55%, color-mix(in oklab, var(--hud-rose) 4%, transparent) 100%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{
            height: HUD_H / 2,
            background: "linear-gradient(to bottom, rgba(255,255,255,0.07), transparent)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(circle at ${specular.x * 100}% ${
              specular.y * 100
            }%, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.03) 25%, transparent 60%)`,
          }}
        />
        <HudEdgeGlow />

        <div className="relative h-full">
          <HudHeader header={header} subhead={subhead} />
          <div className="relative flex h-[calc(100%-44px)] flex-col">
            {agents.length === 0 ? (
              <HudEmpty message={emptyMessage ?? "Nothing in flight."} />
            ) : (
              <div className="flex-1 overflow-hidden">
                {agents.map((a, i) => (
                  <HudAgentRow key={a.id} agent={a} isFirst={i === 0} isActive={a.id === activeRowId} />
                ))}
              </div>
            )}
            {showOpenInStudio ? <HudOpenStudioPip /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function HudEdgeGlow() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: 1.5,
          background:
            "linear-gradient(to right, transparent 0%, rgba(255,255,255,0.28) 30%, color-mix(in oklab, var(--hud-cyan) 28%, transparent) 50%, rgba(255,255,255,0.28) 70%, transparent 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: -36,
          top: -28,
          width: 144,
          height: 72,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.045) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          right: -36,
          top: -28,
          width: 144,
          height: 72,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.045) 0%, transparent 70%)",
        }}
      />
    </>
  );
}

function HudHairline() {
  return (
    <div
      aria-hidden
      className="pointer-events-none"
      style={{
        height: 1,
        background:
          "linear-gradient(to right, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.16) 30%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.10) 70%, rgba(255,255,255,0.04) 100%)",
      }}
    />
  );
}

function HudHeader({ header, subhead }: { header: string; subhead: string }) {
  return (
    <div className="relative" style={{ height: 44 }}>
      <div className="flex h-full items-center justify-between px-3.5">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[14px] text-studio-ink">{header}</span>
          <span
            aria-hidden
            className="h-3 w-px shrink-0 self-center"
            style={{ background: "var(--hud-glass-stroke-soft)" }}
          />
          <span className="font-mono text-[10.5px] tabular-nums text-studio-ink-muted">
            {subhead}
          </span>
        </div>
        <HeaderGlyphCluster />
      </div>
      <div className="absolute inset-x-0 bottom-0">
        <HudHairline />
      </div>
    </div>
  );
}

function HeaderGlyphCluster() {
  return (
    <svg width={18} height={6} viewBox="0 0 18 6" aria-hidden>
      <circle cx={2} cy={3} r={1.2} fill="rgba(255,255,255,0.45)" />
      <circle cx={6} cy={3} r={1.2} fill="rgba(255,255,255,0.45)" />
      <circle cx={10} cy={3} r={1.2} fill="rgba(255,255,255,0.45)" />
      <circle cx={14} cy={3} r={1.2} fill="rgba(255,255,255,0.45)" />
    </svg>
  );
}

function HudEmpty({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5">
      <EmptyGlyph />
      <p className="mt-3 text-center font-sans text-[12px] leading-relaxed text-studio-ink-muted">
        {message}
      </p>
      <p className="mt-1 text-center font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        ⌥ space to dismiss
      </p>
    </div>
  );
}

function EmptyGlyph() {
  return (
    <svg width={42} height={12} viewBox="0 0 42 12" aria-hidden>
      <circle cx={6} cy={6} r={2} fill="rgba(255,255,255,0.35)" />
      <circle cx={21} cy={6} r={2} fill="rgba(255,255,255,0.5)" />
      <circle cx={36} cy={6} r={2} fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}

/**
 * Deepened agent row for variant B — drops to 3 visible rows per panel
 * so each one can carry last-turn + stat strip + outbound message in
 * 340px without crowding.
 */
function HudAgentRow({
  agent,
  isFirst,
  isActive,
}: {
  agent: HudAgent;
  isFirst: boolean;
  isActive?: boolean;
}) {
  const hueColor = `oklch(0.42 0.008 80)`;
  const isAttention = agent.state === "needs-attention";
  const isDone = agent.state === "done";

  const stripeColor = isAttention ? "var(--hud-rose)" : hueColor;
  const stripeWidth = isAttention ? 2.5 : 3;

  const glyphColor = isAttention
    ? "var(--hud-rose)"
    : isDone || agent.state === "working"
    ? "var(--hud-cyan)"
    : "rgba(255,255,255,0.55)";

  const rowFill = isActive
    ? "var(--hud-glass-fill-strong)"
    : isAttention
    ? "color-mix(in oklab, var(--hud-rose) 7%, transparent)"
    : "transparent";

  const rowStroke = isActive ? "var(--hud-cyan-soft)" : "transparent";

  return (
    <div
      className="relative flex flex-col gap-1.5 px-3.5 py-2.5"
      style={{
        background: rowFill,
        boxShadow: isActive
          ? `inset -2px 0 0 0 ${rowStroke}, 0 2px 8px -4px rgba(0,0,0,0.4)`
          : undefined,
      }}
    >
      {!isFirst ? (
        <div className="absolute inset-x-3 top-0">
          <HudHairline />
        </div>
      ) : null}

      {/* hue stripe */}
      <div
        aria-hidden
        className="absolute left-0 top-0 h-full"
        style={{ width: stripeWidth, background: stripeColor }}
      />

      {/* Row 1 — identity + status + timestamp */}
      <div className="flex items-center gap-2">
        <div className="shrink-0">
          <StatusGlyph state={agent.state} color={glyphColor} />
        </div>
        <span className="truncate font-sans text-[13px] font-medium text-studio-ink">
          {agent.name}
        </span>
        <span className="truncate font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {agent.role}
        </span>
        <span
          className="ml-auto shrink-0 font-mono text-[9.5px] tabular-nums text-studio-ink"
          style={{ opacity: 0.65 }}
        >
          {agent.ago}
        </span>
      </div>

      {/* Row 2 — last turn (or ask) */}
      {isAttention && agent.pendingAsk ? (
        <p
          className="font-sans text-[11px] leading-snug text-studio-ink"
          style={{
            opacity: 1,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          <span
            className="font-mono text-[8.5px] uppercase tracking-eyebrow"
            style={{ color: "var(--hud-rose)" }}
          >
            waiting on you ·{" "}
          </span>
          {agent.pendingAsk}
        </p>
      ) : (
        <p
          className="font-sans text-[11px] italic leading-snug text-studio-ink"
          style={{
            opacity: 0.82,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {agent.lastTurn}
        </p>
      )}

      {/* Row 3 — stat strip (compact) */}
      <div className="flex items-center gap-2 font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.72 }}>
        <span>{agent.runtime}</span>
        <PanelStatDot />
        <span>{agent.files}f</span>
        <PanelStatDot />
        <span>{agent.tokens}</span>
        <PanelStatDot />
        <span className="truncate">{agent.branch}</span>
      </div>

      {/* Row 4 — cross-agent message (compact) */}
      {agent.lastMessage ? (
        <div className="flex min-w-0 items-center gap-1">
          <MessageArrow />
          <span
            className="shrink-0 font-mono text-[9.5px] text-studio-ink"
            style={{ opacity: 0.92 }}
          >
            @{agent.lastMessage.to}
          </span>
          <span
            className="truncate font-sans text-[10px] italic text-studio-ink"
            style={{ opacity: 0.78 }}
          >
            “{agent.lastMessage.text}”
          </span>
        </div>
      ) : null}

      {/* Done state pip — neutral ink; cyan reserved for the check-notch status glyph */}
      {isDone ? (
        <span
          className="inline-flex w-fit items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink"
          style={{
            border: "0.75px solid var(--hud-glass-stroke-soft)",
            background: "var(--hud-glass-fill)",
            opacity: 0.92,
          }}
        >
          open in studio
          <OpenArrow />
        </span>
      ) : null}
    </div>
  );
}

function PanelStatDot() {
  return (
    <span
      aria-hidden
      className="block h-[2px] w-[2px] rounded-full"
      style={{ background: "rgba(255,255,255,0.35)" }}
    />
  );
}

function OpenArrow() {
  return (
    <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden>
      <line x1={1.5} y1={7.5} x2={7} y2={2} stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
      <path d="M3.5 2 L7 2 L7 5.5" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function HudOpenStudioPip() {
  return (
    <div className="relative">
      <div className="absolute inset-x-3 top-0">
        <HudHairline />
      </div>
      <div
        className="flex items-center justify-between px-3.5 py-2"
        style={{ background: "rgba(255,255,255,0.025)" }}
      >
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-muted">
          Atlas finished
        </span>
        <span
          className="inline-flex items-center gap-1 font-mono text-[9.5px] text-studio-ink"
          style={{ opacity: 0.92 }}
        >
          Open in studio
          <OpenArrow />
        </span>
      </div>
    </div>
  );
}

// ── Status glyphs (v2, kept) ─────────────────────────────────────────

function StatusGlyph({ state, color }: { state: HudAgentState; color: string }) {
  if (state === "working") {
    return (
      <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden>
        <path d="M5.5 1.2 A4.3 4.3 0 0 1 9.8 5.5" stroke={color} strokeWidth={1.3} strokeLinecap="round" fill="none" />
        <circle cx={5.5} cy={5.5} r={1} fill={color} />
      </svg>
    );
  }
  if (state === "waiting") {
    return (
      <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden>
        <circle cx={4} cy={5.5} r={1.4} fill={color} opacity={0.55} />
        <circle cx={7.5} cy={5.5} r={1.4} fill={color} opacity={0.55} />
      </svg>
    );
  }
  if (state === "done") {
    return (
      <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden>
        <circle cx={5.5} cy={5.5} r={4} fill={color} />
        <path d="M3.5 5.5 L5 7 L8 4" stroke="rgb(8,10,14)" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  return (
    <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden>
      <line x1={5.5} y1={1.5} x2={5.5} y2={9.5} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
      <line x1={2} y1={3.5} x2={9} y2={7.5} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
      <line x1={2} y1={7.5} x2={9} y2={3.5} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

function MenuBarOpenScoutGlyph() {
  return (
    <svg width={14} height={10} viewBox="0 0 14 10" aria-hidden>
      <circle cx={3} cy={5} r={1.4} fill="var(--studio-ink-muted)" />
      <rect x={6} y={4} width={5} height={2} rx={0.8} fill="var(--studio-ink-muted)" />
    </svg>
  );
}

// ── Floating wrappers + screen frames ───────────────────────────────

function ScreenFrame({
  width,
  height,
  compact,
  children,
}: {
  width: number;
  height: number;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[10px] border border-studio-edge-strong"
      style={{
        width,
        height,
        background: "var(--studio-canvas)",
        boxShadow: compact
          ? "0 12px 24px -12px rgba(0,0,0,0.45), 0 0 0 1px var(--studio-edge) inset"
          : "0 24px 48px -24px rgba(0,0,0,0.5), 0 0 0 1px var(--studio-edge) inset",
      }}
    >
      {children}
    </div>
  );
}

function FloatingHudWrapper({
  anchor,
  scale = 1,
  children,
}: {
  anchor: "top-right" | "center";
  scale?: number;
  children: ReactNode;
}) {
  if (anchor === "top-right") {
    return (
      <div
        className="absolute"
        style={{ right: 20, top: 38, transform: `scale(${scale})`, transformOrigin: "top right" }}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className="absolute left-1/2 top-1/2"
      style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
    >
      {children}
    </div>
  );
}

// ── Backdrops (dark hosts only) ──────────────────────────────────────

function BackdropEditor() {
  const LINES: Array<{ indent: number; tokens: Array<{ w: number; kind: "kw" | "id" | "str" | "punct" | "comment" }> }> = [
    { indent: 0, tokens: [{ w: 30, kind: "comment" }] },
    { indent: 0, tokens: [{ w: 40, kind: "kw" }, { w: 60, kind: "id" }, { w: 8, kind: "punct" }] },
    { indent: 2, tokens: [{ w: 56, kind: "id" }, { w: 8, kind: "punct" }, { w: 80, kind: "str" }] },
    { indent: 2, tokens: [{ w: 48, kind: "id" }, { w: 8, kind: "punct" }, { w: 36, kind: "kw" }, { w: 28, kind: "id" }] },
    { indent: 2, tokens: [{ w: 30, kind: "kw" }, { w: 48, kind: "id" }, { w: 8, kind: "punct" }, { w: 120, kind: "str" }] },
    { indent: 0, tokens: [{ w: 14, kind: "punct" }] },
    { indent: 0, tokens: [{ w: 40, kind: "kw" }, { w: 78, kind: "id" }, { w: 30, kind: "punct" }, { w: 60, kind: "id" }] },
    { indent: 2, tokens: [{ w: 80, kind: "comment" }] },
    { indent: 2, tokens: [{ w: 32, kind: "kw" }, { w: 70, kind: "id" }, { w: 24, kind: "punct" }] },
    { indent: 4, tokens: [{ w: 56, kind: "id" }, { w: 8, kind: "punct" }, { w: 100, kind: "str" }] },
    { indent: 4, tokens: [{ w: 90, kind: "id" }, { w: 24, kind: "punct" }] },
    { indent: 2, tokens: [{ w: 14, kind: "punct" }] },
    { indent: 0, tokens: [{ w: 14, kind: "punct" }] },
    { indent: 0, tokens: [{ w: 40, kind: "comment" }] },
    { indent: 0, tokens: [{ w: 60, kind: "kw" }, { w: 84, kind: "id" }] },
    { indent: 2, tokens: [{ w: 32, kind: "id" }, { w: 8, kind: "punct" }, { w: 110, kind: "str" }] },
    { indent: 2, tokens: [{ w: 70, kind: "id" }, { w: 24, kind: "punct" }] },
    { indent: 0, tokens: [{ w: 14, kind: "punct" }] },
  ];

  const tokenColor = (k: string) => {
    if (k === "kw") return "var(--scout-accent)";
    if (k === "str") return "var(--status-warn-fg)";
    if (k === "comment") return "color-mix(in oklab, var(--studio-ink-faint) 70%, transparent)";
    if (k === "punct") return "var(--studio-ink-faint)";
    return "var(--studio-ink)";
  };

  return (
    <div className="absolute inset-0" style={{ background: "var(--studio-canvas)" }}>
      <div
        className="flex items-center gap-2 border-b border-studio-edge px-3"
        style={{ height: 22, background: "var(--studio-canvas-alt)" }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--status-error-fg)" }} />
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--status-warn-fg)" }} />
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--status-ok-fg)" }} />
        <span className="ml-3 font-mono text-[9px] text-studio-ink-faint">QuickSteer.tsx — openscout/design/studio</span>
      </div>
      <div className="flex h-[calc(100%-22px)]">
        <div
          className="flex flex-col items-end py-2 pl-2 pr-2"
          style={{ background: "var(--studio-canvas)", borderRight: "1px solid var(--studio-edge)" }}
        >
          {LINES.map((_, i) => (
            <span
              key={i}
              className="font-mono text-[9.5px] tabular-nums"
              style={{ color: "var(--studio-ink-faint)", opacity: 0.55, lineHeight: "16px" }}
            >
              {i + 1}
            </span>
          ))}
        </div>
        <div className="flex-1 py-2 pl-3">
          {LINES.map((line, i) => (
            <div key={i} className="flex items-center gap-1.5" style={{ height: 16 }}>
              <div style={{ width: line.indent * 8 }} />
              {line.tokens.map((t, j) => (
                <div
                  key={j}
                  className="rounded-[1px]"
                  style={{ width: t.w, height: 7, background: tokenColor(t.kind), opacity: 0.85 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BackdropTerminal() {
  const TERM_GREEN = "oklch(0.78 0.18 145)";
  const TERM_GREEN_DIM = "oklch(0.62 0.14 145)";
  const TERM_CYAN = "oklch(0.78 0.13 200)";
  const TERM_AMBER = "oklch(0.78 0.15 70)";
  const TERM_GREY = "oklch(0.55 0.01 145)";
  const COLORS = [TERM_GREEN, TERM_GREEN_DIM, TERM_GREY, TERM_CYAN, TERM_AMBER, TERM_GREEN, TERM_GREEN_DIM];
  const LINES: Array<Array<{ w: number; c: number }>> = [
    [{ w: 12, c: 0 }, { w: 60, c: 5 }, { w: 8, c: 2 }, { w: 90, c: 1 }],
    [{ w: 12, c: 0 }, { w: 40, c: 5 }, { w: 8, c: 2 }, { w: 110, c: 3 }, { w: 30, c: 1 }],
    [{ w: 12, c: 0 }, { w: 80, c: 4 }, { w: 8, c: 2 }, { w: 40, c: 5 }, { w: 60, c: 1 }],
    [{ w: 12, c: 0 }, { w: 50, c: 5 }, { w: 8, c: 2 }, { w: 70, c: 0 }, { w: 24, c: 3 }],
    [{ w: 12, c: 0 }, { w: 100, c: 5 }, { w: 8, c: 2 }, { w: 90, c: 1 }],
    [{ w: 12, c: 0 }, { w: 30, c: 5 }, { w: 8, c: 2 }, { w: 200, c: 2 }],
    [{ w: 12, c: 0 }, { w: 60, c: 5 }, { w: 8, c: 2 }, { w: 40, c: 3 }, { w: 80, c: 0 }, { w: 30, c: 4 }],
    [{ w: 12, c: 0 }, { w: 70, c: 5 }, { w: 8, c: 2 }, { w: 50, c: 1 }, { w: 110, c: 0 }],
    [{ w: 12, c: 0 }, { w: 40, c: 5 }, { w: 8, c: 2 }, { w: 80, c: 3 }],
    [{ w: 12, c: 0 }, { w: 60, c: 5 }, { w: 8, c: 2 }, { w: 130, c: 4 }, { w: 30, c: 0 }],
    [{ w: 12, c: 0 }, { w: 90, c: 5 }, { w: 8, c: 2 }, { w: 60, c: 1 }, { w: 40, c: 6 }],
    [{ w: 12, c: 0 }, { w: 50, c: 5 }, { w: 8, c: 2 }, { w: 100, c: 3 }, { w: 70, c: 0 }],
    [{ w: 12, c: 0 }, { w: 40, c: 5 }, { w: 8, c: 2 }, { w: 180, c: 1 }],
    [{ w: 12, c: 0 }, { w: 80, c: 5 }, { w: 8, c: 2 }, { w: 70, c: 0 }, { w: 50, c: 4 }],
    [{ w: 12, c: 0 }, { w: 30, c: 5 }, { w: 8, c: 2 }, { w: 120, c: 6 }, { w: 60, c: 3 }],
    [{ w: 12, c: 0 }, { w: 50, c: 5 }, { w: 8, c: 2 }, { w: 110, c: 1 }],
    [{ w: 12, c: 0 }, { w: 70, c: 5 }, { w: 8, c: 2 }, { w: 60, c: 4 }, { w: 80, c: 0 }],
  ];

  return (
    <div className="absolute inset-0" style={{ background: "oklch(0.10 0.015 145)" }}>
      <div className="px-3 py-2">
        {LINES.map((line, i) => (
          <div key={i} className="flex items-center gap-1.5" style={{ height: 17 }}>
            {line.map((t, j) => (
              <div
                key={j}
                className="rounded-[1px]"
                style={{ width: t.w, height: 7, background: COLORS[t.c], opacity: 0.82 }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function BackdropDimDesktop() {
  return (
    <div
      className="absolute inset-0"
      style={{
        background:
          "linear-gradient(135deg, oklch(0.18 0.02 260) 0%, oklch(0.13 0.015 280) 60%, oklch(0.10 0.01 260) 100%)",
      }}
    >
      <div
        className="absolute"
        style={{
          left: "-10%",
          top: "-10%",
          width: "60%",
          height: "60%",
          background: "radial-gradient(circle, oklch(0.30 0.05 250 / 0.45) 0%, transparent 60%)",
          filter: "blur(20px)",
        }}
      />
      <div
        className="absolute"
        style={{
          right: "-10%",
          bottom: "10%",
          width: "55%",
          height: "55%",
          background: "radial-gradient(circle, oklch(0.25 0.06 320 / 0.40) 0%, transparent 60%)",
          filter: "blur(24px)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-3 mx-auto flex items-center gap-1.5 rounded-[8px] border px-2 py-1.5"
        style={{
          width: 220,
          background: "rgba(255,255,255,0.07)",
          borderColor: "rgba(255,255,255,0.10)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        {[
          "oklch(0.65 0.18 25)",
          "oklch(0.70 0.16 120)",
          "oklch(0.68 0.15 210)",
          "oklch(0.42 0.008 80)",
          "oklch(0.62 0.18 300)",
          "oklch(0.70 0.12 180)",
          "oklch(0.68 0.16 350)",
        ].map((c, i) => (
          <div key={i} className="rounded-[3px]" style={{ width: 22, height: 22, background: c, opacity: 0.85 }} />
        ))}
      </div>
    </div>
  );
}

// ── Section head, caption, footer ───────────────────────────────────

function SectionHead({
  kicker,
  title,
  lede,
}: {
  kicker: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="max-w-prose">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {kicker}
      </div>
      <h2 className="mt-1 m-0 font-display text-[26px] font-medium leading-tight tracking-tight text-studio-ink">
        {title}
      </h2>
      <p className="mt-2 font-sans text-[13.5px] leading-relaxed text-studio-ink-muted">
        {lede}
      </p>
    </header>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 text-center font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
      {children}
    </div>
  );
}

function PageFooter() {
  return (
    <footer className="mt-14 border-t border-studio-edge pt-3 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
      <span>study · </span>
      <span className="text-studio-ink">hud-native</span>
      <span className="mx-1.5">·</span>
      <span>v5 — one cockpit + N slotted web views</span>
    </footer>
  );
}

// ── 0 · The conversational cockpit ───────────────────────────────────
//
// The native, deeply-iterated heart of the HUD. Ranger DNA:
// keyboard-driven, multi-column, dense, hand-crafted. The operator's
// QB cockpit — long-running conversational session manager, fleet ops
// driven from one deterministic place. Five frames step through the
// states the cockpit cycles through during normal use: at rest,
// command mode, search mode, conversational (talk) mode, and a rose
// attention state.

const COCKPIT_W = 860;
const COCKPIT_H = 540;
const COCKPIT_STRIP_TOP = 30;
const COCKPIT_STRIP_BOTTOM = 50;
const COCKPIT_COL1_W = 210;
const COCKPIT_COL2_W = 320;
const COCKPIT_COL3_W = COCKPIT_W - COCKPIT_COL1_W - COCKPIT_COL2_W;

type CockpitMode = "normal" | "command" | "search" | "talk";

const COCKPIT_FLEET: HudAgent[] = [HUDSON, DROVER, PIKE, QUILL, ATLAS, COBALT];

function CockpitSection() {
  return (
    <section className="mt-2">
      <SectionHead
        kicker="the conversational cockpit"
        title="Ranger DNA, AI-enabled"
        lede="The native heart of the HUD — one surface we own end-to-end and iterate on. Keyboard-driven, three Miller columns, vim-style mode strip on top, a pinned conversational dock at the bottom. Always-on assistant, real fleet operations, long-running session manager. The cockpit is what the operator returns to between everything else."
      />

      {/* Hero — cockpit at rest, with selection */}
      <div className="mt-6 flex justify-center">
        <CockpitShell
          mode="normal"
          selectedId="hudson"
          drillTargetId="last-turn"
        />
      </div>
      <Caption>
        frame 1 · at rest — Hudson selected, context loaded, last-turn rendered full-text in the focus column
      </Caption>

      {/* Keyboard navigation callout */}
      <div className="mx-auto mt-8 max-w-[860px]">
        <CockpitKeyboardCallout />
      </div>

      {/* Mode frames — 4 more states */}
      <div className="mt-14">
        <h3 className="font-display text-[18px] font-medium text-studio-ink">
          The four modes the cockpit cycles through
        </h3>
        <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
          One key away from each. The strip on top tells the operator
          which mode they&apos;re in; the input dock at the bottom is the
          mouth of all four. Command and search overlay a small floating
          panel above the dock; talk replaces the placeholder with a live
          transcription line and starts to materialize a response in the
          focus column.
        </p>

        <div className="mt-6 flex flex-col items-center gap-12">
          <CockpitFrameBlock
            n="2"
            label="Command mode · `:`"
            caption="operator typed `:` — small palette floats above the dock with matching commands. Top strip flips to `-- COMMAND --`."
          >
            <CockpitShell
              mode="command"
              selectedId="hudson"
              drillTargetId="last-turn"
              commandQuery="spaw"
            />
          </CockpitFrameBlock>

          <CockpitFrameBlock
            n="3"
            label="Search mode · `/`"
            caption="operator typed `/audit` — results panel above the dock surfaces matches across agents, threads, and files. Top strip reads `-- SEARCH --`."
          >
            <CockpitShell
              mode="search"
              selectedId="hudson"
              drillTargetId="last-turn"
              searchQuery="audit"
            />
          </CockpitFrameBlock>

          <CockpitFrameBlock
            n="4"
            label="Conversational mode · TALK"
            caption="mic active, operator dictating; the focus column begins materializing the assistant's reply — a thinking pulse, then the first line forming. Top strip reads `-- TALK --`."
          >
            <CockpitShell
              mode="talk"
              selectedId="hudson"
              drillTargetId="assistant-reply"
              talkTranscript="hand Drover the migration file and tell Hudson to stand by"
            />
          </CockpitFrameBlock>

          <CockpitFrameBlock
            n="5"
            label="Rose attention state · Drover selected"
            caption="Drover is the attention agent; the rose treatment appears in two places — the left-edge stripe in col 1 and the `waiting on you` ask block in col 2. Col 3 holds the full text of the ask and the operator's options. Everything else stays ink."
          >
            <CockpitShell
              mode="normal"
              selectedId="drover"
              drillTargetId="ask"
            />
          </CockpitFrameBlock>
        </div>
      </div>

      <p className="mx-auto mt-10 max-w-prose font-sans text-[12.5px] italic leading-relaxed text-studio-ink-faint">
        The cockpit is one thing. The slot library further down is everything
        else. The cockpit gets the design budget every week; the slot
        library gets the studio surfaces it already has.
      </p>
    </section>
  );
}

function CockpitFrameBlock({
  n,
  label,
  caption,
  children,
}: {
  n: string;
  label: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col items-center">
      <div className="mb-2 flex items-baseline gap-3">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · frame {n}
        </span>
        <span className="font-mono text-[10.5px] text-studio-ink">{label}</span>
      </div>
      {children}
      <p className="mx-auto mt-3 max-w-[680px] text-center font-sans text-[11.5px] italic leading-relaxed text-studio-ink-faint">
        {caption}
      </p>
    </div>
  );
}

// ── Cockpit shell — glass body, top strip, 3 columns, input dock ────

function CockpitShell({
  mode,
  selectedId,
  drillTargetId,
  commandQuery,
  searchQuery,
  talkTranscript,
}: {
  mode: CockpitMode;
  selectedId: string;
  drillTargetId: string;
  commandQuery?: string;
  searchQuery?: string;
  talkTranscript?: string;
}) {
  const selected = COCKPIT_FLEET.find((a) => a.id === selectedId) ?? COCKPIT_FLEET[0];
  return (
    <div
      className="relative overflow-hidden rounded-[12px]"
      style={{
        width: COCKPIT_W,
        height: COCKPIT_H,
        background:
          "linear-gradient(135deg, var(--hud-base-top), var(--hud-base-bottom))",
        backdropFilter: "blur(24px) saturate(150%)",
        WebkitBackdropFilter: "blur(24px) saturate(150%)",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
        boxShadow:
          "0 24px 64px -20px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05) inset",
      }}
    >
      {/* accent wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.022) 0%, transparent 55%, color-mix(in oklab, var(--hud-rose) 4%, transparent) 100%)",
        }}
      />
      {/* top-edge wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: COCKPIT_H * 0.45,
          background: "linear-gradient(to bottom, rgba(255,255,255,0.055), transparent)",
        }}
      />
      {/* mesh-light specular */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 26% 24%, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.025) 22%, transparent 58%)",
        }}
      />
      {/* top rim — cyan whisper */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: 1.5,
          background:
            "linear-gradient(to right, transparent 0%, rgba(255,255,255,0.28) 28%, color-mix(in oklab, var(--hud-cyan) 28%, transparent) 50%, rgba(255,255,255,0.28) 72%, transparent 100%)",
        }}
      />
      {/* corner halos */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: -40,
          top: -30,
          width: 160,
          height: 80,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.045) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          right: -40,
          top: -30,
          width: 160,
          height: 80,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.045) 0%, transparent 70%)",
        }}
      />

      {/* Body: top strip + columns + bottom strip */}
      <div className="relative flex h-full flex-col">
        <CockpitTopStrip mode={mode} fleet={COCKPIT_FLEET} />
        <div className="relative flex flex-1 min-h-0">
          <CockpitColumnFleet
            fleet={COCKPIT_FLEET}
            selectedId={selectedId}
            width={COCKPIT_COL1_W}
          />
          <CockpitColumnDivider />
          <CockpitColumnContext
            agent={selected}
            width={COCKPIT_COL2_W}
            highlightAsk={selected.id === "drover"}
            drillTargetId={drillTargetId}
          />
          <CockpitColumnDivider />
          <CockpitColumnFocus
            agent={selected}
            width={COCKPIT_COL3_W}
            drillTargetId={drillTargetId}
            mode={mode}
          />
        </div>
        {/* horizontal hairline above the bottom strip */}
        <div aria-hidden style={{ height: 1 }}>
          <HudHairline />
        </div>
        <CockpitInputDock
          mode={mode}
          commandQuery={commandQuery}
          searchQuery={searchQuery}
          talkTranscript={talkTranscript}
        />
        {/* Floating overlays for command + search modes */}
        {mode === "command" ? (
          <CockpitCommandPalette query={commandQuery ?? ""} />
        ) : null}
        {mode === "search" ? (
          <CockpitSearchResults query={searchQuery ?? ""} />
        ) : null}
      </div>
    </div>
  );
}

function CockpitColumnDivider() {
  return (
    <div
      aria-hidden
      className="shrink-0"
      style={{
        width: 1,
        background:
          "linear-gradient(to bottom, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.10) 18%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.08) 82%, rgba(255,255,255,0.02) 100%)",
      }}
    />
  );
}

// ── Top strip — mode indicator + fleet pulse + hotkey hints ─────────

function CockpitTopStrip({ mode, fleet }: { mode: CockpitMode; fleet: HudAgent[] }) {
  const running = fleet.filter((a) => a.state === "working").length;
  const attention = fleet.filter((a) => a.state === "needs-attention").length;
  const done = fleet.filter((a) => a.state === "done").length;
  const modeLabel =
    mode === "command"
      ? "-- COMMAND --"
      : mode === "search"
        ? "-- SEARCH --"
        : mode === "talk"
          ? "-- TALK --"
          : "-- NORMAL --";
  const modeColor =
    mode === "command" || mode === "search"
      ? "var(--hud-cyan)"
      : mode === "talk"
        ? "var(--scout-accent)"
        : "rgba(255,255,255,0.7)";

  return (
    <div
      className="relative flex items-center justify-between px-3"
      style={{
        height: COCKPIT_STRIP_TOP,
        borderBottom: "1px solid var(--hud-glass-stroke-soft)",
        background: "rgba(0,0,0,0.18)",
      }}
    >
      {/* Mode indicator */}
      <span
        className="font-mono text-[10px] font-semibold tabular-nums"
        style={{ color: modeColor, letterSpacing: "0.08em" }}
      >
        {modeLabel}
      </span>

      {/* Fleet pulse summary — center */}
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 font-mono text-[10px] text-studio-ink" style={{ opacity: 0.85 }}>
        <span className="tabular-nums">{running} running</span>
        <PanelStatDot />
        <span
          className="tabular-nums"
          style={{
            color: attention > 0 ? "var(--hud-rose)" : undefined,
            opacity: attention > 0 ? 1 : 0.85,
          }}
        >
          {attention} attention
        </span>
        <PanelStatDot />
        <span className="tabular-nums">{done} done</span>
      </div>

      {/* Hotkey hints — right */}
      <div className="flex items-center gap-2 font-mono text-[9.5px] text-studio-ink" style={{ opacity: 0.62 }}>
        <span>?</span>
        <span style={{ opacity: 0.7 }}>help</span>
        <PanelStatDot />
        <span>q</span>
        <span style={{ opacity: 0.7 }}>dismiss</span>
      </div>
    </div>
  );
}

// ── Column 1 — Fleet ────────────────────────────────────────────────

function CockpitColumnFleet({
  fleet,
  selectedId,
  width,
}: {
  fleet: HudAgent[];
  selectedId: string;
  width: number;
}) {
  return (
    <div
      className="flex shrink-0 flex-col"
      style={{ width, background: "rgba(0,0,0,0.10)" }}
    >
      {/* column header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--hud-glass-stroke-soft)" }}
      >
        <span className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · fleet
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.6 }}>
          {fleet.length}
        </span>
      </div>
      <div className="flex-1 overflow-hidden">
        {fleet.map((a) => (
          <CockpitFleetRow key={a.id} agent={a} selected={a.id === selectedId} />
        ))}
      </div>
    </div>
  );
}

function CockpitFleetRow({ agent, selected }: { agent: HudAgent; selected: boolean }) {
  const isAttention = agent.state === "needs-attention";
  const hueColor = `oklch(0.42 0.008 80)`;
  const stripeColor = isAttention ? "var(--hud-rose)" : hueColor;
  const glyphColor = isAttention
    ? "var(--hud-rose)"
    : agent.state === "working" || agent.state === "done"
      ? "var(--hud-cyan)"
      : "rgba(255,255,255,0.55)";
  // Selection indicator: subtle left-edge marker, ink only — no color flood.
  // Cyan reserved for the focused row's marker stop.
  return (
    <div
      className="relative flex flex-col gap-0.5 px-2.5 py-1.5"
      style={{
        background: selected ? "var(--hud-glass-fill-strong)" : "transparent",
      }}
    >
      {/* hue stripe (always) */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full"
        style={{ width: isAttention ? 2.5 : 2, background: stripeColor }}
      />
      {/* selection marker — short cyan tick at left edge, only when selected */}
      {selected ? (
        <span
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2"
          style={{
            left: -1,
            width: 2,
            height: 18,
            background: "var(--hud-cyan)",
            borderRadius: 1,
          }}
        />
      ) : null}
      <div className="flex items-center gap-1.5 pl-1.5">
        <StatusGlyph state={agent.state} color={glyphColor} />
        <span className="truncate font-sans text-[11.5px] font-medium text-studio-ink">
          {agent.name}
        </span>
        <span
          className="ml-auto shrink-0 font-mono text-[8.5px] tabular-nums text-studio-ink"
          style={{ opacity: 0.55 }}
        >
          {agent.ago}
        </span>
      </div>
      <p
        className="truncate pl-1.5 font-sans text-[10px] leading-tight text-studio-ink"
        style={{ opacity: selected ? 0.88 : 0.66 }}
      >
        {agent.task}
      </p>
    </div>
  );
}

// ── Column 2 — Context ──────────────────────────────────────────────

function CockpitColumnContext({
  agent,
  width,
  highlightAsk,
  drillTargetId,
}: {
  agent: HudAgent;
  width: number;
  highlightAsk?: boolean;
  drillTargetId: string;
}) {
  const isAttention = agent.state === "needs-attention";
  return (
    <div className="flex shrink-0 flex-col" style={{ width }}>
      {/* column header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--hud-glass-stroke-soft)" }}
      >
        <span className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · context · {agent.name.toLowerCase()}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {agent.role}
        </span>
      </div>

      <div className="flex flex-1 min-h-0 flex-col gap-2.5 overflow-hidden px-3 py-2.5">
        {/* Recent turn summary */}
        <div>
          <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            · recent turn
          </div>
          <p
            className="mt-1 font-sans text-[10.5px] italic leading-snug text-studio-ink"
            style={{
              opacity: 0.92,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {agent.lastTurn}
          </p>
        </div>

        {/* Stat KV block */}
        <CockpitStatGrid agent={agent} />

        {/* Cross-agent message snippet */}
        {agent.lastMessage ? (
          <div>
            <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
              · last message
            </div>
            <div className="mt-1 flex items-start gap-1.5">
              <span className="mt-[2px] shrink-0">
                <MessageArrow />
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-mono text-[9.5px] text-studio-ink" style={{ opacity: 0.92 }}>
                  @{agent.lastMessage.to}
                </span>
                <span className="font-sans text-[10px] italic leading-snug text-studio-ink" style={{ opacity: 0.82 }}>
                  {" "}
                  “{agent.lastMessage.text}”
                </span>
              </span>
            </div>
          </div>
        ) : null}

        {/* Pending ask block — only when the agent is waiting on the operator */}
        {highlightAsk && isAttention && agent.pendingAsk ? (
          <div
            className="rounded-[4px] px-2.5 py-2"
            style={{
              background: "color-mix(in oklab, var(--hud-rose) 12%, transparent)",
              border: "0.75px solid var(--hud-rose-soft)",
            }}
          >
            <div
              className="font-mono text-[8.5px] uppercase tracking-eyebrow"
              style={{ color: "var(--hud-rose)" }}
            >
              waiting on you
            </div>
            <p className="mt-0.5 font-sans text-[10.5px] leading-snug text-studio-ink">
              {agent.pendingAsk}
            </p>
          </div>
        ) : null}

        {/* Drill targets list — pushed to the bottom */}
        <div className="mt-auto flex flex-col gap-0.5 pt-1.5">
          <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            · drill
          </div>
          <CockpitDrillRow
            id="last-turn"
            label="last 5 turns"
            count={5}
            selected={drillTargetId === "last-turn" || drillTargetId === "assistant-reply"}
          />
          <CockpitDrillRow
            id="files"
            label="changed files"
            count={agent.files ?? 0}
            selected={drillTargetId === "files"}
          />
          <CockpitDrillRow
            id="messages"
            label="message log"
            count={47}
            selected={drillTargetId === "messages"}
          />
          {isAttention ? (
            <CockpitDrillRow
              id="ask"
              label="open ask"
              count={1}
              selected={drillTargetId === "ask"}
              attention
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CockpitDrillRow({
  label,
  count,
  selected,
  attention,
}: {
  id: string;
  label: string;
  count: number;
  selected: boolean;
  attention?: boolean;
}) {
  const arrow = "→";
  const color = attention ? "var(--hud-rose)" : "var(--studio-ink)";
  return (
    <div
      className="flex items-center gap-1.5 rounded-[3px] px-1.5 py-0.5"
      style={{
        background: selected
          ? attention
            ? "color-mix(in oklab, var(--hud-rose) 10%, transparent)"
            : "var(--hud-glass-fill-strong)"
          : "transparent",
      }}
    >
      <span
        aria-hidden
        className="font-mono text-[10px]"
        style={{ color, opacity: selected ? 1 : 0.55 }}
      >
        {arrow}
      </span>
      <span
        className="flex-1 font-sans text-[10px] text-studio-ink"
        style={{ opacity: selected ? 1 : 0.78 }}
      >
        {label}
      </span>
      <span
        className="font-mono text-[9px] tabular-nums"
        style={{ color, opacity: selected ? 1 : 0.55 }}
      >
        ({count})
      </span>
    </div>
  );
}

function CockpitStatGrid({ agent }: { agent: HudAgent }) {
  return (
    <div
      className="grid gap-y-1 rounded-[4px] px-2 py-1.5"
      style={{
        gridTemplateColumns: "auto 1fr auto 1fr",
        background: "rgba(0,0,0,0.20)",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
        columnGap: 8,
      }}
    >
      <StatKV k="runtime" v={agent.runtime ?? "—"} />
      <StatKV k="files" v={(agent.files ?? 0).toString()} mono />
      <StatKV k="tokens" v={agent.tokens ?? "—"} mono />
      <StatKV k="model" v={agent.model ?? "—"} />
      <StatKV k="branch" v={agent.branch ?? "—"} span={3} />
    </div>
  );
}

// ── Column 3 — Focus ────────────────────────────────────────────────

function CockpitColumnFocus({
  agent,
  width,
  drillTargetId,
  mode,
}: {
  agent: HudAgent;
  width: number;
  drillTargetId: string;
  mode: CockpitMode;
}) {
  const headerLabel =
    drillTargetId === "ask"
      ? "· open ask · operator decision"
      : drillTargetId === "assistant-reply"
        ? "· assistant · materializing"
        : drillTargetId === "files"
          ? `· files · ${agent.files ?? 0} touched`
          : drillTargetId === "messages"
            ? "· message log · 47 entries"
            : `· last turn · ${agent.name.toLowerCase()}`;

  return (
    <div className="flex min-w-0 flex-1 flex-col" style={{ width }}>
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--hud-glass-stroke-soft)" }}
      >
        <span className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          {headerLabel}
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
          enter ↵ to drill
        </span>
      </div>
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden px-3 py-3">
        {drillTargetId === "ask" && agent.state === "needs-attention" ? (
          <CockpitAskFocus agent={agent} />
        ) : drillTargetId === "assistant-reply" || mode === "talk" ? (
          <CockpitAssistantFocus agent={agent} />
        ) : drillTargetId === "files" ? (
          <CockpitFilesFocus agent={agent} />
        ) : drillTargetId === "messages" ? (
          <CockpitMessagesFocus agent={agent} />
        ) : (
          <CockpitLastTurnFocus agent={agent} />
        )}
      </div>
    </div>
  );
}

function CockpitLastTurnFocus({ agent }: { agent: HudAgent }) {
  // Full text of the most recent turn — rendered as an editorial passage.
  return (
    <article className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          {agent.ago} · turn 14
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
          {agent.model}
        </span>
      </div>
      <p
        className="font-sans text-[12px] italic leading-relaxed text-studio-ink"
        style={{ opacity: 0.94 }}
      >
        {agent.lastTurn}
      </p>
      <p className="font-sans text-[11.5px] leading-relaxed text-studio-ink" style={{ opacity: 0.78 }}>
        Next planned step: assemble the failure-branch patch, run it through the
        existing audit-trail tests, and hand the diff back to you for sign-off
        before merging into <span className="font-mono text-[10.5px]">{agent.branch}</span>.
      </p>
      <p className="font-sans text-[11px] leading-relaxed text-studio-ink" style={{ opacity: 0.65 }}>
        I&apos;ll keep going on the patch unless you want me to wait for
        Drover&apos;s migration first — they overlap on the <span className="font-mono text-[10px]">sessions</span> schema.
      </p>
      <div className="mt-auto flex items-center justify-between pt-1.5">
        <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          · turn buffer · 1/5
        </span>
        <CockpitTurnPagination current={1} total={5} />
      </div>
    </article>
  );
}

function CockpitTurnPagination({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className="block rounded-full"
          style={{
            width: i === current - 1 ? 8 : 4,
            height: 4,
            background:
              i === current - 1 ? "var(--hud-cyan)" : "rgba(255,255,255,0.30)",
          }}
        />
      ))}
    </div>
  );
}

function CockpitAssistantFocus({ agent: _agent }: { agent: HudAgent }) {
  return (
    <article className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          assistant · now
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
          opus-4-7 · streaming
        </span>
      </div>
      {/* Thinking pulse */}
      <CockpitThinkingPulse />
      {/* First-line forming — the response is materializing */}
      <p
        className="font-sans text-[12px] leading-relaxed text-studio-ink"
        style={{ opacity: 0.96 }}
      >
        On it. I&apos;ll route the migration file to Drover the moment it lands and tell Hudson to hold the audit-trail patch
        <CockpitInlineCursor />
      </p>
      <p
        className="font-sans text-[11.5px] leading-relaxed text-studio-ink"
        style={{ opacity: 0.42 }}
      >
        — staging the message now —
      </p>
      <div className="mt-auto flex items-center gap-2 pt-1.5">
        <span
          aria-hidden
          className="block h-1 w-1 rounded-full"
          style={{ background: "var(--scout-accent)" }}
        />
        <span className="font-mono text-[9px] uppercase tracking-eyebrow" style={{ color: "var(--scout-accent)" }}>
          live · will commit on stop
        </span>
        <span className="ml-auto font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
          esc to cancel
        </span>
      </div>
    </article>
  );
}

function CockpitInlineCursor() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block align-text-bottom"
      style={{
        width: 6,
        height: 12,
        background: "var(--scout-accent)",
        opacity: 0.85,
      }}
    />
  );
}

function CockpitThinkingPulse() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        · thinking
      </span>
      <span className="flex items-center gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className="block h-[3px] w-[3px] rounded-full"
            style={{
              background: "var(--scout-accent)",
              opacity: 0.85 - i * 0.22,
            }}
          />
        ))}
      </span>
    </div>
  );
}

function CockpitAskFocus({ agent }: { agent: HudAgent }) {
  return (
    <article className="flex flex-1 min-h-0 flex-col gap-2.5 overflow-hidden">
      <div className="flex items-baseline justify-between">
        <span
          className="font-mono text-[9px] uppercase tracking-eyebrow"
          style={{ color: "var(--hud-rose)" }}
        >
          · operator decision
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
          {agent.ago} · blocking Hudson downstream
        </span>
      </div>
      <p
        className="font-sans text-[12px] italic leading-relaxed text-studio-ink"
        style={{ opacity: 0.95 }}
      >
        “{agent.pendingAsk}”
      </p>
      <p
        className="font-sans text-[11.5px] leading-relaxed text-studio-ink"
        style={{ opacity: 0.82 }}
      >
        Both migrations touch the <span className="font-mono text-[10.5px]">sessions</span> table.
        Order changes the shape of the patch on the other side — there isn&apos;t a wrong answer here,
        just a cheaper one and a more expensive one.
      </p>
      <div className="flex flex-col gap-1.5 rounded-[4px] px-2.5 py-2"
        style={{
          background: "rgba(0,0,0,0.22)",
          border: "0.75px solid var(--hud-glass-stroke-soft)",
        }}
      >
        <CockpitOptionRow
          key="a"
          mark="a"
          title="Roll index split first"
          detail="fk rename becomes a 6-line patch. Cheaper. Recommended."
          recommended
        />
        <CockpitOptionRow
          key="b"
          mark="b"
          title="Roll fk rename first"
          detail="index becomes a full rebuild. ~12m runtime, no data loss risk."
        />
        <CockpitOptionRow
          key="c"
          mark="c"
          title="Hold — get more context"
          detail="Drover stands down; Hudson is unblocked manually."
        />
      </div>
      <div className="mt-auto flex items-center gap-2 pt-1">
        <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          press a / b / c · or type below
        </span>
      </div>
    </article>
  );
}

function CockpitOptionRow({
  mark,
  title,
  detail,
  recommended,
}: {
  mark: string;
  title: string;
  detail: string;
  recommended?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden
        className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border font-mono text-[9px] font-semibold"
        style={{
          background: recommended ? "color-mix(in oklab, var(--hud-cyan) 16%, transparent)" : "transparent",
          borderColor: recommended ? "var(--hud-cyan-soft)" : "var(--hud-glass-stroke-soft)",
          color: recommended ? "var(--hud-cyan)" : "var(--studio-ink)",
        }}
      >
        {mark}
      </span>
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-sans text-[11px] font-medium text-studio-ink">
            {title}
          </span>
          {recommended ? (
            <span
              className="font-mono text-[8.5px] uppercase tracking-eyebrow"
              style={{ color: "var(--hud-cyan)" }}
            >
              recommended
            </span>
          ) : null}
        </div>
        <p className="font-sans text-[10.5px] leading-snug text-studio-ink" style={{ opacity: 0.7 }}>
          {detail}
        </p>
      </div>
    </div>
  );
}

function CockpitFilesFocus({ agent }: { agent: HudAgent }) {
  // Drill into changed files — file list with diff counts.
  const files = [
    { path: "api/auth/middleware.ts", added: 32, removed: 8 },
    { path: "api/auth/audit-trail.ts", added: 14, removed: 2 },
    { path: "api/auth/sign-in/password-reset.ts", added: 6, removed: 4 },
    { path: "api/auth/sign-in/sso.ts", added: 2, removed: 0 },
    { path: "tests/auth/audit-trail.spec.ts", added: 48, removed: 0 },
    { path: "db/migrations/0042_audit_reason.sql", added: 11, removed: 0 },
  ];
  return (
    <article className="flex flex-1 min-h-0 flex-col gap-1.5 overflow-hidden">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          · {agent.branch}
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
          {agent.files} files
        </span>
      </div>
      <div className="flex flex-col gap-[3px]">
        {files.map((f) => (
          <div
            key={f.path}
            className="flex items-baseline gap-2 rounded-[3px] px-1.5 py-1"
            style={{ background: "rgba(255,255,255,0.018)" }}
          >
            <span className="truncate font-mono text-[10px] text-studio-ink" style={{ opacity: 0.88 }}>
              {f.path}
            </span>
            <span className="ml-auto font-mono text-[9.5px] tabular-nums text-studio-ink" style={{ opacity: 0.82 }}>
              +{f.added}
            </span>
            <span className="font-mono text-[9.5px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
              −{f.removed}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}

function CockpitMessagesFocus({ agent: _agent }: { agent: HudAgent }) {
  const log = [
    { ago: "11s", to: "drover", text: "hand me the migration file when you're done — I want to verify the trail spans both schemas" },
    { ago: "47s", to: "operator", text: "audit-trail is clean on magic-link and SSO; drafting the patch on the password-reset failure branch" },
    { ago: "4m", to: "quill", text: "yes — quote this run as the canonical 'operator-spawned working agent' example" },
    { ago: "8m", to: "operator", text: "checkpoint: walked the four sign-in paths; magic-link/SSO clean, two issues on password-reset" },
    { ago: "14m", to: "drover", text: "what's your ETA on the migration? I can hold the patch if you're close" },
    { ago: "22m", to: "operator", text: "spawned — starting on the auth-mw audit you flagged this morning" },
  ];
  return (
    <article className="flex flex-1 min-h-0 flex-col gap-1.5 overflow-hidden">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          · 6 of 47 · newest first
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
          j/k to scroll
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {log.map((m, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
                {m.ago}
              </span>
              <span className="font-mono text-[9.5px] text-studio-ink" style={{ opacity: 0.92 }}>
                @{m.to}
              </span>
            </div>
            <p
              className="font-sans text-[10.5px] leading-snug text-studio-ink"
              style={{ opacity: 0.85 }}
            >
              “{m.text}”
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

// ── Bottom strip — always-pinned conversational dock ────────────────

function CockpitInputDock({
  mode,
  commandQuery,
  searchQuery,
  talkTranscript,
}: {
  mode: CockpitMode;
  commandQuery?: string;
  searchQuery?: string;
  talkTranscript?: string;
}) {
  // Three states drive the dock surface:
  //   normal  → empty placeholder hint
  //   command → leading colon + query text
  //   search  → leading slash + query text
  //   talk    → mic active + live transcription
  const placeholder = "talk to the assistant: ':' for commands, '/' for search, anything else conversational";
  const isTalk = mode === "talk";
  const isCommand = mode === "command";
  const isSearch = mode === "search";

  let displayText = "";
  let leadingGlyph: ReactNode = null;
  if (isCommand) {
    displayText = commandQuery ?? "";
    leadingGlyph = (
      <span className="font-mono text-[13px] text-studio-ink" style={{ opacity: 0.95 }}>:</span>
    );
  } else if (isSearch) {
    displayText = searchQuery ?? "";
    leadingGlyph = (
      <span className="font-mono text-[13px] text-studio-ink" style={{ opacity: 0.95 }}>/</span>
    );
  } else if (isTalk) {
    displayText = talkTranscript ?? "";
  }

  return (
    <div
      className="relative flex items-center gap-2.5 px-3"
      style={{
        height: COCKPIT_STRIP_BOTTOM,
        background: "rgba(0,0,0,0.22)",
      }}
    >
      {/* Mic button */}
      <button
        type="button"
        aria-label={isTalk ? "Stop recording" : "Voice input"}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors"
        style={{
          color: isTalk ? "var(--status-error-fg)" : "var(--studio-ink-faint)",
          background: isTalk
            ? "color-mix(in oklab, var(--status-error-bg) 90%, transparent)"
            : "transparent",
        }}
      >
        {isTalk ? (
          <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
            <circle cx={10} cy={10} r={4} fill="var(--status-error-fg)" />
            <circle cx={10} cy={10} r={6.5} fill="none" stroke="var(--status-error-fg)" strokeWidth={0.8} opacity={0.55} />
            <circle cx={10} cy={10} r={9} fill="none" stroke="var(--status-error-fg)" strokeWidth={0.6} opacity={0.28} />
          </svg>
        ) : (
          <SteerActionGlyph kind="mic" />
        )}
      </button>

      {/* Input field — flex content */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {leadingGlyph}
        {displayText ? (
          <span
            className="truncate font-mono text-[12px] text-studio-ink"
            style={{ opacity: 0.95 }}
          >
            {displayText}
            <CockpitInputCursor />
          </span>
        ) : (
          <span
            className="truncate font-mono text-[11.5px] text-studio-ink-faint"
            style={{ fontStyle: "italic" }}
          >
            {placeholder}
          </span>
        )}
      </div>

      {/* Mode-specific hint + send */}
      <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint md:inline">
        {isCommand
          ? "↵ run"
          : isSearch
            ? "↵ jump"
            : isTalk
              ? "esc stop"
              : "↵ send"}
      </span>

      {/* Send button */}
      <button
        type="button"
        aria-label="Send"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
        style={{
          color: displayText || isTalk ? "var(--scout-accent)" : "var(--studio-ink-faint)",
          background: displayText || isTalk
            ? "color-mix(in oklab, var(--studio-canvas-alt) 70%, transparent)"
            : "transparent",
          opacity: displayText || isTalk ? 1 : 0.55,
        }}
      >
        <SteerActionGlyph kind="send" />
      </button>
    </div>
  );
}

function CockpitInputCursor() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block align-middle"
      style={{
        width: 1.5,
        height: 12,
        background: "var(--studio-ink)",
        opacity: 0.9,
      }}
    />
  );
}

// ── Command palette overlay (`:` mode) ──────────────────────────────

function CockpitCommandPalette({ query }: { query: string }) {
  const commands = [
    { key: ":spawn", detail: "spawn a new agent · workspace + role", match: true },
    { key: ":msg", detail: "send a message to one or more agents" },
    { key: ":focus", detail: "promote an agent to active context" },
    { key: ":list", detail: "list agents matching a filter" },
    { key: ":dismiss", detail: "stand down the current agent" },
  ];
  // Filter — show all if query is one of the demo strings; otherwise highlight matches.
  const visible = commands;
  return (
    <div
      className="absolute z-30 overflow-hidden rounded-[8px]"
      style={{
        left: 14,
        right: 14,
        bottom: COCKPIT_STRIP_BOTTOM + 8,
        background: "rgba(8,10,14,0.92)",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
        boxShadow: "0 -8px 28px -10px rgba(0,0,0,0.55)",
        backdropFilter: "blur(12px) saturate(140%)",
        WebkitBackdropFilter: "blur(12px) saturate(140%)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ borderBottom: "1px solid var(--hud-glass-stroke-soft)" }}
      >
        <span className="font-mono text-[8.5px] uppercase tracking-eyebrow" style={{ color: "var(--hud-cyan)" }}>
          · command · {visible.length} matches for &quot;:{query}&quot;
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
          j/k · ↵ run
        </span>
      </div>
      <div className="flex flex-col">
        {visible.map((c, i) => (
          <div
            key={c.key}
            className="flex items-baseline gap-2 px-3 py-1.5"
            style={{
              background: i === 0 ? "var(--hud-glass-fill-strong)" : "transparent",
            }}
          >
            <span
              className="font-mono text-[11px] font-medium text-studio-ink"
              style={{ minWidth: 80 }}
            >
              {c.key}
            </span>
            <span className="font-sans text-[10.5px] text-studio-ink" style={{ opacity: 0.78 }}>
              {c.detail}
            </span>
            {c.match ? (
              <span
                className="ml-auto font-mono text-[8.5px] uppercase tracking-eyebrow"
                style={{ color: "var(--hud-cyan)" }}
              >
                ↵
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Search results overlay (`/` mode) ───────────────────────────────

function CockpitSearchResults({ query }: { query: string }) {
  const results = [
    { kind: "agent", title: "Hudson · auth-mw audit", detail: "current run · 14 files · audit-trail review", glyph: "agent" as const },
    { kind: "thread", title: "audit trail · 47 msgs", detail: "Hudson ↔ operator ↔ Drover · 1h 14m", glyph: "thread" as const },
    { kind: "file", title: "audit.md", detail: "docs/architecture/audit.md · 3 occurrences", glyph: "file" as const },
    { kind: "file", title: "auth/audit-trail.ts", detail: "api/auth/audit-trail.ts · 12 occurrences", glyph: "file" as const },
    { kind: "agent", title: "Quill · docs/agent-ref", detail: "drafting · references audit-trail twice", glyph: "agent" as const },
  ];
  return (
    <div
      className="absolute z-30 overflow-hidden rounded-[8px]"
      style={{
        left: 14,
        right: 14,
        bottom: COCKPIT_STRIP_BOTTOM + 8,
        background: "rgba(8,10,14,0.92)",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
        boxShadow: "0 -8px 28px -10px rgba(0,0,0,0.55)",
        backdropFilter: "blur(12px) saturate(140%)",
        WebkitBackdropFilter: "blur(12px) saturate(140%)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ borderBottom: "1px solid var(--hud-glass-stroke-soft)" }}
      >
        <span className="font-mono text-[8.5px] uppercase tracking-eyebrow" style={{ color: "var(--hud-cyan)" }}>
          · search · {results.length} matches for &quot;/{query}&quot;
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
          j/k · ↵ jump
        </span>
      </div>
      <div className="flex flex-col">
        {results.map((r, i) => (
          <div
            key={i}
            className="flex items-baseline gap-2 px-3 py-1.5"
            style={{
              background: i === 0 ? "var(--hud-glass-fill-strong)" : "transparent",
            }}
          >
            <CockpitResultGlyph kind={r.glyph} />
            <span className="font-sans text-[11px] font-medium text-studio-ink">
              {r.title}
            </span>
            <span className="font-mono text-[9.5px] text-studio-ink" style={{ opacity: 0.6 }}>
              {r.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CockpitResultGlyph({ kind }: { kind: "agent" | "thread" | "file" }) {
  if (kind === "agent") {
    return (
      <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden>
        <circle cx={5.5} cy={4} r={2} stroke="rgba(255,255,255,0.7)" strokeWidth={1} fill="none" />
        <path d="M2 10 A4 4 0 0 1 9 10" stroke="rgba(255,255,255,0.7)" strokeWidth={1} fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "thread") {
    return (
      <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden>
        <line x1={2} y1={3.5} x2={9} y2={3.5} stroke="rgba(255,255,255,0.7)" strokeWidth={1} strokeLinecap="round" />
        <line x1={2} y1={6} x2={7.5} y2={6} stroke="rgba(255,255,255,0.7)" strokeWidth={1} strokeLinecap="round" />
        <line x1={2} y1={8.5} x2={6} y2={8.5} stroke="rgba(255,255,255,0.7)" strokeWidth={1} strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden>
      <path d="M3 1.5 L7 1.5 L9 3.5 L9 9.5 L3 9.5 Z" stroke="rgba(255,255,255,0.7)" strokeWidth={1} fill="none" strokeLinejoin="round" />
      <path d="M7 1.5 L7 3.5 L9 3.5" stroke="rgba(255,255,255,0.7)" strokeWidth={1} fill="none" strokeLinejoin="round" />
    </svg>
  );
}

// ── Keyboard navigation callout ─────────────────────────────────────

function CockpitKeyboardCallout() {
  const cells: Array<{ keys: string; label: string }> = [
    { keys: "j / k", label: "up / down in column" },
    { keys: "h / l", label: "move between columns" },
    { keys: "↵", label: "drill down" },
    { keys: ":", label: "command mode" },
    { keys: "/", label: "search mode" },
    { keys: "t / tab", label: "toggle talk" },
    { keys: "⎋", label: "dismiss" },
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[6px] border border-studio-edge px-4 py-2.5"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · keyboard
      </span>
      {cells.map((c) => (
        <span key={c.keys} className="flex items-center gap-1.5">
          <span
            className="inline-grid place-items-center rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[10px] text-studio-ink"
            style={{ background: "var(--studio-canvas)" }}
          >
            {c.keys}
          </span>
          <span className="font-mono text-[10px] text-studio-ink-faint">{c.label}</span>
        </span>
      ))}
    </div>
  );
}

// ── 7 · The slot model — everything else is a web view ──────────────
//
// The parallel system to the cockpit. The HUD shell hosts any of the
// studio's existing surfaces; the operator binds them to hotkeys.
// Below: a slot library (6 candidate surfaces), a hotkey registration
// table mock, a 4-step summoning sequence, and an editorial coda.

const SLOT_W = 320;
const SLOT_H = 260;

function SlotModelSection() {
  return (
    <section className="mt-16">
      <SectionHead
        kicker="the slot model"
        title="Everything else is a web view"
        lede="The cockpit is the one native, deeply-iterated surface. Beyond it, the HUD shell hosts studio web views — tail, fleet, mission, agent detail, canvas, brief in-flight, and whatever the operator wires up next. The shell handles glass, position, always-on-top, multi-space; the view renders itself."
      />

      {/* A — slot library */}
      <div className="mt-8">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · A · slot library
        </div>
        <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
          Six candidate surfaces drawn at slot scale (~{SLOT_W}×{SLOT_H}). Each renders inside the same HUD-shaped frame. The shell is identical; the contents are existing studio surfaces.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <SlotCard label="Tail · firehose">
            <SlotTail />
          </SlotCard>
          <SlotCard label="Fleet · dense">
            <SlotFleet />
          </SlotCard>
          <SlotCard label="Mission · grouped">
            <SlotMission />
          </SlotCard>
          <SlotCard label="Agent detail · Hudson">
            <SlotAgentDetail />
          </SlotCard>
          <SlotCard label="Canvas · spatial">
            <SlotCanvas />
          </SlotCard>
          <SlotCard label="Brief in-flight">
            <SlotBriefInFlight />
          </SlotCard>
        </div>
        <p className="mx-auto mt-5 max-w-prose text-center font-sans text-[12px] italic leading-relaxed text-studio-ink-faint">
          Any of these — and more — can be slotted into the HUD shell. The shell handles glass + position + hotkey + persistence; the view renders itself.
        </p>
      </div>

      {/* B — hotkey registration table */}
      <div className="mt-14">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · B · hotkey registration
        </div>
        <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
          The settings panel an operator uses to wire slots to keys. The cockpit row is non-editable — it&apos;s the assistant, always on the hyper chord. The rest are user-assignable; defaults ship sane.
        </p>
        <div className="mt-5 flex justify-center">
          <SlotHotkeyTable />
        </div>
        <p className="mx-auto mt-3 max-w-prose text-center font-sans text-[12px] italic leading-relaxed text-studio-ink-faint">
          Each operator wires the slots to their own work. Defaults ship sane; everything but the cockpit is reassignable.
        </p>
      </div>

      {/* C — summoning sequence */}
      <div className="mt-14">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · C · summoning flow
        </div>
        <p className="mt-1 max-w-prose font-sans text-[12.5px] text-studio-ink-muted">
          Four frames. The operator binds tail to ⌘1 and canvas to ⌘5; presses both in sequence. The shell stays in place; the content swaps. (Design choice: a single shell with swapped content — the operator&apos;s spatial memory is for &quot;where the HUD lives,&quot; not &quot;which HUD is which.&quot;)
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SlotSummonFrame
            step="1"
            keypress={<SlotKeypressIdle />}
            caption="desktop is clean. The menu bar glyph is the only visible OpenScout presence."
            show="none"
          />
          <SlotSummonFrame
            step="2"
            keypress={<SlotKeycapCombo combo={["⌘", "1"]} />}
            caption="⌘1 summons the tail slot inside the HUD shell at the top-right."
            show="tail"
          />
          <SlotSummonFrame
            step="3"
            keypress={<SlotKeycapCombo combo={["⌘", "5"]} />}
            caption="⌘5 swaps content in the same shell — tail leaves, canvas takes its place. Shell stays put."
            show="canvas"
          />
          <SlotSummonFrame
            step="4"
            keypress={<SlotKeycapCombo combo={["⎋"]} />}
            caption="⎋ dismisses everything. Desktop returns to its baseline."
            show="none"
          />
        </div>
      </div>

      {/* D — editorial coda */}
      <p className="mx-auto mt-12 max-w-prose font-sans text-[13px] italic leading-relaxed text-studio-ink-muted">
        The leverage of the slot model: don&apos;t port studio surfaces to native, just slot them. The shell is small and well-tuned; the views inherit the studio design system; the cockpit stays as the one deeply-crafted native surface we iterate on. New slot? Wire it up in the registration panel; the shell handles the rest.
      </p>
    </section>
  );
}

// ── Slot card frame — HUD-shaped, glass treatment ───────────────────

function SlotCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <div className="mb-2 self-start font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {label}
      </div>
      <SlotShell>{children}</SlotShell>
    </div>
  );
}

function SlotShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative overflow-hidden rounded-[10px]"
      style={{
        width: SLOT_W,
        height: SLOT_H,
        background:
          "linear-gradient(135deg, var(--hud-base-top), var(--hud-base-bottom))",
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        border: "0.75px solid var(--hud-glass-stroke-soft)",
        boxShadow:
          "0 16px 36px -16px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05) inset",
      }}
    >
      {/* accent + specular + rim, matching the HUD chrome family */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.022) 0%, transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 26% 28%, rgba(255,255,255,0.08) 0%, transparent 56%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: 1.5,
          background:
            "linear-gradient(to right, transparent 0%, rgba(255,255,255,0.24) 28%, color-mix(in oklab, var(--hud-cyan) 24%, transparent) 50%, rgba(255,255,255,0.24) 72%, transparent 100%)",
        }}
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}

// ── Slot · Tail ────────────────────────────────────────────────────

function SlotTail() {
  const events = [
    { ago: "2s", agent: "Hudson", hue: HUES.Hudson, label: "drafted patch · password-reset", state: "working" as HudAgentState },
    { ago: "8s", agent: "Pike", hue: HUES.Pike, label: "pushed ease curve · HudCurves.ts", state: "working" as HudAgentState },
    { ago: "14s", agent: "Atlas", hue: HUES.Atlas, label: "icon-set v3 · 24 glyphs shipped", state: "done" as HudAgentState },
    { ago: "32s", agent: "Quill", hue: HUES.Quill, label: "rewrote spawn-lineage prose", state: "working" as HudAgentState },
    { ago: "47s", agent: "Hudson", hue: HUES.Hudson, label: "→ @drover · hand me the file", state: "working" as HudAgentState },
    { ago: "1m", agent: "Drover", hue: HUES.Drover, label: "needs operator · migration order", state: "needs-attention" as HudAgentState },
    { ago: "2m", agent: "Cobalt", hue: HUES.Cobalt, label: "quota retry → 90s backoff", state: "waiting" as HudAgentState },
    { ago: "4m", agent: "Cobalt", hue: HUES.Cobalt, label: "→ @operator · quota approval pending", state: "waiting" as HudAgentState },
    { ago: "7m", agent: "Pike", hue: HUES.Pike, label: "checkpoint · sheet motion review", state: "working" as HudAgentState },
    { ago: "11m", agent: "Quill", hue: HUES.Quill, label: "→ @hudson · quote permission?", state: "working" as HudAgentState },
    { ago: "16m", agent: "Atlas", hue: HUES.Atlas, label: "stripped SF Symbols leftovers", state: "done" as HudAgentState },
  ];
  return (
    <div className="flex h-full flex-col">
      <SlotHeader title="Tail" detail="recent · all agents" />
      <div className="flex-1 overflow-hidden px-2 py-1.5">
        {events.map((e, i) => {
          const isAttention = e.state === "needs-attention";
          const isDone = e.state === "done";
          const hue = `oklch(0.42 0.008 80)`;
          const stripe = isAttention ? "var(--hud-rose)" : hue;
          const glyphColor = isAttention
            ? "var(--hud-rose)"
            : isDone || e.state === "working"
              ? "var(--hud-cyan)"
              : "rgba(255,255,255,0.55)";
          return (
            <div key={i} className="flex items-baseline gap-1.5 py-[2px] pl-1.5"
              style={{ borderLeft: `1.5px solid ${stripe}` }}
            >
              <span className="font-mono text-[8.5px] tabular-nums text-studio-ink" style={{ opacity: 0.55, minWidth: 22 }}>
                {e.ago}
              </span>
              <span className="font-mono text-[9px] text-studio-ink" style={{ opacity: 0.92, minWidth: 44 }}>
                {e.agent}
              </span>
              <span className="truncate font-sans text-[9.5px] text-studio-ink" style={{ opacity: isAttention ? 1 : 0.78 }}>
                {e.label}
              </span>
              <span className="ml-auto shrink-0">
                <StatusGlyph state={e.state} color={glyphColor} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Slot · Fleet (dense grid) ───────────────────────────────────────

function SlotFleet() {
  // 12 chips arranged as a denser grid than the panel — agent identity at a glance.
  const fleet: HudAgent[] = [
    HUDSON, DROVER, PIKE, QUILL, ATLAS, COBALT,
    { ...HUDSON, id: "scout", name: "Scout", hue: HUES.Scout, state: "working", task: "watching tail" },
    { ...HUDSON, id: "qb", name: "QB", hue: HUES.QB, state: "working", task: "coordinating" },
    { ...HUDSON, id: "cody", name: "Cody", hue: HUES.Cody, state: "done", task: "tests green" },
    { ...HUDSON, id: "ranger", name: "Ranger", hue: HUES.Ranger, state: "waiting", task: "polling broker" },
    { ...HUDSON, id: "vox", name: "Vox", hue: HUES.Vox, state: "working", task: "transcribing" },
    { ...HUDSON, id: "vault", name: "Vault", hue: HUES.Vault, state: "waiting", task: "key rotation" },
  ];
  return (
    <div className="flex h-full flex-col">
      <SlotHeader title="Fleet" detail={`${fleet.length} agents`} />
      <div className="grid flex-1 grid-cols-2 gap-1.5 overflow-hidden px-2.5 py-2">
        {fleet.map((a) => {
          const isAttention = a.state === "needs-attention";
          const hue = `oklch(0.42 0.008 80)`;
          const stripe = isAttention ? "var(--hud-rose)" : hue;
          const glyphColor = isAttention
            ? "var(--hud-rose)"
            : a.state === "working" || a.state === "done"
              ? "var(--hud-cyan)"
              : "rgba(255,255,255,0.55)";
          return (
            <div
              key={a.id}
              className="relative flex items-center gap-1.5 rounded-[3px] px-2 py-1"
              style={{
                background: isAttention
                  ? "color-mix(in oklab, var(--hud-rose) 8%, var(--hud-glass-fill))"
                  : "var(--hud-glass-fill)",
                border: `0.75px solid ${isAttention ? "var(--hud-rose-soft)" : "var(--hud-glass-stroke-soft)"}`,
              }}
            >
              <span
                aria-hidden
                className="absolute left-0 top-0 h-full"
                style={{ width: 2, background: stripe }}
              />
              <StatusGlyph state={a.state} color={glyphColor} />
              <span className="truncate font-sans text-[10px] font-medium text-studio-ink">
                {a.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Slot · Mission (grouped at slot scale) ──────────────────────────

function SlotMission() {
  const groups = [
    { id: "auth", title: "Auth audit", count: 2, attention: false },
    { id: "migration", title: "Migration roll", count: 3, attention: true },
    { id: "landing", title: "Landing copy", count: 1, attention: false },
    { id: "docs", title: "Agent reference", count: 1, attention: false },
  ];
  return (
    <div className="flex h-full flex-col">
      <SlotHeader title="Mission" detail="4 active · 7 agents" />
      <div className="flex flex-1 flex-col gap-1.5 overflow-hidden px-2.5 py-2">
        {groups.map((g) => (
          <div
            key={g.id}
            className="flex items-center justify-between gap-2 rounded-[3px] px-2 py-1.5"
            style={{
              background: g.attention
                ? "color-mix(in oklab, var(--hud-rose) 6%, transparent)"
                : "rgba(255,255,255,0.025)",
              borderLeft: g.attention ? "2px solid var(--hud-rose)" : "2px solid rgba(255,255,255,0.10)",
            }}
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-sans text-[10.5px] font-medium text-studio-ink">
                {g.title}
              </span>
              <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
                {g.count} {g.count === 1 ? "agent" : "agents"}
              </span>
            </div>
            {g.attention ? (
              <span
                className="font-mono text-[8.5px] uppercase tracking-eyebrow"
                style={{ color: "var(--hud-rose)" }}
              >
                blocked on you
              </span>
            ) : (
              <Sparkline pulse={[0.4, 0.5, 0.6, 0.7, 0.5, 0.6, 0.7, 0.6, 0.8, 0.7, 0.6, 0.7]} color="rgba(255,255,255,0.55)" width={42} height={10} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Slot · Agent detail ─────────────────────────────────────────────

function SlotAgentDetail() {
  const turns = [
    { ago: "11s", text: "Walked the audit-trail emit calls across the four sign-in paths." },
    { ago: "8m", text: "Magic-link and SSO are clean; password reset is missing a reason field." },
    { ago: "22m", text: "Spawned — starting on the auth-mw audit you flagged this morning." },
  ];
  return (
    <div className="flex h-full flex-col">
      <SlotHeader title="Hudson" detail={`${HUDSON.role}`} />
      <div className="flex flex-1 flex-col gap-2 overflow-hidden px-2.5 py-2">
        <div
          className="grid gap-y-0.5 rounded-[3px] px-2 py-1"
          style={{
            gridTemplateColumns: "auto 1fr auto 1fr",
            background: "rgba(0,0,0,0.20)",
            border: "0.75px solid var(--hud-glass-stroke-soft)",
            columnGap: 8,
          }}
        >
          <StatKV k="runtime" v={HUDSON.runtime!} />
          <StatKV k="files" v={(HUDSON.files ?? 0).toString()} mono />
          <StatKV k="tokens" v={HUDSON.tokens!} mono />
          <StatKV k="model" v={HUDSON.model!} />
        </div>
        <div>
          <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            · recent turns
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {turns.map((t, i) => (
              <div key={i} className="flex items-baseline gap-1.5">
                <span className="font-mono text-[8.5px] tabular-nums text-studio-ink" style={{ opacity: 0.55, minWidth: 22 }}>
                  {t.ago}
                </span>
                <span
                  className="truncate font-sans text-[9.5px] italic text-studio-ink"
                  style={{ opacity: 0.85 }}
                >
                  “{t.text}”
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Slot · Canvas (spatial layout) ──────────────────────────────────

function SlotCanvas() {
  const nodes = [
    { id: "hudson", x: 0.22, y: 0.30, name: "Hud", hue: HUES.Hudson, state: "working" as HudAgentState },
    { id: "drover", x: 0.50, y: 0.62, name: "Dro", hue: HUES.Drover, state: "needs-attention" as HudAgentState },
    { id: "pike", x: 0.72, y: 0.28, name: "Pik", hue: HUES.Pike, state: "working" as HudAgentState },
    { id: "atlas", x: 0.34, y: 0.78, name: "Atl", hue: HUES.Atlas, state: "done" as HudAgentState },
    { id: "quill", x: 0.78, y: 0.62, name: "Qui", hue: HUES.Quill, state: "working" as HudAgentState },
  ];
  const W = SLOT_W - 16;
  const H = SLOT_H - 56;
  return (
    <div className="flex h-full flex-col">
      <SlotHeader title="Canvas" detail="spatial · 5 agents" />
      <div
        className="m-2 flex-1"
        style={{ background: "rgba(0,0,0,0.22)", border: "0.75px solid var(--hud-glass-stroke-soft)", borderRadius: 4 }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" aria-hidden>
          {/* connecting arcs between a couple of nodes */}
          {[
            { from: "hudson", to: "drover" },
            { from: "drover", to: "pike" },
            { from: "atlas", to: "quill" },
          ].map((e, i) => {
            const a = nodes.find((n) => n.id === e.from)!;
            const b = nodes.find((n) => n.id === e.to)!;
            const ax = a.x * W;
            const ay = a.y * H;
            const bx = b.x * W;
            const by = b.y * H;
            const mx = (ax + bx) / 2;
            const my = (ay + by) / 2 - 14;
            return (
              <path
                key={i}
                d={`M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`}
                fill="none"
                stroke="rgba(255,255,255,0.30)"
                strokeWidth={0.8}
              />
            );
          })}
          {nodes.map((n) => {
            const isAttention = n.state === "needs-attention";
            const hue = `oklch(0.42 0.008 80)`;
            const fill = isAttention ? "color-mix(in oklab, var(--hud-rose) 22%, rgb(8,10,14))" : "rgb(12,14,18)";
            const stroke = isAttention ? "var(--hud-rose)" : hue;
            return (
              <g key={n.id}>
                <circle cx={n.x * W} cy={n.y * H} r={14} fill={fill} stroke={stroke} strokeWidth={1.1} />
                <text
                  x={n.x * W}
                  y={n.y * H + 3}
                  fontSize={9}
                  fill={isAttention ? "var(--hud-rose)" : "rgba(255,255,255,0.92)"}
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  fontWeight={600}
                  textAnchor="middle"
                >
                  {n.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ── Slot · Brief in-flight ──────────────────────────────────────────

function SlotBriefInFlight() {
  return (
    <div className="flex h-full flex-col">
      <SlotHeader title="Brief" detail="in-flight · auth-mw audit" />
      <div className="flex flex-1 flex-col gap-2 overflow-hidden px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[8.5px] uppercase tracking-eyebrow" style={{ color: "var(--hud-cyan)" }}>
            · in flight · 14m
          </span>
          <span className="ml-auto font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.55 }}>
            Hudson
          </span>
        </div>
        <p className="font-sans text-[11px] font-medium leading-snug text-studio-ink">
          Audit the auth middleware for SOC 2 trail completeness.
        </p>
        <p
          className="font-sans text-[10px] italic leading-snug text-studio-ink"
          style={{ opacity: 0.78 }}
        >
          Walk the four sign-in paths, confirm every failure branch emits a
          structured event with a <span className="font-mono text-[9.5px]">reason</span> field,
          and patch any gaps before merge.
        </p>
        <div className="mt-1 flex flex-col gap-0.5">
          <SlotBriefBullet label="paths walked" status="ok" detail="4 / 4" />
          <SlotBriefBullet label="failure events" status="ok" detail="3 / 4 clean" />
          <SlotBriefBullet label="gap" status="open" detail="password-reset · missing reason" />
          <SlotBriefBullet label="patch" status="pending" detail="drafting" />
        </div>
      </div>
    </div>
  );
}

function SlotBriefBullet({
  label,
  status,
  detail,
}: {
  label: string;
  status: "ok" | "open" | "pending";
  detail: string;
}) {
  const color =
    status === "ok"
      ? "var(--hud-cyan)"
      : status === "open"
        ? "var(--hud-rose)"
        : "rgba(255,255,255,0.55)";
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        aria-hidden
        className="block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
      <span className="ml-auto font-sans text-[9.5px] text-studio-ink" style={{ opacity: 0.82 }}>
        {detail}
      </span>
    </div>
  );
}

function SlotHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      className="flex items-center justify-between px-3"
      style={{
        height: 24,
        borderBottom: "1px solid var(--hud-glass-stroke-soft)",
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <span className="font-display text-[11px] text-studio-ink">{title}</span>
      <span className="font-mono text-[9px] tabular-nums text-studio-ink" style={{ opacity: 0.62 }}>
        {detail}
      </span>
    </div>
  );
}

// ── Hotkey registration table ───────────────────────────────────────

function SlotHotkeyTable() {
  const rows: Array<{ chord: ReactNode; binding: string; locked?: boolean; current?: boolean }> = [
    {
      chord: <SlotKeycapCombo combo={["⌃", "⌥", "⇧", "⌘", "A"]} />,
      binding: "always-on assistant",
      locked: true,
    },
    { chord: <SlotKeycapCombo combo={["⌘", "1"]} />, binding: "tail", current: true },
    { chord: <SlotKeycapCombo combo={["⌘", "2"]} />, binding: "fleet" },
    { chord: <SlotKeycapCombo combo={["⌘", "3"]} />, binding: "mission" },
    { chord: <SlotKeycapCombo combo={["⌘", "4"]} />, binding: "agent · Hudson" },
    { chord: <SlotKeycapCombo combo={["⌘", "5"]} />, binding: "canvas" },
    { chord: <SlotKeycapCombo combo={["⌘", "6"]} />, binding: "brief in-flight" },
  ];
  return (
    <div
      className="rounded-[10px] border border-studio-edge px-5 py-4"
      style={{ background: "var(--studio-canvas-alt)", width: 540 }}
    >
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · settings · HUD shortcuts
        </span>
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {rows.length - 1} editable · 1 locked
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-[5px] border border-studio-edge px-3 py-2"
            style={{ background: "var(--studio-canvas)" }}
          >
            <div className="shrink-0">{r.chord}</div>
            <span className="flex-1 font-sans text-[12px] text-studio-ink">
              {r.binding}
            </span>
            {r.locked ? (
              <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
                built-in · not editable
              </span>
            ) : (
              <span className="flex items-center gap-1 font-mono text-[9.5px] text-studio-ink-faint">
                <span style={{ opacity: r.current ? 1 : 0.7 }}>{r.current ? "current" : "default"}</span>
                <SlotDropdownGlyph />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SlotDropdownGlyph() {
  return (
    <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden>
      <path d="M2 3.5 L4.5 6 L7 3.5" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function SlotKeycapCombo({ combo }: { combo: string[] }) {
  return (
    <div className="flex items-center gap-[3px]">
      {combo.map((k, i) => (
        <span
          key={i}
          className="inline-grid h-[20px] min-w-[20px] place-items-center rounded-[3px] border border-studio-edge px-1 font-mono text-[10px] text-studio-ink"
          style={{
            background: "var(--studio-canvas)",
            boxShadow: "0 1px 0 var(--studio-edge), 0 2px 0 var(--studio-canvas-alt)",
          }}
        >
          {k}
        </span>
      ))}
    </div>
  );
}

// ── Summoning sequence frames ───────────────────────────────────────

function SlotKeypressIdle() {
  return (
    <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
      idle
    </span>
  );
}

function SlotSummonFrame({
  step,
  keypress,
  caption,
  show,
}: {
  step: string;
  keypress: ReactNode;
  caption: string;
  show: "none" | "tail" | "canvas";
}) {
  const W = 320;
  const H = 200;
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · step {step}
        </span>
        {keypress}
      </div>
      <div
        className="relative mt-2 overflow-hidden rounded-[6px] border border-studio-edge"
        style={{
          width: W,
          height: H,
          background:
            "linear-gradient(135deg, oklch(0.16 0.018 250) 0%, oklch(0.11 0.015 280) 100%)",
        }}
      >
        {/* mini menu bar */}
        <div
          className="absolute inset-x-0 top-0 flex items-center justify-end px-2"
          style={{
            height: 14,
            background: "rgba(20, 22, 28, 0.85)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <MenuBarOpenScoutGlyph />
        </div>

        {/* The HUD shell — empty when "none", with slot content when "tail" or "canvas" */}
        {show !== "none" ? (
          <div
            className="absolute"
            style={{
              right: 8,
              top: 20,
              width: 150,
              height: 120,
              borderRadius: 6,
              background: "linear-gradient(135deg, var(--hud-base-top), var(--hud-base-bottom))",
              border: "0.75px solid var(--hud-glass-stroke-soft)",
              boxShadow: "0 6px 18px -6px rgba(0,0,0,0.5)",
              overflow: "hidden",
            }}
          >
            {/* top rim */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0"
              style={{
                height: 1,
                background: "linear-gradient(to right, transparent, rgba(255,255,255,0.4), transparent)",
              }}
            />
            {/* slot label */}
            <div
              className="flex h-3.5 items-center px-1.5"
              style={{ background: "rgba(0,0,0,0.20)", borderBottom: "1px solid var(--hud-glass-stroke-soft)" }}
            >
              <span className="font-mono text-[7.5px] uppercase tracking-eyebrow text-studio-ink-faint">
                · {show}
              </span>
            </div>
            {/* mini content */}
            {show === "tail" ? <MiniTailContent /> : <MiniCanvasContent />}
          </div>
        ) : null}
      </div>
      <p className="mt-2 font-sans text-[11.5px] italic leading-relaxed text-studio-ink-faint">
        {caption}
      </p>
    </div>
  );
}

function MiniTailContent() {
  const rows = [
    { hue: HUES.Hudson, attention: false },
    { hue: HUES.Pike, attention: false },
    { hue: HUES.Drover, attention: true },
    { hue: HUES.Atlas, attention: false },
    { hue: HUES.Quill, attention: false },
    { hue: HUES.Cobalt, attention: false },
  ];
  return (
    <div className="flex flex-col gap-[2px] px-1.5 py-1">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1">
          <span
            aria-hidden
            className="block h-2 w-[1.5px]"
            style={{ background: r.attention ? "var(--hud-rose)" : `oklch(0.42 0.008 80)` }}
          />
          <span
            aria-hidden
            className="block h-1 flex-1 rounded-[1px]"
            style={{
              background: r.attention ? "color-mix(in oklab, var(--hud-rose) 50%, transparent)" : "rgba(255,255,255,0.22)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function MiniCanvasContent() {
  // Three small nodes with thin connector lines, suggesting the canvas layout.
  return (
    <svg viewBox="0 0 150 100" className="block h-full w-full" aria-hidden>
      <path d="M 30 30 Q 60 10 90 35" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.6} />
      <path d="M 90 35 Q 110 55 75 75" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.6} />
      <circle cx={30} cy={30} r={7} fill="rgb(12,14,18)" stroke={`oklch(0.42 0.008 80)`} strokeWidth={1} />
      <circle cx={90} cy={35} r={7} fill="rgb(12,14,18)" stroke={`oklch(0.42 0.008 80)`} strokeWidth={1} />
      <circle cx={75} cy={75} r={7} fill="color-mix(in oklab, var(--hud-rose) 22%, rgb(8,10,14))" stroke="var(--hud-rose)" strokeWidth={1} />
    </svg>
  );
}
