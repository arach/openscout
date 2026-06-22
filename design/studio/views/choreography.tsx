"use client";

/**
 * Choreography — study.
 *
 * The fleet as a score. Each agent gets a staff line; events are notes
 * placed in time; @mentions are arcs that cross from one voice to
 * another. Silences are intentional — gaps are data, not missing data.
 *
 * Glyph vocabulary:
 *   • bar       work / task (length encodes duration, opacity encodes intensity)
 *   • diamond   decision point
 *   • triangle  inbound or outbound @mention
 *   • dot       artifact produced (file, PR, message landing)
 *
 * Aesthetic notes: hairline staff rules, mono in the gutter, agent
 * color from the avatar hue table, arcs as cubic beziers with 50%
 * alpha. The "now line" is a thin vertical scout-accent rule — the
 * single warm element in the field.
 *
 * Static mock — no live broker. Drop the SCORE / ARCS constants in
 * favor of a real /broker/tail feed when the API surface lands.
 */

import { useMemo, useState } from "react";

type AgentId =
  | "scout"
  | "hudson"
  | "qb"
  | "cody"
  | "ranger"
  | "vox"
  | "atlas"
  | "vault";

type EventKind = "work" | "decision" | "message" | "artifact";

interface ScoreEvent {
  id: string;
  agent: AgentId;
  /** Seconds from window start. */
  t: number;
  /** Only for `work` events — bar length on the staff. */
  duration?: number;
  kind: EventKind;
  /** 0..1 — opacity multiplier for `work` bars. */
  intensity?: number;
  /** Short caption shown on hover. */
  label?: string;
}

interface Arc {
  id: string;
  fromAgent: AgentId;
  toAgent: AgentId;
  fromT: number;
  toT: number;
  label?: string;
}

const LANES: { id: AgentId; name: string; hue: number }[] = [
  { id: "scout", name: "Scout", hue: 125 },
  { id: "hudson", name: "Hudson", hue: 210 },
  { id: "qb", name: "QB", hue: 25 },
  { id: "cody", name: "Cody", hue: 85 },
  { id: "ranger", name: "Ranger", hue: 295 },
  { id: "vox", name: "Vox", hue: 340 },
  { id: "atlas", name: "Atlas", hue: 175 },
  { id: "vault", name: "Vault", hue: 250 },
];

const WINDOW_SEC = 90 * 60;
const NOW_SEC = 48 * 60;

const SCORE: ScoreEvent[] = [
  // Opening — Scout indexes, Hudson picks up PR.
  { id: "e1", agent: "scout", t: 30, kind: "work", duration: 260, intensity: 0.55, label: "indexing channel.shared" },
  { id: "e2", agent: "hudson", t: 60, kind: "work", duration: 720, intensity: 0.9, label: "PR #214 review" },
  { id: "e3", agent: "vault", t: 90, kind: "work", duration: 180, intensity: 0.3, label: "backup snapshot" },

  // Call-and-response — Scout asks Hudson for help on auth.ts.
  { id: "e4", agent: "scout", t: 320, kind: "message", label: "@hudson look at auth.ts?" },
  { id: "e5", agent: "hudson", t: 405, kind: "message", label: "on it" },

  // QB makes a decision.
  { id: "e6", agent: "qb", t: 720, kind: "decision", label: "approve flight 0c8f" },

  // Cody picks up a long job; Hudson produces auth.diff.
  { id: "e7", agent: "cody", t: 900, kind: "work", duration: 540, intensity: 0.65 },
  { id: "e8", agent: "hudson", t: 1240, kind: "artifact", label: "auth.diff (+182 / -47)" },

  // Long silence in the middle for Vault; Ranger tails in low-intensity.
  { id: "e9", agent: "ranger", t: 1800, kind: "work", duration: 1500, intensity: 0.22, label: "tail watcher" },

  // Vox hits an error and decides to retry.
  { id: "e10", agent: "vox", t: 2100, kind: "decision", label: "TTS provider retry" },

  // Scout pings Cody for status; Cody confirms a main merge.
  { id: "e11", agent: "scout", t: 2400, kind: "message", label: "@cody status?" },
  { id: "e12", agent: "cody", t: 2475, kind: "message", label: "merged main" },

  // Atlas spins up briefly.
  { id: "e13", agent: "atlas", t: 2700, kind: "work", duration: 320, intensity: 0.5 },

  // Hudson decides to ship.
  { id: "e14", agent: "hudson", t: 3000, kind: "decision", label: "ship PR #214" },
  { id: "e15", agent: "hudson", t: 3030, kind: "artifact", label: "merged to main" },

  // Vault snapshots again.
  { id: "e16", agent: "vault", t: 3300, kind: "work", duration: 220, intensity: 0.35 },

  // Late phase — long burst on Cody, Scout produces a report.
  { id: "e17", agent: "cody", t: 3700, kind: "work", duration: 800, intensity: 0.75, label: "fixture rebuild" },
  { id: "e18", agent: "scout", t: 4200, kind: "artifact", label: "fleet-report.md" },

  // QB pings Scout for review.
  { id: "e19", agent: "qb", t: 4500, kind: "message", label: "@scout review please" },
  { id: "e20", agent: "scout", t: 4620, kind: "work", duration: 200, intensity: 0.85 },
  { id: "e21", agent: "scout", t: 4830, kind: "decision", label: "approve" },

  // Closing — Hudson opens a new branch.
  { id: "e22", agent: "hudson", t: 5100, kind: "work", duration: 280, intensity: 0.6, label: "atoms/eyebrow" },
  { id: "e23", agent: "atlas", t: 5300, kind: "artifact", label: "icon-set.svg" },
];

const ARCS: Arc[] = [
  { id: "a1", fromAgent: "scout", toAgent: "hudson", fromT: 320, toT: 405, label: "auth review" },
  { id: "a2", fromAgent: "scout", toAgent: "cody", fromT: 2400, toT: 2475, label: "status" },
  { id: "a3", fromAgent: "qb", toAgent: "scout", fromT: 4500, toT: 4620, label: "review" },
];

// ── Layout ───────────────────────────────────────────────────────────
const GUTTER = 86;
const TIME_AXIS_H = 22;
const LANE_H = 38;
const SVG_W = 1320;
const SCORE_W = SVG_W - GUTTER - 16;
const SVG_H = TIME_AXIS_H + LANES.length * LANE_H + 14;

const X = (t: number) => GUTTER + (t / WINDOW_SEC) * SCORE_W;
const LANE_Y = (i: number) => TIME_AXIS_H + i * LANE_H + LANE_H / 2;
const LANE_INDEX: Record<AgentId, number> = LANES.reduce(
  (acc, lane, i) => ({ ...acc, [lane.id]: i }),
  {} as Record<AgentId, number>,
);
const LANE_HUE: Record<AgentId, number> = LANES.reduce(
  (acc, lane) => ({ ...acc, [lane.id]: lane.hue }),
  {} as Record<AgentId, number>,
);

function agentColor(id: AgentId, alpha = 1) {
  return `oklch(0.74 0.15 ${LANE_HUE[id]} / ${alpha})`;
}

// ── Page ─────────────────────────────────────────────────────────────
export default function ChoreographyPage() {
  const [hover, setHover] = useState<ScoreEvent | Arc | null>(null);
  const [hoverKind, setHoverKind] = useState<"event" | "arc" | null>(null);

  const ticks = useMemo(
    () => Array.from({ length: 7 }, (_, i) => i * 15 * 60),
    [],
  );

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · choreography
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Choreography
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The fleet as a score. Each agent owns a staff line; events are notes
          placed in time; <code className="font-mono text-[11px] text-studio-ink">@mentions</code> are arcs that cross
          voices. Silences are intentional — gaps carry meaning. A 90-minute
          window, frozen mid-performance.
        </p>
      </header>

      <Legend />

      <div className="-mx-2 mt-5 overflow-x-auto rounded-md border border-studio-edge bg-studio-surface">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="block w-full"
          role="img"
          aria-label="Choreography of fleet activity over the last 90 minutes"
          onMouseLeave={() => {
            setHover(null);
            setHoverKind(null);
          }}
        >
          {/* Time grid */}
          {ticks.map((t) => (
            <g key={`t-${t}`} aria-hidden>
              <line
                x1={X(t)}
                x2={X(t)}
                y1={TIME_AXIS_H}
                y2={SVG_H - 8}
                stroke="var(--studio-edge)"
                strokeWidth={1}
                opacity={0.55}
              />
              <text
                x={X(t)}
                y={TIME_AXIS_H - 8}
                fontSize={9.5}
                fontFamily="JetBrains Mono, ui-monospace"
                fill="var(--studio-ink-faint)"
                textAnchor="start"
                letterSpacing="0.08em"
              >
                +{t / 60}m
              </text>
            </g>
          ))}

          {/* Lane staffs */}
          {LANES.map((lane, i) => {
            const y = LANE_Y(i);
            return (
              <g key={lane.id}>
                <text
                  x={12}
                  y={y + 3.5}
                  fontSize={11}
                  fontFamily="JetBrains Mono, ui-monospace"
                  fill="var(--studio-ink-faint)"
                  letterSpacing="0.04em"
                >
                  {lane.name}
                </text>
                <circle cx={GUTTER - 12} cy={y} r={3.2} fill={agentColor(lane.id, 0.9)} />
                <line
                  x1={GUTTER}
                  x2={GUTTER + SCORE_W}
                  y1={y}
                  y2={y}
                  stroke="var(--studio-edge)"
                  strokeWidth={1}
                />
              </g>
            );
          })}

          {/* Arcs — drawn before glyphs so glyphs sit on top. The
           *  marching-ants stroke-dashoffset animation runs continuously
           *  to suggest direction-of-flow from fromAgent → toAgent. */}
          {ARCS.map((arc) => {
            const x1 = X(arc.fromT);
            const x2 = X(arc.toT);
            const y1 = LANE_Y(LANE_INDEX[arc.fromAgent]);
            const y2 = LANE_Y(LANE_INDEX[arc.toAgent]);
            const dy = y2 - y1;
            const mx = (x1 + x2) / 2;
            const arch = Math.min(Math.abs(dy) * 0.45, 56);
            const cpY = (y1 + y2) / 2 - (dy > 0 ? arch : -arch);
            const path = `M ${x1} ${y1} Q ${mx} ${cpY} ${x2} ${y2}`;
            const isHovered = hoverKind === "arc" && (hover as Arc)?.id === arc.id;
            return (
              <g key={arc.id}>
                <path
                  d={path}
                  fill="none"
                  stroke={isHovered ? "var(--scout-accent)" : agentColor(arc.fromAgent, 0.6)}
                  strokeWidth={isHovered ? 1.6 : 1}
                  strokeDasharray="4 4"
                  style={{ transition: "stroke 80ms ease-out, stroke-width 80ms ease-out" }}
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from="0"
                    to="-8"
                    dur={isHovered ? "0.45s" : "0.9s"}
                    repeatCount="indefinite"
                  />
                </path>
                {/* invisible thick hit area */}
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  onMouseEnter={() => {
                    setHover(arc);
                    setHoverKind("arc");
                  }}
                  style={{ cursor: "pointer" }}
                />
              </g>
            );
          })}

          {/* Now line — breathes to suggest the score is live. */}
          <line
            x1={X(NOW_SEC)}
            x2={X(NOW_SEC)}
            y1={TIME_AXIS_H - 4}
            y2={SVG_H - 8}
            stroke="var(--scout-accent)"
            strokeWidth={1}
          >
            <animate
              attributeName="opacity"
              values="0.42;0.85;0.42"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </line>
          <text
            x={X(NOW_SEC) + 4}
            y={TIME_AXIS_H - 8}
            fontSize={9}
            fontFamily="JetBrains Mono, ui-monospace"
            fill="var(--scout-accent)"
            letterSpacing="0.18em"
          >
            NOW
            <animate
              attributeName="opacity"
              values="0.6;1;0.6"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </text>

          {/* Event glyphs */}
          {SCORE.map((evt) => {
            const isHovered =
              hoverKind === "event" && (hover as ScoreEvent)?.id === evt.id;
            const x = X(evt.t);
            const y = LANE_Y(LANE_INDEX[evt.agent]);
            const color = agentColor(evt.agent, 1);
            const accent = isHovered ? "var(--scout-accent)" : color;

            const onEnter = () => {
              setHover(evt);
              setHoverKind("event");
            };

            if (evt.kind === "work") {
              const w = (evt.duration ?? 60) / WINDOW_SEC * SCORE_W;
              const h = isHovered ? 8 : 5;
              const endT = evt.t + (evt.duration ?? 0);
              const inProgress = evt.t <= NOW_SEC && endT > NOW_SEC;
              return (
                <g key={evt.id} onMouseEnter={onEnter} style={{ cursor: "pointer" }}>
                  <rect
                    x={x}
                    y={y - h / 2}
                    width={w}
                    height={h}
                    rx={1.5}
                    fill={accent}
                    opacity={isHovered ? 1 : 0.42 + (evt.intensity ?? 0.5) * 0.5}
                    style={{ transition: "height 80ms ease-out, opacity 80ms ease-out" }}
                  />
                  {inProgress ? (
                    <circle cx={X(NOW_SEC)} cy={y} r={3.5} fill={accent}>
                      <animate
                        attributeName="r"
                        values="2.8;5;2.8"
                        dur="1.6s"
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0.55;1;0.55"
                        dur="1.6s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  ) : null}
                </g>
              );
            }
            if (evt.kind === "decision") {
              const s = isHovered ? 8 : 6;
              return (
                <g
                  key={evt.id}
                  transform={`translate(${x} ${y}) rotate(45)`}
                  onMouseEnter={onEnter}
                  style={{ cursor: "pointer" }}
                >
                  <rect x={-s / 2} y={-s / 2} width={s} height={s} fill={accent} />
                </g>
              );
            }
            if (evt.kind === "message") {
              const s = isHovered ? 9 : 7;
              const pts = `0,${-s / 1.5} ${s / 1.5},${s / 2} ${-s / 1.5},${s / 2}`;
              return (
                <g
                  key={evt.id}
                  transform={`translate(${x} ${y})`}
                  onMouseEnter={onEnter}
                  style={{ cursor: "pointer" }}
                >
                  <polygon points={pts} fill={accent} />
                </g>
              );
            }
            // artifact
            const r = isHovered ? 5 : 3.5;
            return (
              <g key={evt.id} onMouseEnter={onEnter} style={{ cursor: "pointer" }}>
                <circle cx={x} cy={y} r={r} fill={accent} />
                <circle
                  cx={x}
                  cy={y}
                  r={r + 2}
                  fill="none"
                  stroke={accent}
                  strokeWidth={0.8}
                  opacity={0.35}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <DetailRail hover={hover} hoverKind={hoverKind} />

      <section className="mt-12 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · why this exists
        </div>
        <p className="font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The fleet&apos;s current ops surfaces — roster, inspector, tail — are all
          point-in-time slices. A long-running fleet has a temporal shape, and
          experienced operators read it the way a producer reads a session:
          who&apos;s in the pocket, who&apos;s laying out, who just called whom. This
          treats the broker&apos;s event log as a score so that shape becomes
          legible at a glance. Backs naturally onto the existing tail
          firehose; mock data here is shaped like what a real{" "}
          <code className="font-mono text-[11px] text-studio-ink">broker_feed</code>
          {" "}cursor would return.
        </p>
      </section>
    </main>
  );
}

// ── Legend ───────────────────────────────────────────────────────────
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] text-studio-ink-faint">
      <LegendChip glyph="bar" label="work — length = duration" />
      <LegendChip glyph="diamond" label="decision" />
      <LegendChip glyph="message" label="@mention" />
      <LegendChip glyph="artifact" label="artifact" />
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-3 w-px"
          style={{ background: "var(--scout-accent)" }}
        />
        <span>now</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width={26} height={10} aria-hidden>
          <path
            d="M 1 8 Q 13 -2 25 8"
            fill="none"
            stroke="var(--studio-ink-faint)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        </svg>
        <span>cross-voice arc</span>
      </span>
    </div>
  );
}

function LegendChip({
  glyph,
  label,
}: {
  glyph: "bar" | "diamond" | "message" | "artifact";
  label: string;
}) {
  const color = "var(--studio-ink-muted)";
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={18} height={10} aria-hidden>
        {glyph === "bar" && (
          <rect x={1} y={3.5} width={16} height={3} rx={1.5} fill={color} />
        )}
        {glyph === "diamond" && (
          <g transform="translate(9 5) rotate(45)">
            <rect x={-3} y={-3} width={6} height={6} fill={color} />
          </g>
        )}
        {glyph === "message" && (
          <polygon points="9,1 14,8 4,8" fill={color} />
        )}
        {glyph === "artifact" && (
          <>
            <circle cx={9} cy={5} r={2.6} fill={color} />
            <circle
              cx={9}
              cy={5}
              r={4.4}
              fill="none"
              stroke={color}
              strokeWidth={0.6}
              opacity={0.4}
            />
          </>
        )}
      </svg>
      <span>{label}</span>
    </span>
  );
}

// ── Detail rail (below score) ────────────────────────────────────────
function DetailRail({
  hover,
  hoverKind,
}: {
  hover: ScoreEvent | Arc | null;
  hoverKind: "event" | "arc" | null;
}) {
  if (!hover || !hoverKind) {
    return (
      <div className="mt-3 px-2 font-mono text-[10px] text-studio-ink-faint">
        Hover any glyph or arc to inspect.
      </div>
    );
  }
  if (hoverKind === "arc") {
    const arc = hover as Arc;
    return (
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-3 py-2 font-mono text-[10.5px]">
        <span className="text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          arc
        </span>
        <span className="text-studio-ink">
          @{arc.fromAgent}
          <span className="px-1.5 text-studio-ink-faint">→</span>
          @{arc.toAgent}
        </span>
        <span className="text-studio-ink-faint">
          +{Math.round(arc.fromT / 60)}m
          <span className="px-1">→</span>
          +{Math.round(arc.toT / 60)}m
          <span className="ml-1 text-studio-ink-faint/80">
            ({Math.round(arc.toT - arc.fromT)}s gap)
          </span>
        </span>
        {arc.label ? (
          <span className="text-studio-ink">{arc.label}</span>
        ) : null}
      </div>
    );
  }
  const evt = hover as ScoreEvent;
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-3 py-2 font-mono text-[10.5px]">
      <span className="text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {evt.kind}
      </span>
      <span className="text-studio-ink">@{evt.agent}</span>
      <span className="text-studio-ink-faint">+{Math.round(evt.t / 60)}m</span>
      {evt.duration ? (
        <span className="text-studio-ink-faint">{evt.duration}s</span>
      ) : null}
      {typeof evt.intensity === "number" ? (
        <span className="text-studio-ink-faint">
          intensity {(evt.intensity * 100).toFixed(0)}%
        </span>
      ) : null}
      {evt.label ? <span className="text-studio-ink">{evt.label}</span> : null}
    </div>
  );
}
