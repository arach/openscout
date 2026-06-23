/**
 * Arrangements — static study.
 *
 * The structural companion to /studies/choreography. Choreography reads
 * the fleet as a SCORE — agents-as-voices laid out in time. This study
 * reads the fleet as a SCHEMATIC — agents-as-nodes wired into a
 * topology. No time axis. No motion review-time. Just frozen
 * arrangements at full opacity, so the operator can read structure
 * the way an EE reads a circuit.
 *
 * The visual idiom is BLUEPRINT / CIRCUIT:
 *   • nodes        agents (named pad, hand-rolled SVG glyph)
 *   • edges        handoffs (orthogonal traces, never bezier)
 *   • bus          parallel dispatch lines (one trigger → many)
 *   • commit pad   the slot that decides / outputs / ships
 *   • trigger      the warm element — one per arrangement, scout-accent
 *
 * Why circuit and not score / constellation / blueprint-pure?
 *   • score is already taken by the original choreography study
 *   • a constellation has no implied direction-of-flow
 *   • a pure blueprint (architectural) doesn't carry signal flow
 *   • a schematic does both — labeled pads, traced signals, a clear
 *     read of "what fires what"
 *
 * Conventions used to dodge the studio's known footguns:
 *   • no /N opacity on studio-* tokens (broken under Turbopack+TW3.4);
 *     use inline opacity or pre-tuned tokens
 *   • no divide-* on studio-edge — use [&>*+*]:border-t
 *   • dividers via border-studio-edge, never white-with-alpha
 *   • SVG glyphs are hand-drawn; the topology IS the design
 */

import type { ReactNode } from "react";

// ── Shared geometry / vocabulary ─────────────────────────────────────

const SLOT_W = 96;
const SLOT_H = 28;
const NODE_R = 5.5;
const STROKE = 1.25;
const WARM = "var(--scout-accent)";
const EDGE = "var(--studio-edge-strong)";
const EDGE_FAINT = "var(--studio-edge)";
const INK = "var(--studio-ink)";
const INK_MUTED = "var(--studio-ink-muted)";
const INK_FAINT = "var(--studio-ink-faint)";

// Reusable agent hue table — kept consistent with the choreography study.
const HUE = {
  scout: 125,
  hudson: 210,
  qb: 25,
  cody: 85,
  ranger: 295,
  vox: 340,
  atlas: 175,
  vault: 250,
} as const;

function agentColor(name: keyof typeof HUE, alpha = 1) {
  return `oklch(0.74 0.15 ${HUE[name]} / ${alpha})`;
}

// ── Page ─────────────────────────────────────────────────────────────

export default function ArrangementsPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · choreography · arrangements
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Arrangements
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The structural companion to{" "}
          <a
            href="/studies/choreography"
            className="text-studio-ink underline decoration-studio-edge-strong underline-offset-4 hover:decoration-[color:var(--scout-accent)]"
          >
            Choreography
          </a>
          . That study reads the fleet as a <em>score</em> — agents-as-voices in
          time. This one reads the fleet as a <em>schematic</em> — agents-as-pads
          wired into a topology. No time axis. The shape of the wiring is the
          subject. Pick an arrangement and you&apos;ve picked an answer to{" "}
          <span className="text-studio-ink">
            who consults whom, who decides, who ships
          </span>
          .
        </p>
      </header>

      <Legend />

      <SectionTitle hint="Four patterns, four topologies, same vocabulary">
        The arrangement gallery
      </SectionTitle>
      <Gallery />

      <SectionTitle
        hint="Reading a single arrangement, part by part"
        className="mt-16"
      >
        Anatomy of an arrangement
      </SectionTitle>
      <Anatomy />

      <SectionTitle
        hint="How an operator writes one — three stages, blueprint metaphor"
        className="mt-16"
      >
        Composing
      </SectionTitle>
      <Composing />

      <SectionTitle
        hint="What the operator sees once an arrangement is running"
        className="mt-16"
      >
        In-flight readout
      </SectionTitle>
      <InFlight />

      <section className="mt-16 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · why this exists
        </div>
        <p className="font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Today an operator who wants to{" "}
          <span className="text-studio-ink">
            &ldquo;have Hudson and Cody both consult on this, then let QB
            decide&rdquo;
          </span>{" "}
          has no way to write that down — no <em>structural</em> noun for the
          arrangement, only a transcript of messages after the fact. This study
          proposes a small visual grammar — four named topologies, a shared
          set of pads and traces — so the arrangement becomes a first-class
          object you can author, name, save, and re-fire. The mock pads are
          shaped like what a real{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            arrangements_dispatch
          </code>{" "}
          payload would carry.
        </p>
      </section>
    </main>
  );
}

// ── Legend ───────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] text-studio-ink-faint">
      <LegendItem
        sample={
          <svg width={22} height={12} aria-hidden>
            <circle cx={6} cy={6} r={3.4} fill={WARM} />
          </svg>
        }
        label="trigger — the one warm pad"
      />
      <LegendItem
        sample={
          <svg width={22} height={12} aria-hidden>
            <rect
              x={2}
              y={2}
              width={18}
              height={8}
              rx={1.5}
              fill="none"
              stroke={INK_MUTED}
              strokeWidth={STROKE}
            />
          </svg>
        }
        label="agent slot"
      />
      <LegendItem
        sample={
          <svg width={28} height={12} aria-hidden>
            <path
              d="M2 6 H26"
              stroke={INK_MUTED}
              strokeWidth={STROKE}
              fill="none"
            />
            <path
              d="M22 3 L26 6 L22 9"
              stroke={INK_MUTED}
              strokeWidth={STROKE}
              fill="none"
              strokeLinejoin="miter"
            />
          </svg>
        }
        label="handoff (orthogonal trace)"
      />
      <LegendItem
        sample={
          <svg width={28} height={12} aria-hidden>
            <rect
              x={2}
              y={2}
              width={24}
              height={8}
              fill="none"
              stroke={INK_MUTED}
              strokeWidth={STROKE}
              strokeDasharray="2 2"
            />
          </svg>
        }
        label="commit pad — output / decision"
      />
      <LegendItem
        sample={
          <svg width={28} height={12} aria-hidden>
            <path
              d="M2 6 H26"
              stroke={INK_MUTED}
              strokeWidth={2.4}
              fill="none"
            />
          </svg>
        }
        label="bus (parallel dispatch)"
      />
    </div>
  );
}

function LegendItem({
  sample,
  label,
}: {
  sample: ReactNode;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {sample}
      <span>{label}</span>
    </span>
  );
}

// ── Section title — matches ticker-interactions / choreography ──────

function SectionTitle({
  children,
  hint,
  className = "",
}: {
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline gap-3 ${className}`}>
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {children}
      </div>
      {hint ? (
        <div className="font-mono text-[10px] text-studio-ink-faint">{hint}</div>
      ) : null}
      <div className="ml-3 h-px flex-1 bg-studio-edge" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Primitive: AgentPad
// A single named slot on the schematic. The pad is the rectangle; the
// node dot in the agent's hue is the pin where traces attach. The label
// sits inside. The shape variant flips it to a "commit pad" (dashed,
// wider) which is the visual noun for "decider / output / shipper".
// ─────────────────────────────────────────────────────────────────────

interface AgentPadProps {
  x: number;
  y: number;
  agent?: keyof typeof HUE;
  /** Label override (defaults to capitalized agent name). */
  label?: string;
  /** "commit" makes the pad dashed + slightly wider — the slot that
   *  decides / outputs / ships. */
  shape?: "slot" | "commit";
  /** Active = the slot in-flight is currently here (used in In-Flight). */
  active?: boolean;
  /** State badge — small tag in the bottom-right of the pad. */
  state?: "waiting" | "active" | "done" | "skipped";
  /** Treat as the trigger — fills the pad in the warm accent. */
  trigger?: boolean;
  /** Width override (commit pads are wider by default). */
  w?: number;
}

function AgentPad({
  x,
  y,
  agent,
  label,
  shape = "slot",
  active,
  state,
  trigger,
  w,
}: AgentPadProps) {
  const width = w ?? (shape === "commit" ? SLOT_W + 12 : SLOT_W);
  const dashed = shape === "commit";
  const stroke = trigger
    ? WARM
    : active
      ? WARM
      : EDGE;
  const fill = trigger
    ? "color-mix(in oklab, var(--scout-accent) 22%, transparent)"
    : "var(--studio-canvas-alt)";
  const ink = trigger ? WARM : INK;
  const displayLabel = label ?? (agent ? cap(agent) : "—");
  const subColor = agent ? agentColor(agent, 1) : INK_FAINT;
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Pad body */}
      <rect
        x={-width / 2}
        y={-SLOT_H / 2}
        width={width}
        height={SLOT_H}
        rx={2}
        fill={fill}
        stroke={stroke}
        strokeWidth={trigger || active ? 1.6 : STROKE}
        strokeDasharray={dashed ? "3 3" : undefined}
      />
      {/* Left pin — the visual "where the wire connects" */}
      <circle
        cx={-width / 2}
        cy={0}
        r={NODE_R / 2}
        fill={subColor}
      />
      {/* Right pin */}
      <circle
        cx={width / 2}
        cy={0}
        r={NODE_R / 2}
        fill={subColor}
      />
      {/* Label */}
      <text
        x={-width / 2 + 10}
        y={3.5}
        fontSize={10.5}
        fontFamily="JetBrains Mono, ui-monospace"
        fill={ink}
        letterSpacing="0.02em"
      >
        {displayLabel}
      </text>
      {/* State tag */}
      {state ? (
        <g transform={`translate(${width / 2 - 4} ${SLOT_H / 2 - 4})`}>
          <text
            x={0}
            y={0}
            fontSize={7.5}
            fontFamily="JetBrains Mono, ui-monospace"
            fill={
              state === "active"
                ? WARM
                : state === "done"
                  ? "var(--status-ok-fg)"
                  : state === "skipped"
                    ? INK_FAINT
                    : INK_MUTED
            }
            textAnchor="end"
            letterSpacing="0.12em"
          >
            {state.toUpperCase()}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────
// Primitive: OrthoTrace
// Hand-rolled orthogonal connector. Two-bend "Z" path; never diagonal.
// This is what gives the study its blueprint feel — wires turn at
// right angles, not in arcs.
// ─────────────────────────────────────────────────────────────────────

interface TraceProps {
  from: [number, number];
  to: [number, number];
  /** Stroke color override (defaults to faint edge). */
  stroke?: string;
  /** Stroke width override. */
  width?: number;
  /** Where to put the elbow as a fraction of the run (0..1). */
  elbow?: number;
  /** Render an arrowhead at the destination. */
  arrow?: boolean;
  /** Dashed for "advisory / inbound consult", solid for committed flow. */
  dashed?: boolean;
}

function OrthoTrace({
  from,
  to,
  stroke = EDGE,
  width = STROKE,
  elbow = 0.5,
  arrow = true,
  dashed = false,
}: TraceProps) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const midX = x1 + (x2 - x1) * elbow;
  const d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dashed ? "3 3" : undefined}
      />
      {arrow ? <Arrowhead x={x2} y={y2} stroke={stroke} /> : null}
    </g>
  );
}

function Arrowhead({
  x,
  y,
  stroke,
}: {
  x: number;
  y: number;
  stroke: string;
}) {
  return (
    <path
      d={`M ${x - 4} ${y - 3} L ${x} ${y} L ${x - 4} ${y + 3}`}
      fill="none"
      stroke={stroke}
      strokeWidth={STROKE}
      strokeLinejoin="miter"
      strokeLinecap="butt"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Primitive: Bus
// Heavy horizontal line — the visual noun for "parallel dispatch".
// Used in fan-out and quorum arrangements.
// ─────────────────────────────────────────────────────────────────────

function Bus({
  x1,
  x2,
  y,
  stroke = EDGE,
  width = 2.4,
}: {
  x1: number;
  x2: number;
  y: number;
  stroke?: string;
  width?: number;
}) {
  return (
    <line
      x1={x1}
      x2={x2}
      y1={y}
      y2={y}
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="butt"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Primitive: DiagramFrame
// Card chrome for one arrangement. Title strip on top, schematic
// below. Kept deliberately quiet — chrome should never compete with
// the topology inside.
// ─────────────────────────────────────────────────────────────────────

function DiagramFrame({
  name,
  caption,
  width,
  height,
  children,
}: {
  name: string;
  caption: string;
  width: number;
  height: number;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-md border border-studio-edge bg-studio-canvas-alt">
      <div className="flex items-baseline justify-between border-b border-studio-edge px-3 py-2">
        <div className="font-mono text-[10.5px] uppercase tracking-eyebrow text-studio-ink">
          {name}
        </div>
        <div className="font-mono text-[9.5px] text-studio-ink-faint">
          {caption}
        </div>
      </div>
      <div className="flex-1 p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="block w-full"
          role="img"
          aria-label={`${name} arrangement schematic`}
        >
          {children}
        </svg>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 1 — Gallery
// Four patterns, side by side. Same visual vocabulary, very different
// topologies. Each fits in a ~360×220 viewBox so the four can sit in a
// 2×2 grid without horizontal scroll on a typical studio width.
// ─────────────────────────────────────────────────────────────────────

function Gallery() {
  return (
    <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
      <DiagramFrame
        name="Consult"
        caption="advisory in, decider commits"
        width={360}
        height={220}
      >
        <ConsultDiagram />
      </DiagramFrame>
      <DiagramFrame
        name="Fan-out"
        caption="one trigger, N parallel"
        width={360}
        height={220}
      >
        <FanOutDiagram />
      </DiagramFrame>
      <DiagramFrame
        name="Pipeline"
        caption="sequential, baton handed"
        width={360}
        height={220}
      >
        <PipelineDiagram />
      </DiagramFrame>
      <DiagramFrame
        name="Quorum"
        caption="N converge, majority commits"
        width={360}
        height={220}
      >
        <QuorumDiagram />
      </DiagramFrame>
    </div>
  );
}

// ── Consult — advisor pads feed sideways into a decider commit pad ──
function ConsultDiagram() {
  // Trigger left, two consultants stacked middle, decider commit right.
  const TRIG_X = 64;
  const ADV_X = 184;
  const DEC_X = 304;
  const T_Y = 110;
  const A1_Y = 70;
  const A2_Y = 150;
  return (
    <g>
      <AgentPad x={TRIG_X} y={T_Y} label="Trigger" trigger />
      <AgentPad x={ADV_X} y={A1_Y} agent="hudson" />
      <AgentPad x={ADV_X} y={A2_Y} agent="cody" />
      <AgentPad x={DEC_X} y={T_Y} agent="qb" shape="commit" />
      {/* Trigger → both consultants */}
      <OrthoTrace
        from={[TRIG_X + SLOT_W / 2, T_Y]}
        to={[ADV_X - SLOT_W / 2, A1_Y]}
        elbow={0.5}
      />
      <OrthoTrace
        from={[TRIG_X + SLOT_W / 2, T_Y]}
        to={[ADV_X - SLOT_W / 2, A2_Y]}
        elbow={0.5}
      />
      {/* Consultants → decider (dashed: advisory) */}
      <OrthoTrace
        from={[ADV_X + SLOT_W / 2, A1_Y]}
        to={[DEC_X - (SLOT_W + 12) / 2, T_Y]}
        elbow={0.5}
        dashed
      />
      <OrthoTrace
        from={[ADV_X + SLOT_W / 2, A2_Y]}
        to={[DEC_X - (SLOT_W + 12) / 2, T_Y]}
        elbow={0.5}
        dashed
      />
      {/* Tags */}
      <RoleTag x={ADV_X} y={A1_Y - 28} label="advisor" />
      <RoleTag x={ADV_X} y={A2_Y + 28} label="advisor" />
      <RoleTag x={DEC_X} y={T_Y + 32} label="decider" />
    </g>
  );
}

// ── Fan-out — trigger → bus → N workers in parallel ─────────────────
function FanOutDiagram() {
  const TRIG_X = 64;
  const BUS_X = 178;
  const WORKER_X = 290;
  const T_Y = 110;
  const WORKER_YS = [50, 90, 130, 170];
  return (
    <g>
      <AgentPad x={TRIG_X} y={T_Y} label="Trigger" trigger />
      {/* Bus — vertical heavy line */}
      <line
        x1={BUS_X}
        x2={BUS_X}
        y1={WORKER_YS[0] - 6}
        y2={WORKER_YS[WORKER_YS.length - 1] + 6}
        stroke={EDGE}
        strokeWidth={2.4}
      />
      {/* Trigger → bus */}
      <line
        x1={TRIG_X + SLOT_W / 2}
        x2={BUS_X}
        y1={T_Y}
        y2={T_Y}
        stroke={EDGE}
        strokeWidth={STROKE}
      />
      {/* Bus tap dots */}
      {WORKER_YS.map((y) => (
        <circle key={`tap-${y}`} cx={BUS_X} cy={y} r={2.2} fill={EDGE} />
      ))}
      {/* Bus → workers */}
      {WORKER_YS.map((y) => (
        <g key={`w-${y}`}>
          <OrthoTrace
            from={[BUS_X, y]}
            to={[WORKER_X - SLOT_W / 2, y]}
            elbow={0.6}
          />
        </g>
      ))}
      <AgentPad x={WORKER_X} y={WORKER_YS[0]} agent="scout" />
      <AgentPad x={WORKER_X} y={WORKER_YS[1]} agent="hudson" />
      <AgentPad x={WORKER_X} y={WORKER_YS[2]} agent="cody" />
      <AgentPad x={WORKER_X} y={WORKER_YS[3]} agent="atlas" />
      {/* Tag */}
      <text
        x={BUS_X + 8}
        y={WORKER_YS[0] - 14}
        fontSize={8.5}
        fontFamily="JetBrains Mono, ui-monospace"
        fill={INK_FAINT}
        letterSpacing="0.14em"
      >
        BUS
      </text>
    </g>
  );
}

// ── Pipeline — sequential handoff with baton glyph ───────────────────
function PipelineDiagram() {
  const Y = 110;
  const XS = [44, 130, 216, 302];
  return (
    <g>
      <AgentPad x={XS[0]} y={Y} agent="scout" label="Scout" trigger />
      <AgentPad x={XS[1]} y={Y} agent="hudson" />
      <AgentPad x={XS[2]} y={Y} agent="qb" />
      <AgentPad x={XS[3]} y={Y} agent="cody" shape="commit" />
      {/* Connectors with baton-glyph at midpoint */}
      {XS.slice(0, -1).map((x, i) => {
        const nextX = XS[i + 1];
        const startX = x + (i === XS.length - 2 ? SLOT_W / 2 : SLOT_W / 2);
        const endX =
          nextX - (i + 1 === XS.length - 1 ? (SLOT_W + 12) / 2 : SLOT_W / 2);
        const mid = (startX + endX) / 2;
        return (
          <g key={`p-${i}`}>
            <line
              x1={startX}
              x2={endX}
              y1={Y}
              y2={Y}
              stroke={EDGE}
              strokeWidth={STROKE}
            />
            <Arrowhead x={endX} y={Y} stroke={EDGE} />
            {/* Baton glyph — tiny chevron over the line */}
            <g transform={`translate(${mid} ${Y - 10})`}>
              <path
                d="M -4 4 L 0 -2 L 4 4"
                fill="none"
                stroke={INK_FAINT}
                strokeWidth={1}
                strokeLinejoin="miter"
              />
            </g>
          </g>
        );
      })}
      <RoleTag x={XS[0]} y={Y + 30} label="kickoff" />
      <RoleTag x={XS[XS.length - 1]} y={Y + 30} label="shipper" />
    </g>
  );
}

// ── Quorum — fan-out + converge into a single commit pad ────────────
function QuorumDiagram() {
  const TRIG_X = 60;
  const PEER_X = 180;
  const COMMIT_X = 304;
  const T_Y = 110;
  const PEER_YS = [60, 110, 160];
  return (
    <g>
      <AgentPad x={TRIG_X} y={T_Y} label="Trigger" trigger />
      <AgentPad x={PEER_X} y={PEER_YS[0]} agent="scout" />
      <AgentPad x={PEER_X} y={PEER_YS[1]} agent="hudson" />
      <AgentPad x={PEER_X} y={PEER_YS[2]} agent="cody" />
      <AgentPad
        x={COMMIT_X}
        y={T_Y}
        label="3-of-3"
        shape="commit"
      />
      {/* Trigger → peers */}
      {PEER_YS.map((y) => (
        <OrthoTrace
          key={`tp-${y}`}
          from={[TRIG_X + SLOT_W / 2, T_Y]}
          to={[PEER_X - SLOT_W / 2, y]}
          elbow={0.5}
        />
      ))}
      {/* Peers → commit (votes) */}
      {PEER_YS.map((y) => (
        <OrthoTrace
          key={`pc-${y}`}
          from={[PEER_X + SLOT_W / 2, y]}
          to={[COMMIT_X - (SLOT_W + 12) / 2, T_Y]}
          elbow={0.5}
        />
      ))}
      <RoleTag x={COMMIT_X} y={T_Y + 32} label="quorum" />
    </g>
  );
}

function RoleTag({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <text
      x={x}
      y={y}
      fontSize={8}
      fontFamily="JetBrains Mono, ui-monospace"
      fill={INK_FAINT}
      textAnchor="middle"
      letterSpacing="0.14em"
    >
      {label.toUpperCase()}
    </text>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 2 — Anatomy
// Take the Consult pattern (the most interesting of the four because it
// has a real role split: trigger / advisor / handoff / decider /
// output) and label every part. SVG on the left, dl on the right.
// ─────────────────────────────────────────────────────────────────────

function Anatomy() {
  // Same layout as ConsultDiagram, scaled up, with letter callouts.
  const W = 720;
  const H = 320;
  const TRIG_X = 100;
  const ADV_X = 340;
  const DEC_X = 600;
  const OUT_X = 600;
  const T_Y = 170;
  const A1_Y = 90;
  const A2_Y = 250;
  const callout = (letter: string, cx: number, cy: number) => (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={9}
        fill="var(--studio-canvas)"
        stroke={WARM}
        strokeWidth={1.2}
      />
      <text
        x={cx}
        y={cy + 3}
        fontSize={9.5}
        fontFamily="JetBrains Mono, ui-monospace"
        fill={WARM}
        textAnchor="middle"
        fontWeight={600}
      >
        {letter}
      </text>
    </g>
  );
  return (
    <div className="mt-5 grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_minmax(280px,420px)]">
      <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full"
          role="img"
          aria-label="Anatomy of a consult arrangement"
        >
          {/* Pads */}
          <AgentPad x={TRIG_X} y={T_Y} label="Trigger" trigger />
          <AgentPad x={ADV_X} y={A1_Y} agent="hudson" />
          <AgentPad x={ADV_X} y={A2_Y} agent="cody" />
          <AgentPad x={DEC_X} y={T_Y} agent="qb" shape="commit" />
          {/* Traces */}
          <OrthoTrace
            from={[TRIG_X + SLOT_W / 2, T_Y]}
            to={[ADV_X - SLOT_W / 2, A1_Y]}
          />
          <OrthoTrace
            from={[TRIG_X + SLOT_W / 2, T_Y]}
            to={[ADV_X - SLOT_W / 2, A2_Y]}
          />
          <OrthoTrace
            from={[ADV_X + SLOT_W / 2, A1_Y]}
            to={[DEC_X - (SLOT_W + 12) / 2, T_Y]}
            dashed
          />
          <OrthoTrace
            from={[ADV_X + SLOT_W / 2, A2_Y]}
            to={[DEC_X - (SLOT_W + 12) / 2, T_Y]}
            dashed
          />
          {/* Output rail leaving the decider pad */}
          <line
            x1={OUT_X + (SLOT_W + 12) / 2}
            x2={OUT_X + (SLOT_W + 12) / 2 + 60}
            y1={T_Y}
            y2={T_Y}
            stroke={EDGE_FAINT}
            strokeWidth={STROKE}
            strokeDasharray="2 3"
          />
          <text
            x={OUT_X + (SLOT_W + 12) / 2 + 6}
            y={T_Y - 8}
            fontSize={9}
            fontFamily="JetBrains Mono, ui-monospace"
            fill={INK_FAINT}
            letterSpacing="0.12em"
          >
            OUTPUT
          </text>
          {/* Callouts — placed adjacent to the part they label */}
          {callout("A", TRIG_X - 56, T_Y)}
          {callout("B", ADV_X, A1_Y - 28)}
          {callout("C", (TRIG_X + ADV_X) / 2, (T_Y + A1_Y) / 2 - 6)}
          {callout("D", (ADV_X + DEC_X) / 2, (T_Y + A2_Y) / 2 + 6)}
          {callout("E", DEC_X, T_Y - 32)}
          {callout("F", OUT_X + (SLOT_W + 12) / 2 + 68, T_Y)}
        </svg>
      </div>
      <dl className="m-0 space-y-3 font-mono text-[10.5px]">
        <AnatomyItem letter="A" label="Trigger">
          The one warm pad. Where the arrangement starts. Always
          scout-accent — exactly one per arrangement.
        </AnatomyItem>
        <AnatomyItem letter="B" label="Role slot">
          A typed pad waiting on an agent. Here filled with{" "}
          <span className="text-studio-ink">@hudson</span>; the hue dot at
          the pin is the agent&apos;s identity stripe.
        </AnatomyItem>
        <AnatomyItem letter="C" label="Outbound trace">
          A solid orthogonal wire — committed flow. Right-angle bends
          only; no curves. Bends carry the read of &ldquo;this signal
          fanned out here.&rdquo;
        </AnatomyItem>
        <AnatomyItem letter="D" label="Advisory trace">
          Dashed. The advisor returns an opinion, not a command. The
          decider may take it or ignore it.
        </AnatomyItem>
        <AnatomyItem letter="E" label="Commit pad">
          Dashed border + wider body. The slot that <em>decides</em>:
          approve / reject / pick-one. Only commit pads can ship output.
        </AnatomyItem>
        <AnatomyItem letter="F" label="Output rail">
          What the arrangement <em>does</em> when it commits — file
          written, PR opened, message sent. The terminal pin where the
          arrangement leaves the broker and lands in the world.
        </AnatomyItem>
      </dl>
    </div>
  );
}

function AnatomyItem({
  letter,
  label,
  children,
}: {
  letter: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span
        aria-hidden
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[9px] font-semibold"
        style={{
          borderColor: WARM,
          color: WARM,
        }}
      >
        {letter}
      </span>
      <div className="flex flex-col gap-0.5">
        <dt className="uppercase tracking-eyebrow text-studio-ink">{label}</dt>
        <dd className="font-sans text-[12px] leading-relaxed text-studio-ink-faint">
          {children}
        </dd>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 3 — Composing
// Three stages of the authoring surface. Same canvas, evolving fill.
// The metaphor is a draftsman's grid — graph paper with a faint dot
// grid; pads dropped onto it; wires drawn between pins. The chrome at
// the top is a deliberately minimal toolbox.
// ─────────────────────────────────────────────────────────────────────

function Composing() {
  return (
    <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
      <ComposeStage
        n={1}
        title="Empty canvas"
        sub="grid paper, palette docked"
      >
        <ComposeBlank />
      </ComposeStage>
      <ComposeStage
        n={2}
        title="Roles drafted"
        sub="pads placed, pins exposed"
      >
        <ComposeDrafted />
      </ComposeStage>
      <ComposeStage
        n={3}
        title="Arrangement composed"
        sub="wired, ready to dispatch"
      >
        <ComposeComposed />
      </ComposeStage>
    </div>
  );
}

function ComposeStage({
  n,
  title,
  sub,
  children,
}: {
  n: number;
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-md border border-studio-edge bg-studio-canvas-alt">
      <div className="flex items-baseline justify-between border-b border-studio-edge px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span
            className="grid h-4 w-4 place-items-center rounded-full border font-mono text-[8.5px] font-semibold"
            style={{ borderColor: WARM, color: WARM }}
          >
            {n}
          </span>
          <div className="font-mono text-[10.5px] uppercase tracking-eyebrow text-studio-ink">
            {title}
          </div>
        </div>
        <div className="font-mono text-[9.5px] text-studio-ink-faint">
          {sub}
        </div>
      </div>
      <div className="flex-1 p-3">{children}</div>
    </div>
  );
}

// Reusable grid backdrop — a 16px dot grid that reads as graph paper.
function GridPaper({ w, h }: { w: number; h: number }) {
  const step = 16;
  const dots: Array<[number, number]> = [];
  for (let x = step; x < w; x += step) {
    for (let y = step; y < h; y += step) {
      dots.push([x, y]);
    }
  }
  return (
    <g aria-hidden>
      {dots.map(([x, y]) => (
        <circle
          key={`g-${x}-${y}`}
          cx={x}
          cy={y}
          r={0.6}
          fill={INK_FAINT}
          opacity={0.35}
        />
      ))}
    </g>
  );
}

// Stage 1 — blank canvas + palette at bottom
function ComposeBlank() {
  const W = 360;
  const H = 240;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img">
      <GridPaper w={W} h={H} />
      {/* Palette dock — bottom strip with three placeable pad shapes */}
      <g transform={`translate(${W / 2 - 110} ${H - 36})`}>
        <rect
          x={-12}
          y={-14}
          width={244}
          height={32}
          rx={3}
          fill="var(--studio-canvas)"
          stroke={EDGE}
          strokeWidth={STROKE}
        />
        <text
          x={0}
          y={-2}
          fontSize={8}
          fontFamily="JetBrains Mono, ui-monospace"
          fill={INK_FAINT}
          letterSpacing="0.14em"
        >
          PALETTE
        </text>
        {/* slot sample */}
        <g transform="translate(50 8)">
          <rect
            x={-22}
            y={-7}
            width={44}
            height={14}
            rx={2}
            fill="var(--studio-canvas-alt)"
            stroke={EDGE}
            strokeWidth={STROKE}
          />
          <text
            x={0}
            y={3}
            fontSize={8}
            fontFamily="JetBrains Mono, ui-monospace"
            fill={INK_MUTED}
            textAnchor="middle"
          >
            slot
          </text>
        </g>
        {/* commit sample */}
        <g transform="translate(118 8)">
          <rect
            x={-26}
            y={-7}
            width={52}
            height={14}
            rx={2}
            fill="var(--studio-canvas-alt)"
            stroke={EDGE}
            strokeWidth={STROKE}
            strokeDasharray="3 3"
          />
          <text
            x={0}
            y={3}
            fontSize={8}
            fontFamily="JetBrains Mono, ui-monospace"
            fill={INK_MUTED}
            textAnchor="middle"
          >
            commit
          </text>
        </g>
        {/* trigger sample */}
        <g transform="translate(190 8)">
          <rect
            x={-22}
            y={-7}
            width={44}
            height={14}
            rx={2}
            fill="color-mix(in oklab, var(--scout-accent) 22%, transparent)"
            stroke={WARM}
            strokeWidth={1.4}
          />
          <text
            x={0}
            y={3}
            fontSize={8}
            fontFamily="JetBrains Mono, ui-monospace"
            fill={WARM}
            textAnchor="middle"
          >
            trigger
          </text>
        </g>
      </g>
      <text
        x={W / 2}
        y={H / 2 - 6}
        fontSize={10}
        fontFamily="JetBrains Mono, ui-monospace"
        fill={INK_FAINT}
        textAnchor="middle"
        letterSpacing="0.14em"
      >
        DROP A PAD TO START
      </text>
    </svg>
  );
}

// Stage 2 — pads placed, no wires yet, pins visible as bare nodes
function ComposeDrafted() {
  const W = 360;
  const H = 240;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img">
      <GridPaper w={W} h={H} />
      <AgentPad x={64} y={120} label="Trigger" trigger />
      <AgentPad x={188} y={64} agent="hudson" />
      <AgentPad x={188} y={176} agent="cody" />
      <AgentPad x={300} y={120} agent="qb" shape="commit" />
      {/* Ghost pin highlights — show the user where wires can attach */}
      {[
        [64 + SLOT_W / 2, 120],
        [188 - SLOT_W / 2, 64],
        [188 - SLOT_W / 2, 176],
        [188 + SLOT_W / 2, 64],
        [188 + SLOT_W / 2, 176],
        [300 - (SLOT_W + 12) / 2, 120],
      ].map(([x, y], i) => (
        <circle
          key={`pin-${i}`}
          cx={x}
          cy={y}
          r={3.6}
          fill="none"
          stroke={WARM}
          strokeWidth={1}
          opacity={0.8}
        />
      ))}
      <text
        x={W / 2}
        y={H - 18}
        fontSize={9}
        fontFamily="JetBrains Mono, ui-monospace"
        fill={INK_FAINT}
        textAnchor="middle"
        letterSpacing="0.14em"
      >
        DRAG A PIN TO ANOTHER TO WIRE
      </text>
    </svg>
  );
}

// Stage 3 — fully composed, dispatch button armed
function ComposeComposed() {
  const W = 360;
  const H = 240;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img">
      <GridPaper w={W} h={H} />
      <AgentPad x={64} y={120} label="Trigger" trigger />
      <AgentPad x={188} y={64} agent="hudson" />
      <AgentPad x={188} y={176} agent="cody" />
      <AgentPad x={300} y={120} agent="qb" shape="commit" />
      <OrthoTrace
        from={[64 + SLOT_W / 2, 120]}
        to={[188 - SLOT_W / 2, 64]}
      />
      <OrthoTrace
        from={[64 + SLOT_W / 2, 120]}
        to={[188 - SLOT_W / 2, 176]}
      />
      <OrthoTrace
        from={[188 + SLOT_W / 2, 64]}
        to={[300 - (SLOT_W + 12) / 2, 120]}
        dashed
      />
      <OrthoTrace
        from={[188 + SLOT_W / 2, 176]}
        to={[300 - (SLOT_W + 12) / 2, 120]}
        dashed
      />
      {/* Dispatch chip — bottom-right, warm */}
      <g transform={`translate(${W - 78} ${H - 26})`}>
        <rect
          x={-30}
          y={-10}
          width={60}
          height={20}
          rx={10}
          fill={WARM}
        />
        <text
          x={0}
          y={3.5}
          fontSize={9}
          fontFamily="JetBrains Mono, ui-monospace"
          fill="var(--studio-canvas)"
          textAnchor="middle"
          letterSpacing="0.16em"
          fontWeight={600}
        >
          DISPATCH
        </text>
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 4 — In-flight readout
// Same Pipeline arrangement as the gallery, but in the running state:
// the trace before the active pad is fully struck through, the active
// pad pulses (static, but visually distinct), waiting pads are muted,
// done pads carry a small check tick. Below the diagram, a per-slot
// status strip echoes the arrangement-aware state.
// ─────────────────────────────────────────────────────────────────────

function InFlight() {
  const W = 720;
  const H = 200;
  const Y = 100;
  const XS = [70, 230, 410, 600];
  // States — pipeline mid-flight: slot 0 done, slot 1 done, slot 2 active, slot 3 waiting
  const states = ["done", "done", "active", "waiting"] as const;
  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full"
          role="img"
          aria-label="In-flight pipeline arrangement"
        >
          {/* Static trace through all pads — used as the "back" rail */}
          <line
            x1={XS[0] + SLOT_W / 2}
            x2={XS[XS.length - 1] - (SLOT_W + 12) / 2}
            y1={Y}
            y2={Y}
            stroke={EDGE_FAINT}
            strokeWidth={STROKE}
          />
          {/* Walked rail — solid warm up to active pad */}
          <line
            x1={XS[0] + SLOT_W / 2}
            x2={XS[2] - SLOT_W / 2}
            y1={Y}
            y2={Y}
            stroke={WARM}
            strokeWidth={2}
          />
          {/* Pads */}
          <AgentPad
            x={XS[0]}
            y={Y}
            agent="scout"
            label="Scout"
            trigger
            state="done"
          />
          <AgentPad x={XS[1]} y={Y} agent="hudson" state="done" />
          <AgentPad x={XS[2]} y={Y} agent="qb" active state="active" />
          <AgentPad
            x={XS[3]}
            y={Y}
            agent="cody"
            shape="commit"
            state="waiting"
          />
          {/* Active pad halo — concentric expanding ring, static (large) */}
          <rect
            x={XS[2] - SLOT_W / 2 - 6}
            y={Y - SLOT_H / 2 - 6}
            width={SLOT_W + 12}
            height={SLOT_H + 12}
            rx={4}
            fill="none"
            stroke={WARM}
            strokeWidth={1}
            opacity={0.35}
          />
          {/* Check ticks on done pads */}
          {[XS[0], XS[1]].map((x) => (
            <g key={`tick-${x}`} transform={`translate(${x - SLOT_W / 2 + 6} ${Y - SLOT_H / 2 - 10})`}>
              <path
                d="M 0 4 L 3 7 L 9 0"
                fill="none"
                stroke="var(--status-ok-fg)"
                strokeWidth={1.4}
                strokeLinejoin="miter"
                strokeLinecap="butt"
              />
            </g>
          ))}
          {/* Arrowhead at commit pad */}
          <Arrowhead
            x={XS[3] - (SLOT_W + 12) / 2}
            y={Y}
            stroke={EDGE_FAINT}
          />
        </svg>
      </div>

      {/* Per-slot status rail — same horizontal order as the pads above */}
      <div className="grid grid-cols-4 overflow-hidden rounded-md border border-studio-edge bg-studio-canvas-alt">
        {states.map((state, i) => {
          const agents = ["scout", "hudson", "qb", "cody"] as const;
          const labels = [
            "scoped the diff",
            "ran tests, +2 fixes",
            "deciding now",
            "queued to ship",
          ];
          const times = ["12s", "1m04s", "—", "—"];
          return (
            <div
              key={agents[i]}
              className={`flex flex-col gap-1 px-3 py-3 ${
                i > 0 ? "border-l border-studio-edge" : ""
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: agentColor(agents[i], 1) }}
                />
                <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-studio-ink">
                  {cap(agents[i])}
                </span>
                <span
                  className="ml-auto font-mono text-[8.5px] uppercase tracking-eyebrow"
                  style={{
                    color:
                      state === "active"
                        ? WARM
                        : state === "done"
                          ? "var(--status-ok-fg)"
                          : INK_FAINT,
                  }}
                >
                  {state}
                </span>
              </div>
              <div className="font-mono text-[10.5px] text-studio-ink-muted">
                {labels[i]}
              </div>
              <div className="mt-0.5 font-mono text-[9px] text-studio-ink-faint">
                {times[i] === "—" ? "—" : `· ${times[i]}`}
              </div>
            </div>
          );
        })}
      </div>

      {/* Inline caption — explains what the operator is seeing */}
      <div className="px-1 font-mono text-[10px] text-studio-ink-faint">
        Arrangement-aware. Not a firehose — the readout knows which slot
        owns the moment.
      </div>
    </div>
  );
}
