"use client";

/**
 * Operator Brief & Handoff — study.
 *
 * QuickSteer is the in-flight micro-moment. This study zooms out from
 * that moment to the whole arc of a tasking:
 *
 *   1. Brief        — the kickoff document. What the operator hands
 *                     over (goal, boundaries, success criteria, refs,
 *                     latitude). Render as a document, not a form.
 *   2. Cadence      — four stations on a left-to-right cadence axis,
 *                     passing glance → ambient → structured → full
 *                     intervene. Different surface per cadence — not
 *                     one design with toggles.
 *   3. Debrief      — what the agent hands back at the end. Decided,
 *                     tried, discarded, open, recommended, trail. The
 *                     operator's first read after time away.
 *   4. Continuity   — short coda. Brief, mid-flight signal, debrief
 *                     are pieces of one document that grows.
 *
 * The brief and debrief are reading surfaces. Editorial discipline —
 * type rhythm, line length, hierarchy — matters more here than chrome
 * decoration. Treat them like documents.
 */

import {
  ActionCluster,
  DEFAULT_STEER_ACTIONS,
  STEER_GLASS_PANEL,
  type SteerAction,
} from "@/components/QuickSteer";
import {
  TickerSlotCard,
  tickerSlotWidth,
  type TickerEvent,
} from "@/components/Ticker";
import type { CSSProperties } from "react";

// ── The example task we render through the whole arc ───────────────────
//
// One brief, one in-flight signal, one debrief — same task, same agent,
// shown at three points in time. The handle/hue stays consistent across
// every surface so the continuity coda lands.

const TASK = {
  id: "task-0214",
  agent: "hudson",
  agentHue: 210,
  filed: "2026-05-24 · 09:14 PT",
  handBack: "2026-05-24 · 14:38 PT",
  duration: "5h 24m",
  title: "Audit our auth middleware for compliance gaps",
} as const;

// ── Page ───────────────────────────────────────────────────────────────

export default function OperatorBriefPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <Eyebrow />

      <h1 className="mt-1 font-display text-[32px] font-medium leading-none tracking-tight text-studio-ink">
        Operator brief &amp; handoff
      </h1>

      <p className="mt-3 max-w-prose font-sans text-[13.5px] leading-relaxed text-studio-ink-faint">
        The full lifecycle from the operator&apos;s side. There&apos;s a
        kickoff <em>brief</em>, a <em>check-in</em> cadence that runs the
        whole time the agent is out, and a <em>debrief</em> that arrives
        back at the end. QuickSteer (the chip cluster on a hovered ticker
        slot) lives inside the middle of all of this — it&apos;s the
        ambient end of the cadence. This study zooms out to the
        surrounding document.
      </p>
      <p className="mt-2 max-w-prose font-sans text-[12px] leading-relaxed text-studio-ink-faint" style={{ opacity: 0.8 }}>
        Composing one: <a href="/studies/brief-author" className="text-studio-ink underline decoration-studio-edge-strong underline-offset-4 hover:decoration-[color:var(--scout-accent)]">/studies/brief-author</a>.
      </p>

      {/* ── 1. Brief ───────────────────────────────────────────────── */}
      <SectionTitle hint="The kickoff artifact, fully composed" className="mt-12">
        The brief
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        Not the prompt field. The mental model of the document an operator
        hands over. Goal, boundaries, success, references, latitude —
        re-readable by the operator, referable by the agent.
      </p>
      <div className="mt-5">
        <BriefDocument />
      </div>

      {/* ── 2. Cadence spectrum ──────────────────────────────────── */}
      <SectionTitle
        hint="Four stations, left → right, each a different surface"
        className="mt-16"
      >
        Check-in spectrum
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        Mid-flight contact is not one thing with a verbosity knob —
        it&apos;s four different surfaces at four different cadences.
        Passing glance lives in your peripheral vision; ambient lives in
        the chrome; structured is a panel you open; intervene takes the
        wheel. Each is shown side by side so the design reads as a
        spectrum, not a stack.
      </p>
      <div className="mt-6">
        <CadenceSpectrum />
      </div>
      <div className="mt-6">
        <CadenceLegend />
      </div>

      {/* ── 3. Debrief ─────────────────────────────────────────── */}
      <SectionTitle
        hint="What lands in your inbox at hand-back"
        className="mt-16"
      >
        The debrief
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        Not a diff dump. A document the operator can read first thing in
        the morning — what was decided and why, what was tried and
        discarded, what&apos;s still open, what the agent learned. The
        agent&apos;s side of the same document the brief opened.
      </p>
      <div className="mt-5">
        <DebriefDocument />
      </div>

      {/* ── 4. Continuity coda ─────────────────────────────────── */}
      <SectionTitle hint="Brief + cadence + debrief are one document" className="mt-16">
        The thread of continuity
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        The brief opens the file. The check-ins are annotations stitched
        in along the way. The debrief closes the file. From a distance
        it&apos;s one growing artifact, not three separate documents.
      </p>
      <div className="mt-6">
        <ContinuityStrip />
      </div>

      {/* ── 5. How to read ──────────────────────────────────────── */}
      <section className="mt-16 max-w-prose border-t border-studio-edge pt-6">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · how to read this study
        </div>
        <p className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          Every surface is rendered statically at full opacity from the
          production primitives where it makes sense (
          <code className="font-mono text-[11px] text-studio-ink">
            TickerSlotCard
          </code>{" "}
          and{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            ActionCluster
          </code>{" "}
          for the ambient end of the cadence spectrum) and as new
          single-page React for the brief, debrief, and the structured /
          intervene panels — these don&apos;t exist in shipping code yet,
          so this study is the canonical reference. To feel the live
          micro-moment, go to{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            /studies/ticker-interactions
          </code>
          .
        </p>
      </section>
    </main>
  );
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ 1. BRIEF                                                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

function BriefDocument() {
  return (
    <article className="mx-auto max-w-[760px] rounded-md border border-studio-edge bg-studio-surface px-9 py-8 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.4)]">
      {/* Document masthead — looks like a sheet of paper, not a card */}
      <header className="border-b border-studio-edge pb-5">
        <div className="flex items-baseline justify-between gap-4 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          <span>brief · {TASK.id}</span>
          <span>filed {TASK.filed}</span>
        </div>
        <h2 className="mt-2 font-display text-[28px] font-medium leading-[1.1] tracking-tight text-studio-ink">
          {TASK.title}
        </h2>
        <div className="mt-3 flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
          <span>
            for{" "}
            <AgentHandle name={TASK.agent} hue={TASK.agentHue} />
          </span>
          <Dot />
          <span>from @arach</span>
          <Dot />
          <span>latitude · medium</span>
        </div>
      </header>

      {/* Goal — narrative, not bullets. Brief = document. */}
      <BriefField label="Goal">
        <p className="m-0 font-sans text-[14px] leading-[1.65] text-studio-ink">
          Walk the auth middleware end-to-end and surface every place
          we&apos;re out of step with SOC 2 controls — token rotation,
          session expiry, audit log gaps, anything that would fail a
          November review. Not a fix. A read of where we stand and what
          the gaps cost.
        </p>
      </BriefField>

      {/* Boundaries — the lane lines */}
      <BriefField label="Boundaries">
        <ul className="m-0 list-none space-y-1.5 p-0 font-sans text-[13px] leading-relaxed text-studio-ink">
          <BoundaryLine kind="in">
            <code className="font-mono text-[12px] text-studio-ink">
              packages/web/server/auth/
            </code>{" "}
            and everything it imports.
          </BoundaryLine>
          <BoundaryLine kind="in">
            Read-only review of{" "}
            <code className="font-mono text-[12px] text-studio-ink">
              packages/runtime/session/
            </code>
            .
          </BoundaryLine>
          <BoundaryLine kind="out">
            Don&apos;t touch the OAuth client — that&apos;s @vault&apos;s lane.
          </BoundaryLine>
          <BoundaryLine kind="out">
            Don&apos;t open PRs. Findings only.
          </BoundaryLine>
        </ul>
      </BriefField>

      {/* Success criteria */}
      <BriefField label="Success">
        <ol className="m-0 list-decimal space-y-2 pl-5 font-sans text-[13px] leading-relaxed text-studio-ink marker:font-mono marker:text-[10px] marker:text-studio-ink-faint">
          <li>
            A list of every gap, ranked: blocker · meaningful · cosmetic.
          </li>
          <li>
            For each gap: where it lives, why it matters, what the fix
            shape looks like.
          </li>
          <li>
            One paragraph at the top a non-engineer (the auditor) can
            read.
          </li>
        </ol>
      </BriefField>

      {/* References — facts only, in mono */}
      <BriefField label="References">
        <ul className="m-0 list-none space-y-1 p-0 font-mono text-[11.5px] leading-snug text-studio-ink">
          <ReferenceLine>docs/eng/0014-auth-rewrite.md</ReferenceLine>
          <ReferenceLine>
            plans/2026-Q1-soc2-prep.md{" "}
            <span className="text-studio-ink-faint">· prior work</span>
          </ReferenceLine>
          <ReferenceLine>
            #scout-security{" "}
            <span className="text-studio-ink-faint">
              · ask @arach if blocked on policy questions
            </span>
          </ReferenceLine>
        </ul>
      </BriefField>

      {/* Latitude — what's autonomous vs. ask-back */}
      <BriefField label="Latitude">
        <LatitudeStrip />
      </BriefField>

      {/* Foot of the document */}
      <footer className="mt-7 border-t border-studio-edge pt-4 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span>countersigned · </span>
        <AgentHandle name={TASK.agent} hue={TASK.agentHue} />
        <Dot />
        <span>est. 4–6h</span>
        <Dot />
        <span>
          next check-in{" "}
          <span className="text-studio-ink">11:00 PT</span>
        </span>
      </footer>
    </article>
  );
}

function BriefField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {label}
      </h3>
      {children}
    </section>
  );
}

function BoundaryLine({
  kind,
  children,
}: {
  kind: "in" | "out";
  children: React.ReactNode;
}) {
  // In = thin solid mark in OK fg. Out = same mark in error fg.
  // No backgrounds, no rounded chips — keep the page reading like text.
  const color = kind === "in" ? "var(--status-ok-fg)" : "var(--status-error-fg)";
  const label = kind === "in" ? "in" : "out";
  return (
    <li className="flex items-baseline gap-3">
      <span
        aria-hidden
        className="grid h-4 w-6 shrink-0 place-items-center font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
        style={{
          color,
          borderLeft: `2px solid ${color}`,
          paddingLeft: 4,
        }}
      >
        {label}
      </span>
      <span className="flex-1">{children}</span>
    </li>
  );
}

function ReferenceLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2">
      <span
        aria-hidden
        className="font-mono text-[10px] text-studio-ink-faint"
        style={{ opacity: 0.7 }}
      >
        ›
      </span>
      {children}
    </li>
  );
}

/** Latitude strip — five marks on a line, axis-style, with the dial
 *  set somewhere in the middle. Reads as "how much can you decide
 *  alone". The two captions on either end frame the meaning. */
function LatitudeStrip() {
  const stops = [
    { label: "ask first", x: 0 },
    { label: "ask if surprised", x: 1 },
    { label: "decide & log", x: 2 },
    { label: "decide & summarize", x: 3 },
    { label: "full autonomy", x: 4 },
  ];
  // Current dial: "decide & log" — the middle position
  const dial = 2;
  return (
    <div>
      <div className="relative pb-7 pt-2">
        {/* base line */}
        <div className="absolute left-0 right-0 top-[14px] h-px bg-studio-edge" />
        <div className="relative flex justify-between">
          {stops.map((s) => {
            const active = s.x === dial;
            return (
              <div
                key={s.label}
                className="relative flex flex-col items-center"
                style={{ width: 0 }}
              >
                <span
                  aria-hidden
                  className="relative z-10 block rounded-full"
                  style={{
                    width: active ? 11 : 6,
                    height: active ? 11 : 6,
                    marginTop: active ? -3 : 0,
                    background: active
                      ? "var(--scout-accent)"
                      : "var(--studio-edge-strong)",
                    boxShadow: active
                      ? "0 0 0 3px color-mix(in oklab, var(--scout-accent) 22%, transparent)"
                      : "none",
                  }}
                />
                <span
                  className="absolute top-5 whitespace-nowrap font-mono text-[9px] uppercase tracking-eyebrow"
                  style={{
                    color: active ? "var(--studio-ink)" : "var(--studio-ink-faint)",
                  }}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-2 font-sans text-[12px] italic leading-relaxed text-studio-ink-faint">
        You can decide on findings ranking and surface them in your debrief.
        Anything that touches policy interpretation (what counts as a SOC 2
        violation vs. a recommendation), ask @arach in #scout-security
        before continuing.
      </p>
    </div>
  );
}

function AgentHandle({ name, hue }: { name: string; hue: number }) {
  return (
    <span
      className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink"
      style={{
        // Tiny coloured leading dot so the handle is always identifiable.
        background: `linear-gradient(90deg, oklch(0.74 0.15 ${hue}) 0 6px, transparent 6px)`,
        paddingLeft: 10,
      }}
    >
      @{name}
    </span>
  );
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ 2. CADENCE SPECTRUM                                                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

function CadenceSpectrum() {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-6">
      {/* Axis */}
      <CadenceAxis />

      {/* Four stations */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-4">
        <CadenceStation
          number={1}
          name="Passing glance"
          sub="you're walking past"
          beats={["peripheral", "no read", "<1s"]}
        >
          <PassingGlance />
        </CadenceStation>
        <CadenceStation
          number={2}
          name="Ambient check-in"
          sub="you stop and look"
          beats={["chrome strip", "single line", "~3s"]}
        >
          <AmbientCheckIn />
        </CadenceStation>
        <CadenceStation
          number={3}
          name="Structured pause"
          sub="you want to inspect"
          beats={["panel", "working state", "~30s"]}
        >
          <StructuredPause />
        </CadenceStation>
        <CadenceStation
          number={4}
          name="Full intervene"
          sub="you take the wheel"
          beats={["modal", "redirect surface", "minutes"]}
        >
          <FullIntervene />
        </CadenceStation>
      </div>
    </div>
  );
}

function CadenceAxis() {
  return (
    <div className="relative">
      {/* The line */}
      <div className="relative h-px w-full bg-studio-edge" />
      {/* Tick marks */}
      <div className="relative -mt-px flex justify-between">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            aria-hidden
            className="block h-2 w-px"
            style={{ background: "var(--studio-edge-strong)" }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span>← less attention</span>
        <span>more attention →</span>
      </div>
    </div>
  );
}

function CadenceStation({
  number,
  name,
  sub,
  beats,
  children,
}: {
  number: number;
  name: string;
  sub: string;
  beats: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[9px]"
          style={{
            borderColor: "var(--studio-edge-strong)",
            color: "var(--studio-ink-faint)",
          }}
        >
          {number}
        </span>
        <div className="font-mono text-[11px] uppercase tracking-eyebrow text-studio-ink">
          {name}
        </div>
      </div>
      <div className="mt-0.5 pl-7 font-mono text-[9.5px] italic text-studio-ink-faint">
        {sub}
      </div>

      {/* Specimen */}
      <div className="mt-4 flex min-h-[240px] items-start justify-center rounded-sm border border-studio-edge bg-studio-canvas p-4">
        {children}
      </div>

      {/* Beats — three mono words underneath */}
      <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-2 gap-y-0.5 p-0 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {beats.map((b, i) => (
          <li key={b} className="flex items-baseline gap-2">
            {i > 0 ? <Dot /> : null}
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Station 1 · Passing glance ───────────────────────────────────────
//
// What you see out of the corner of your eye while doing something
// else. Just the agent's hue, alive. No labels you have to read.

function PassingGlance() {
  return (
    <div className="flex flex-col items-center gap-3 self-center">
      {/* A pair of pulsing dots, one per active agent in your fleet.
       *  The point: presence + colour, no language. */}
      <div className="flex items-center gap-4">
        <PulseDot hue={TASK.agentHue} delay={0} />
        <PulseDot hue={125} delay={0.4} />
        <PulseDot hue={25} delay={0.8} />
      </div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        three lights, three lanes
      </div>
      <div className="mt-1 font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint" style={{ opacity: 0.7 }}>
        lives in: corner of HUD
      </div>
    </div>
  );
}

function PulseDot({ hue, delay }: { hue: number; delay: number }) {
  const color = `oklch(0.74 0.15 ${hue})`;
  return (
    <span className="relative inline-flex h-3 w-3 items-center justify-center">
      <style>{`
        @keyframes ob-pulse-${hue} {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.15); }
        }
      `}</style>
      <span
        aria-hidden
        className="block h-3 w-3 rounded-full"
        style={{
          background: color,
          animation: `ob-pulse-${hue} 2.4s ease-in-out infinite`,
          animationDelay: `${delay}s`,
        }}
      />
    </span>
  );
}

// ── Station 2 · Ambient check-in ────────────────────────────────────
//
// You stopped. Now you want a one-line read on what the agent's doing.
// This is the ticker slot — the surface QuickSteer wraps.

function AmbientCheckIn() {
  const evt: TickerEvent = {
    id: "amb",
    agent: TASK.agent,
    agentHue: TASK.agentHue,
    kind: "work",
    label: "auth middleware · scanning session expiry",
    time: "11:04",
  };
  const actions: SteerAction[] = DEFAULT_STEER_ACTIONS.work;
  return (
    <div className="flex flex-col items-center gap-4 self-center">
      <div className="relative pt-12">
        <ClusterKeyframes id="amb" />
        <div
          className="rounded-md border border-studio-edge bg-studio-canvas-alt"
          style={{ width: tickerSlotWidth(evt.kind) }}
        >
          <TickerSlotCard evt={evt} />
        </div>
        <ActionCluster
          actions={actions}
          color={`oklch(0.74 0.15 ${evt.agentHue})`}
          keyframeId="amb"
          onChipClick={() => {}}
        />
      </div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        slot in the chrome strip
      </div>
      <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint" style={{ opacity: 0.7 }}>
        lives in: HUD telegraph
      </div>
    </div>
  );
}

// ── Station 3 · Structured pause ────────────────────────────────────
//
// You want the working state. What the agent has built up in its head,
// the trail behind it, what it's about to do next. Not a debrief —
// a snapshot of work-in-progress.

function StructuredPause() {
  return (
    <div className="w-full self-stretch">
      <div className="rounded-md border border-studio-edge bg-studio-surface">
        {/* Sheet header */}
        <header className="flex items-baseline justify-between gap-3 border-b border-studio-edge px-3 py-2">
          <div className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-eyebrow">
            <AgentHandle name={TASK.agent} hue={TASK.agentHue} />
            <span className="text-studio-ink-faint">· working state</span>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            2h 13m in
          </span>
        </header>

        {/* Body */}
        <div className="space-y-3 px-3 py-3">
          {/* Now */}
          <Block label="Now">
            <p className="m-0 font-sans text-[12px] leading-snug text-studio-ink">
              Reading{" "}
              <code className="font-mono text-[11px]">session.ts</code> to
              map every place we extend session lifetime.
            </p>
          </Block>

          {/* Trail */}
          <Block label="Trail">
            <ul className="m-0 list-none space-y-1 p-0 font-mono text-[10.5px] text-studio-ink">
              <TrailItem>
                ✓ Mapped 14 entry points into{" "}
                <span className="text-studio-ink-faint">auth/</span>
              </TrailItem>
              <TrailItem>
                ✓ Found 3 places token TTL is hard-coded
              </TrailItem>
              <TrailItem>
                · Reading <span className="text-studio-ink-faint">session.ts</span>
              </TrailItem>
              <TrailItem dim>
                ○ Next: walk the audit-log writer
              </TrailItem>
            </ul>
          </Block>

          {/* Open questions — the only place the agent flags it needs the operator */}
          <Block label="Open">
            <ul className="m-0 list-none space-y-1 p-0 font-sans text-[12px] leading-snug text-studio-ink">
              <li className="flex items-baseline gap-2">
                <span
                  aria-hidden
                  className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full font-mono text-[8.5px]"
                  style={{
                    background: "var(--status-warn-bg)",
                    color: "var(--status-warn-fg)",
                  }}
                >
                  ?
                </span>
                Is &ldquo;30-day refresh token&rdquo; SOC 2 OK if rotated?
              </li>
            </ul>
          </Block>
        </div>
      </div>
      <div className="mt-3 text-center font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        inspector sheet
      </div>
      <div className="text-center font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint" style={{ opacity: 0.7 }}>
        lives in: right rail or modal
      </div>
    </div>
  );
}

function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {label}
      </div>
      {children}
    </div>
  );
}

function TrailItem({
  children,
  dim,
}: {
  children: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <li style={dim ? { opacity: 0.55 } : undefined}>
      {children}
    </li>
  );
}

// ── Station 4 · Full intervene ──────────────────────────────────────
//
// You're taking the wheel. The agent exposes what it's about to do +
// the levers to redirect it. This is the only station where the
// operator commits a destructive action.

function FullIntervene() {
  return (
    <div className="w-full self-stretch">
      <div
        className="rounded-md border"
        style={{
          ...STEER_GLASS_PANEL,
          borderColor: "var(--scout-accent)",
        }}
      >
        <header
          className="flex items-baseline justify-between gap-3 border-b px-3 py-2"
          style={{ borderColor: "var(--studio-edge)" }}
        >
          <div className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink">
            <span style={{ color: "var(--scout-accent)" }}>● steering</span>
            <span className="text-studio-ink-faint">·</span>
            <AgentHandle name={TASK.agent} hue={TASK.agentHue} />
          </div>
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            paused
          </span>
        </header>

        <div className="space-y-3 px-3 py-3">
          {/* What the agent was about to do */}
          <div>
            <div className="mb-1 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              · about to
            </div>
            <p className="m-0 font-sans text-[12px] leading-snug text-studio-ink">
              Open <code className="font-mono text-[11px]">audit/writer.ts</code>{" "}
              and trace the log gap.
            </p>
          </div>

          {/* Redirect — three lanes */}
          <div>
            <div className="mb-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              · redirect
            </div>
            <div className="space-y-1.5">
              <RedirectLane
                kind="continue"
                label="Continue"
                detail="proceed as planned"
              />
              <RedirectLane
                kind="amend"
                label="Amend goal"
                detail="add: also check refresh-token entropy"
              />
              <RedirectLane
                kind="abort"
                label="Abort"
                detail="stop the run, return what you have"
              />
            </div>
          </div>

          {/* The intervention message — text the operator types */}
          <div>
            <div className="mb-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              · note to agent
            </div>
            <div
              className="rounded-sm border px-2 py-1.5 font-sans text-[12px] italic leading-relaxed text-studio-ink"
              style={{
                borderColor: "var(--studio-edge)",
                background: "var(--studio-canvas)",
              }}
            >
              Refresh-token entropy came up in the last security review —
              add it.
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 text-center font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        glass overlay, agent halted
      </div>
      <div className="text-center font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint" style={{ opacity: 0.7 }}>
        lives in: centred modal
      </div>
    </div>
  );
}

function RedirectLane({
  kind,
  label,
  detail,
}: {
  kind: "continue" | "amend" | "abort";
  label: string;
  detail: string;
}) {
  const tint =
    kind === "continue"
      ? "var(--status-ok-fg)"
      : kind === "amend"
        ? "var(--scout-accent)"
        : "var(--status-error-fg)";
  // The "amend" lane is shown as the picked one — that's why the
  // intervention message below has a refresh-token note.
  const picked = kind === "amend";
  return (
    <div
      className="flex items-baseline gap-2.5 rounded-sm border px-2 py-1.5"
      style={{
        borderColor: picked ? tint : "var(--studio-edge)",
        background: picked
          ? "color-mix(in oklab, " + tint + " 8%, transparent)"
          : "transparent",
      }}
    >
      <span
        aria-hidden
        className="block h-2 w-2 shrink-0 rounded-full"
        style={{ background: tint, opacity: picked ? 1 : 0.45 }}
      />
      <span
        className="font-mono text-[10.5px] uppercase tracking-eyebrow"
        style={{ color: picked ? "var(--studio-ink)" : "var(--studio-ink-faint)" }}
      >
        {label}
      </span>
      <span className="font-sans text-[11.5px] italic text-studio-ink-faint">
        {detail}
      </span>
    </div>
  );
}

function CadenceLegend() {
  return (
    <div
      className="max-w-prose rounded-sm border-l-2 pl-4"
      style={{ borderColor: "var(--studio-edge-strong)" }}
    >
      <p className="m-0 font-sans text-[12.5px] italic leading-relaxed text-studio-ink-faint">
        The same agent, same task, four surfaces. The operator&apos;s
        cost of attention climbs left to right; the agent&apos;s
        willingness to be interrupted climbs the same way. Station 4 is
        the only one that halts work — the other three are observation.
      </p>
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ 3. DEBRIEF                                                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

function DebriefDocument() {
  return (
    <article className="mx-auto max-w-[760px] rounded-md border border-studio-edge bg-studio-surface px-9 py-8 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.4)]">
      {/* Header — mirrors the brief masthead, with a small "unread"
       *  marker in the warm accent so the operator's eye lands on it. */}
      <header className="border-b border-studio-edge pb-5">
        <div className="flex items-baseline justify-between gap-4 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          <span className="flex items-baseline gap-2">
            <UnreadDot />
            debrief · {TASK.id}
          </span>
          <span>handed back {TASK.handBack}</span>
        </div>
        <h2 className="mt-2 font-display text-[28px] font-medium leading-[1.1] tracking-tight text-studio-ink">
          {TASK.title}
        </h2>
        <div className="mt-3 flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
          <span>
            from{" "}
            <AgentHandle name={TASK.agent} hue={TASK.agentHue} />
          </span>
          <Dot />
          <span>to @arach</span>
          <Dot />
          <span>
            took <span className="text-studio-ink">{TASK.duration}</span>
          </span>
        </div>
      </header>

      {/* The lede — written for the auditor, per the brief */}
      <BriefField label="Lede">
        <p className="m-0 font-sans text-[14.5px] italic leading-[1.65] text-studio-ink">
          The middleware is largely sound. Three blockers — token rotation
          (15-minute drift), audit-log gaps around session refresh, and a
          legacy bypass header still wired into the dev path. Six smaller
          findings, none of which fail an audit on their own. Refresh-token
          entropy (per your mid-flight note) is fine, sourced from
          <code className="font-mono text-[12px] not-italic"> crypto.randomBytes</code>.
        </p>
      </BriefField>

      {/* What was decided */}
      <BriefField label="Decided">
        <ul className="m-0 list-none space-y-2 p-0 font-sans text-[13px] leading-relaxed text-studio-ink">
          <DecidedLine
            verb="ranked"
            body="3 blockers, 4 meaningful, 2 cosmetic — see below."
          />
          <DecidedLine
            verb="adopted"
            body="OWASP ASVS L2 as the implicit bar for &lsquo;meaningful vs cosmetic&rsquo;."
            why="the SOC 2 controls don't define severity; you told me to rank."
          />
          <DecidedLine
            verb="excluded"
            body="the OAuth client, per the boundary."
          />
        </ul>
      </BriefField>

      {/* Tried & discarded */}
      <BriefField label="Tried &amp; discarded">
        <ul className="m-0 list-none space-y-2 p-0 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          <DiscardedLine
            tried="Diffing against the November 2024 audit findings"
            why="couldn't match line numbers post-refactor; switched to mapping by symbol name."
          />
          <DiscardedLine
            tried="Running our existing session-fuzzer over the dev branch"
            why="@vault owns it and the boundary said hands off — flagged as a follow-up instead."
          />
        </ul>
      </BriefField>

      {/* Findings — the actual deliverable, ranked */}
      <BriefField label="Findings">
        <ol className="m-0 list-none space-y-3 p-0">
          <Finding
            severity="blocker"
            title="Refresh tokens never rotate within a single session window."
            where="auth/session.ts:142"
            cost="Audit fail (CC6.1)."
            fix="Rotate on every successful refresh; ~30 lines."
          />
          <Finding
            severity="blocker"
            title="Session-refresh path skips the audit-log writer."
            where="auth/refresh.ts:88"
            cost="Audit fail (CC7.2)."
            fix="One missing call to logAudit; trivial."
          />
          <Finding
            severity="blocker"
            title="`X-Dev-Bypass-Auth` header still honoured in `next.config.mjs`."
            where="next.config.mjs:24"
            cost="Audit fail outright; also a real risk."
            fix="Delete the block; verify no remaining call sites in prod."
          />
          <Finding
            severity="meaningful"
            title="Token TTL is hard-coded in three places."
            where="auth/{session,refresh,api}.ts"
            fix="Consolidate behind a single `TTL` export."
          />
        </ol>
      </BriefField>

      {/* Open */}
      <BriefField label="Open">
        <ul className="m-0 list-none space-y-1.5 p-0 font-sans text-[13px] leading-relaxed text-studio-ink">
          <li className="flex items-baseline gap-2">
            <OpenDot />
            <span>
              Is &ldquo;decide &amp; log&rdquo; latitude enough to also
              write the patches, or do you want findings only? (Brief said
              findings; I held the line.)
            </span>
          </li>
          <li className="flex items-baseline gap-2">
            <OpenDot />
            <span>
              The fuzzer follow-up — should @vault pick it up, or queue
              me again next week?
            </span>
          </li>
        </ul>
      </BriefField>

      {/* What the agent learned */}
      <BriefField label="Learned">
        <p className="m-0 font-sans text-[13px] italic leading-relaxed text-studio-ink-faint">
          The audit-log writer pattern shows up four times; worth pulling
          into a single middleware. Not in scope for this brief, but I
          left a note in{" "}
          <code className="font-mono text-[11.5px] not-italic">docs/eng/0014</code>.
        </p>
      </BriefField>

      {/* Recommended next */}
      <BriefField label="Recommended next">
        <ol className="m-0 list-decimal space-y-1 pl-5 font-sans text-[13px] leading-relaxed text-studio-ink marker:font-mono marker:text-[10px] marker:text-studio-ink-faint">
          <li>Open three PRs against the blockers (1–2 days, @hudson).</li>
          <li>
            Schedule a 30-min walk-through with the auditor before the
            November date.
          </li>
          <li>
            Decide on the audit-middleware extraction — separate brief.
          </li>
        </ol>
      </BriefField>

      {/* Footer — the audit trail */}
      <footer className="mt-7 border-t border-studio-edge pt-4">
        <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          · audit trail
        </div>
        <ul className="m-0 mt-2 list-none space-y-1 p-0 font-mono text-[10.5px] text-studio-ink">
          <TrailLine time="09:14" what="brief countersigned" />
          <TrailLine time="11:00" what="check-in 1 · ambient · no operator action" />
          <TrailLine
            time="12:08"
            what="intervene · refresh-token entropy added to scope"
            warm
          />
          <TrailLine time="13:32" what="check-in 2 · structured · operator inspected" />
          <TrailLine time="14:38" what="handed back" warm />
        </ul>
      </footer>
    </article>
  );
}

function UnreadDot() {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: "var(--scout-accent)" }}
    />
  );
}

function DecidedLine({
  verb,
  body,
  why,
}: {
  verb: string;
  body: React.ReactNode;
  why?: React.ReactNode;
}) {
  return (
    <li className="flex items-baseline gap-3">
      <span
        aria-hidden
        className="shrink-0 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint"
        style={{
          width: 76,
          textAlign: "right",
        }}
      >
        {verb}
      </span>
      <div className="flex-1">
        <span>{body}</span>
        {why ? (
          <span className="ml-1 font-sans text-[12px] italic text-studio-ink-faint">
            — {why}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function DiscardedLine({
  tried,
  why,
}: {
  tried: React.ReactNode;
  why: React.ReactNode;
}) {
  return (
    <li className="flex items-baseline gap-3">
      <span
        aria-hidden
        className="shrink-0 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint"
        style={{ width: 76, textAlign: "right", opacity: 0.7 }}
      >
        tried
      </span>
      <div className="flex-1">
        <span className="text-studio-ink-faint" style={{ textDecoration: "line-through", textDecorationColor: "var(--studio-edge-strong)" }}>
          {tried}
        </span>
        <span className="ml-1 font-sans text-[12px] not-italic text-studio-ink-faint">
          — {why}
        </span>
      </div>
    </li>
  );
}

function Finding({
  severity,
  title,
  where,
  cost,
  fix,
}: {
  severity: "blocker" | "meaningful" | "cosmetic";
  title: string;
  where: string;
  cost?: string;
  fix: string;
}) {
  const tint =
    severity === "blocker"
      ? "var(--status-error-fg)"
      : severity === "meaningful"
        ? "var(--status-warn-fg)"
        : "var(--status-neutral-fg)";
  return (
    <li className="list-none">
      <div className="flex items-baseline gap-3">
        <span
          aria-hidden
          className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-eyebrow"
          style={{
            width: 76,
            textAlign: "right",
            color: tint,
          }}
        >
          {severity}
        </span>
        <div className="flex-1">
          <div className="font-sans text-[13.5px] leading-snug text-studio-ink">
            {title}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-studio-ink-faint">
            <code className="text-studio-ink">{where}</code>
            {cost ? (
              <>
                <Dot />
                <span>{cost}</span>
              </>
            ) : null}
          </div>
          <div className="mt-0.5 font-sans text-[12px] italic leading-snug text-studio-ink-faint">
            fix: <span className="not-italic text-studio-ink">{fix}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

function OpenDot() {
  return (
    <span
      aria-hidden
      className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full font-mono text-[8.5px]"
      style={{
        background: "var(--status-warn-bg)",
        color: "var(--status-warn-fg)",
      }}
    >
      ?
    </span>
  );
}

function TrailLine({
  time,
  what,
  warm,
}: {
  time: string;
  what: string;
  warm?: boolean;
}) {
  return (
    <li className="flex items-baseline gap-3">
      <span
        className="shrink-0 text-studio-ink-faint"
        style={{ width: 48 }}
      >
        {time}
      </span>
      <span
        aria-hidden
        className="block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: warm ? "var(--scout-accent)" : "var(--studio-edge-strong)",
        }}
      />
      <span className={warm ? "text-studio-ink" : "text-studio-ink-faint"}>
        {what}
      </span>
    </li>
  );
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ 4. CONTINUITY STRIP                                                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

function ContinuityStrip() {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-7">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_44px_1fr_44px_1fr]">
        <ContinuityPage label="brief" time={TASK.filed.split("·")[1].trim()}>
          <ContinuitySheet
            kicker="goal · boundaries · success"
            body="Audit auth middleware for SOC 2 gaps. Findings only. Latitude: decide & log."
            countersigned
          />
        </ContinuityPage>

        <ContinuityArrow />

        <ContinuityPage label="annotations" time="mid-flight">
          <ContinuitySheet
            kicker="check-ins · intervene · trail"
            body="11:00 ambient · 12:08 intervene — added refresh-token entropy · 13:32 inspected"
            annotated
          />
        </ContinuityPage>

        <ContinuityArrow />

        <ContinuityPage label="debrief" time={TASK.handBack.split("·")[1].trim()}>
          <ContinuitySheet
            kicker="decided · tried · open · trail"
            body="3 blockers, 4 meaningful. Entropy fine. Two questions open. Trail attached."
            sealed
          />
        </ContinuityPage>
      </div>

      <p className="mt-7 max-w-prose font-sans text-[12px] italic leading-relaxed text-studio-ink-faint">
        Same document, three timestamps. The brief opens the file; the
        check-ins write in the margins; the debrief closes it. The audit
        trail at the foot of the debrief is the same row of beats that
        the cadence spectrum spreads out across the middle of the arc.
      </p>
    </div>
  );
}

function ContinuityPage({
  label,
  time,
  children,
}: {
  label: string;
  time: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-baseline justify-between font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span>{label}</span>
        <span>{time}</span>
      </div>
      {children}
    </div>
  );
}

function ContinuityArrow() {
  return (
    <div className="hidden items-start justify-center pt-12 lg:flex">
      <svg width={32} height={10} aria-hidden>
        <line x1={0} y1={5} x2={24} y2={5} stroke="var(--studio-ink-faint)" strokeWidth={1} opacity={0.6} />
        <path d="M24 1 L30 5 L24 9" stroke="var(--studio-ink-faint)" strokeWidth={1} fill="none" opacity={0.6} />
      </svg>
    </div>
  );
}

/** A small, document-shaped sheet used in the continuity strip.
 *  The three modifiers (`countersigned`, `annotated`, `sealed`) give
 *  each sheet a different micro-mark so they read as the same document
 *  at three points in its life. */
function ContinuitySheet({
  kicker,
  body,
  countersigned,
  annotated,
  sealed,
}: {
  kicker: string;
  body: string;
  countersigned?: boolean;
  annotated?: boolean;
  sealed?: boolean;
}) {
  const markStyle: CSSProperties = sealed
    ? {
        background: "var(--scout-accent)",
        color: "var(--studio-canvas)",
      }
    : countersigned
      ? {
          background: "var(--status-ok-fg)",
          color: "var(--studio-canvas)",
        }
      : {
          background: "var(--status-info-fg)",
          color: "var(--studio-canvas)",
        };
  const markLabel = sealed ? "✓" : countersigned ? "✓" : "+";
  return (
    <div
      className="relative rounded-sm border border-studio-edge bg-studio-surface px-4 py-4"
      style={{
        boxShadow:
          "0 4px 18px -8px rgba(0,0,0,0.35), 0 1px 0 0 var(--studio-edge) inset",
      }}
    >
      {/* Document body */}
      <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        · {kicker}
      </div>
      <p className="mt-2 mb-0 font-sans text-[12px] leading-snug text-studio-ink">
        {body}
      </p>

      {/* Annotation marks — only on the middle sheet */}
      {annotated ? (
        <div className="mt-3 space-y-1">
          <AnnotationLine />
          <AnnotationLine indent />
          <AnnotationLine />
        </div>
      ) : null}

      {/* Lower-right stamp */}
      <span
        aria-hidden
        className="absolute bottom-2 right-2 grid h-5 w-5 place-items-center rounded-full font-mono text-[10px] font-semibold"
        style={markStyle}
      >
        {markLabel}
      </span>
    </div>
  );
}

function AnnotationLine({ indent }: { indent?: boolean }) {
  return (
    <div
      className="flex items-center gap-1.5"
      style={{ paddingLeft: indent ? 10 : 0 }}
    >
      <span
        aria-hidden
        className="block h-1 w-1 rounded-full"
        style={{ background: "var(--scout-accent)", opacity: 0.7 }}
      />
      <span
        aria-hidden
        className="block h-px flex-1"
        style={{ background: "var(--studio-edge-strong)", opacity: 0.7 }}
      />
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║ SHARED                                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

function Eyebrow() {
  return (
    <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
      · studies · web · operator-brief
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="mx-1.5 text-studio-ink-faint">
      ·
    </span>
  );
}

function SectionTitle({
  children,
  hint,
  className = "",
}: {
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline gap-3 ${className}`}>
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {children}
      </div>
      {hint ? (
        <div className="font-mono text-[10px] text-studio-ink-faint">
          {hint}
        </div>
      ) : null}
      <div className="ml-3 h-px flex-1 bg-studio-edge" />
    </div>
  );
}

/** ActionCluster references a `qs-chip-in-${id}` keyframe normally
 *  injected by QuickSteer's `<style>` block. Outside QuickSteer (here,
 *  in Station 2's static specimen) we inject it ourselves. */
function ClusterKeyframes({ id }: { id: string }) {
  return (
    <style>{`
      @keyframes qs-chip-in-${id} {
        from { opacity: 0; transform: translateX(-50%) translateY(3px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `}</style>
  );
}
