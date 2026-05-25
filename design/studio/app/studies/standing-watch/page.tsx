"use client";

/**
 * Standing Watch — study.
 *
 * The mesh as a sonar scope. Each agent is a beacon placed at an
 * angle and a radius:
 *
 *   angle  = node residency  (macbook=N, hetz=E, archie=S, cloud=W)
 *   radius = recency         (center = "now", outer ring = "1h+")
 *
 * Concentric rings mark the time milestones so recency reads at a
 * glance. A scout-accent sweep arm rotates clockwise (~14s/rev) like
 * a classic sonar. State carries motion: `working` halos breathe;
 * `needs-attention` beacons emit a slow expanding ping ring. Offline
 * beacons get a muted dot, no halo, no motion.
 *
 * Static mock — no live broker. Wire to `mesh_presence` + an "ago"
 * field on each registration when the surface lands.
 */

import { useMemo, useState } from "react";

type AgentState = "working" | "available" | "needs-attention" | "idle" | "offline";
type Node = "macbook" | "hetz" | "archie" | "cloud";

interface Beacon {
  id: string;
  name: string;
  hue: number;
  node: Node;
  state: AgentState;
  /** Seconds since last broker update. */
  agoSec: number;
  task?: string;
  unread?: number;
}

const BEACONS: Beacon[] = [
  // macbook — Arach's laptop
  { id: "scout", name: "Scout", hue: 125, node: "macbook", state: "working", agoSec: 8, task: "indexing channel.shared" },
  { id: "hudson", name: "Hudson", hue: 210, node: "macbook", state: "working", agoSec: 42, task: "PR #214 review", unread: 2 },
  { id: "qb", name: "QB", hue: 25, node: "macbook", state: "needs-attention", agoSec: 95, task: "flight 0c8f", unread: 5 },

  // hetz — hetzner box
  { id: "cody", name: "Cody", hue: 85, node: "hetz", state: "working", agoSec: 180, task: "fixture rebuild" },
  { id: "ranger", name: "Ranger", hue: 295, node: "hetz", state: "idle", agoSec: 320, task: "tail watcher" },
  { id: "atlas", name: "Atlas", hue: 175, node: "hetz", state: "available", agoSec: 540 },
  { id: "vault", name: "Vault", hue: 250, node: "hetz", state: "idle", agoSec: 1100, task: "backup snapshot" },

  // archie — home server
  { id: "vox", name: "Vox", hue: 340, node: "archie", state: "needs-attention", agoSec: 240, task: "TTS retry" },
  { id: "pixel", name: "Pixel", hue: 55, node: "archie", state: "available", agoSec: 720 },
  { id: "mira", name: "Mira", hue: 195, node: "archie", state: "offline", agoSec: 2400 },

  // cloud — provisioned instances
  { id: "echo", name: "Echo", hue: 280, node: "cloud", state: "working", agoSec: 150 },
  { id: "drift", name: "Drift", hue: 165, node: "cloud", state: "available", agoSec: 480 },
  { id: "stark", name: "Stark", hue: 15, node: "cloud", state: "offline", agoSec: 3200 },
  { id: "lumen", name: "Lumen", hue: 240, node: "cloud", state: "idle", agoSec: 1600 },
];

// ── Geometry ─────────────────────────────────────────────────────────
const SVG = 620;
const CX = SVG / 2;
const CY = SVG / 2;
const INNER_R = 46;
const RING_5M = 124;
const RING_30M = 202;
const OUTER_R = 280;

const NODE_CENTER_ANGLE: Record<Node, number> = {
  macbook: -Math.PI / 2, // 12 o'clock (top)
  hetz: 0, // 3 o'clock (right)
  archie: Math.PI / 2, // 6 o'clock (bottom)
  cloud: Math.PI, // 9 o'clock (left)
};

const NODE_LABEL: Record<Node, string> = {
  macbook: "MACBOOK",
  hetz: "HETZ",
  archie: "ARCHIE",
  cloud: "CLOUD",
};

function recencyRadius(agoSec: number): number {
  if (agoSec < 30) return INNER_R * (0.4 + 0.6 * (agoSec / 30));
  if (agoSec < 300) return INNER_R + (RING_5M - INNER_R) * ((agoSec - 30) / 270);
  if (agoSec < 1800) return RING_5M + (RING_30M - RING_5M) * ((agoSec - 300) / 1500);
  if (agoSec < 3600) return RING_30M + (OUTER_R - RING_30M) * ((agoSec - 1800) / 1800);
  return OUTER_R + 2;
}

function beaconAngle(beacon: Beacon, all: Beacon[]): number {
  const same = all.filter((b) => b.node === beacon.node);
  const idx = same.findIndex((b) => b.id === beacon.id);
  const total = same.length;
  const center = NODE_CENTER_ANGLE[beacon.node];
  const spread = Math.PI * 0.42; // ~76° within the quadrant
  if (total === 1) return center;
  return center - spread / 2 + (idx / (total - 1)) * spread;
}

const STATE_COLOR: Record<AgentState, string> = {
  working: "var(--status-warn-fg)",
  "needs-attention": "var(--status-error-fg)",
  available: "var(--status-ok-fg)",
  idle: "var(--scout-accent)",
  offline: "var(--studio-ink-faint)",
};

function agentColor(hue: number, alpha = 1) {
  return `oklch(0.74 0.15 ${hue} / ${alpha})`;
}

function fmtAgo(s: number): string {
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${(s / 3600).toFixed(1)}h ago`;
}

// ── Page ─────────────────────────────────────────────────────────────
export default function StandingWatchPage() {
  const [hover, setHover] = useState<Beacon | null>(null);

  const beaconsWithCoords = useMemo(
    () =>
      BEACONS.map((b) => {
        const r = recencyRadius(b.agoSec);
        const θ = beaconAngle(b, BEACONS);
        return { ...b, x: CX + r * Math.cos(θ), y: CY + r * Math.sin(θ), r, θ };
      }),
    [],
  );

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · standing-watch
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Standing watch
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The mesh as a sonar scope. Heading carries node residency —{" "}
          <span className="font-mono text-[11px] text-studio-ink">macbook</span>{" "}
          north,{" "}
          <span className="font-mono text-[11px] text-studio-ink">hetz</span>{" "}
          east, <span className="font-mono text-[11px] text-studio-ink">archie</span>{" "}
          south,{" "}
          <span className="font-mono text-[11px] text-studio-ink">cloud</span>{" "}
          west. Distance from center carries recency. Frozen mid-sweep.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
        <div className="rounded-md border border-studio-edge bg-studio-surface p-3">
          <svg
            viewBox={`0 0 ${SVG} ${SVG}`}
            preserveAspectRatio="xMidYMid meet"
            className="block h-auto w-full max-w-[620px]"
            role="img"
            aria-label="Standing watch — mesh presence scope"
            onMouseLeave={() => setHover(null)}
          >
            {/* Concentric rings */}
            {[
              { r: INNER_R, label: "now" },
              { r: RING_5M, label: "5m" },
              { r: RING_30M, label: "30m" },
              { r: OUTER_R, label: "1h+" },
            ].map((ring) => (
              <g key={ring.label} aria-hidden>
                <circle
                  cx={CX}
                  cy={CY}
                  r={ring.r}
                  fill="none"
                  stroke="var(--studio-edge)"
                  strokeWidth={1}
                  strokeDasharray={ring.r === OUTER_R ? undefined : "2 4"}
                />
                <text
                  x={CX + 6}
                  y={CY - ring.r + 11}
                  fontSize={9}
                  fontFamily="JetBrains Mono, ui-monospace"
                  fill="var(--studio-ink-faint)"
                  letterSpacing="0.18em"
                >
                  {ring.label.toUpperCase()}
                </text>
              </g>
            ))}

            {/* Cardinal spokes */}
            {(["macbook", "hetz", "archie", "cloud"] as Node[]).map((node) => {
              const θ = NODE_CENTER_ANGLE[node];
              const x2 = CX + (OUTER_R + 14) * Math.cos(θ);
              const y2 = CY + (OUTER_R + 14) * Math.sin(θ);
              return (
                <g key={node} aria-hidden>
                  <line
                    x1={CX}
                    y1={CY}
                    x2={CX + OUTER_R * Math.cos(θ)}
                    y2={CY + OUTER_R * Math.sin(θ)}
                    stroke="var(--studio-edge)"
                    strokeWidth={0.6}
                    opacity={0.7}
                  />
                  <text
                    x={x2}
                    y={y2 + (node === "macbook" ? -4 : node === "archie" ? 12 : 4)}
                    fontSize={9.5}
                    fontFamily="JetBrains Mono, ui-monospace"
                    fill="var(--studio-ink-faint)"
                    letterSpacing="0.22em"
                    textAnchor={
                      node === "hetz" ? "end" : node === "cloud" ? "start" : "middle"
                    }
                  >
                    {NODE_LABEL[node]}
                  </text>
                </g>
              );
            })}

            {/* Rotating sweep arm — clockwise 14s revolution. The arm
             *  points straight up at rest; <animateTransform> spins the
             *  whole group around (CX, CY). Trailing wedge sits ~22°
             *  counter-clockwise of the arm, suggesting the path it
             *  just covered. */}
            {(() => {
              // Arm: straight up.
              const armX = CX;
              const armY = CY - OUTER_R;
              // Trail endpoint: ~22° counter-clockwise of straight up.
              const trailθ = -Math.PI / 2 - 0.38;
              const tx = CX + OUTER_R * Math.cos(trailθ);
              const ty = CY + OUTER_R * Math.sin(trailθ);
              const trailPath = `M ${CX} ${CY} L ${tx} ${ty} A ${OUTER_R} ${OUTER_R} 0 0 1 ${armX} ${armY} Z`;
              return (
                <g aria-hidden>
                  <path d={trailPath} fill="var(--scout-accent)" opacity={0.08} />
                  <line
                    x1={CX}
                    y1={CY}
                    x2={armX}
                    y2={armY}
                    stroke="var(--scout-accent)"
                    strokeWidth={1.2}
                    opacity={0.78}
                  />
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from={`0 ${CX} ${CY}`}
                    to={`360 ${CX} ${CY}`}
                    dur="14s"
                    repeatCount="indefinite"
                  />
                </g>
              );
            })()}

            {/* Center reticule */}
            <circle cx={CX} cy={CY} r={2.5} fill="var(--scout-accent)" />
            <circle
              cx={CX}
              cy={CY}
              r={8}
              fill="none"
              stroke="var(--scout-accent)"
              strokeWidth={0.6}
              opacity={0.4}
            />

            {/* Beacons */}
            {beaconsWithCoords.map((b) => {
              const isHovered = hover?.id === b.id;
              const haloColor = STATE_COLOR[b.state];
              const beaconR = isHovered ? 7 : b.state === "offline" ? 3.5 : 5;
              return (
                <g
                  key={b.id}
                  onMouseEnter={() => setHover(b)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Working halo — breathes to convey ongoing work. */}
                  {b.state === "working" ? (
                    <circle
                      cx={b.x}
                      cy={b.y}
                      r={beaconR + 4.5}
                      fill="none"
                      stroke={haloColor}
                      strokeWidth={1}
                    >
                      <animate
                        attributeName="opacity"
                        values="0.32;0.75;0.32"
                        dur="2.4s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  ) : null}

                  {/* Needs-attention — static halo + slow expanding
                   *  ping ring that fades as it grows outward. */}
                  {b.state === "needs-attention" ? (
                    <>
                      <circle
                        cx={b.x}
                        cy={b.y}
                        r={beaconR + 4.5}
                        fill="none"
                        stroke={haloColor}
                        strokeWidth={1}
                        opacity={isHovered ? 0.95 : 0.7}
                      />
                      <circle
                        cx={b.x}
                        cy={b.y}
                        fill="none"
                        stroke={haloColor}
                        strokeWidth={1}
                      >
                        <animate
                          attributeName="r"
                          values={`${beaconR + 4};${beaconR + 20}`}
                          dur="2.2s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="opacity"
                          values="0.75;0"
                          dur="2.2s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    </>
                  ) : null}
                  <circle
                    cx={b.x}
                    cy={b.y}
                    r={beaconR}
                    fill={
                      b.state === "offline"
                        ? "var(--studio-ink-faint)"
                        : agentColor(b.hue)
                    }
                    opacity={b.state === "offline" ? 0.55 : 1}
                    style={{ transition: "r 80ms ease-out" }}
                  />
                  {b.unread ? (
                    <circle
                      cx={b.x + beaconR + 1}
                      cy={b.y - beaconR - 1}
                      r={2.6}
                      fill="var(--status-error-fg)"
                    />
                  ) : null}
                  <text
                    x={b.x}
                    y={b.y + beaconR + 11}
                    fontSize={9}
                    fontFamily="JetBrains Mono, ui-monospace"
                    fill={
                      isHovered
                        ? "var(--studio-ink)"
                        : "var(--studio-ink-faint)"
                    }
                    textAnchor="middle"
                    letterSpacing="0.04em"
                  >
                    {b.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <DetailPanel hover={hover} />
      </div>

      <section className="mt-12 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · why this exists
        </div>
        <p className="font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Roster lists tell you who&apos;s on the team. They don&apos;t tell you
          where they are, or how recently they spoke. For a mesh fleet that
          spans a laptop, a remote box, a home server, and a few cloud
          instances, the spatial dimension carries real information —
          you&apos;ll route differently if four agents are huddled on the same
          machine versus spread across four. Backs onto the existing
          mesh-presence cursor; the angle assignment per node is the only
          new convention.
        </p>
      </section>
    </main>
  );
}

function DetailPanel({ hover }: { hover: Beacon | null }) {
  if (!hover) {
    return (
      <div className="flex h-full min-h-[200px] flex-col justify-center rounded-md border border-studio-edge bg-studio-canvas-alt px-5 py-6 font-mono text-[10.5px] text-studio-ink-faint">
        <div className="text-[9px] uppercase tracking-eyebrow">No beacon</div>
        <div className="mt-2 leading-relaxed">
          Hover any node on the scope to inspect its current task,
          residency, and time-since-last-ping.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-5">
      <div className="text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        Beacon
      </div>
      <div className="mt-1 flex items-baseline gap-3">
        <h2 className="font-display text-[20px] tracking-tight text-studio-ink">
          {hover.name}
        </h2>
        <span
          className="font-mono text-[10px] uppercase tracking-eyebrow"
          style={{ color: STATE_COLOR[hover.state] }}
        >
          {hover.state}
        </span>
        {hover.unread ? (
          <span
            className="rounded-[3px] px-1.5 py-px font-mono text-[9px] font-semibold tabular-nums"
            style={{
              color: "var(--status-error-fg)",
              background: "var(--status-error-bg)",
            }}
          >
            {hover.unread} unread
          </span>
        ) : null}
      </div>

      <dl className="mt-4 grid grid-cols-[80px_1fr] gap-x-3 gap-y-2 font-mono text-[10.5px]">
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
          Node
        </dt>
        <dd className="text-studio-ink">{NODE_LABEL[hover.node].toLowerCase()}</dd>

        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
          Last ping
        </dt>
        <dd className="text-studio-ink">{fmtAgo(hover.agoSec)}</dd>

        {hover.task ? (
          <>
            <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
              Doing
            </dt>
            <dd className="text-studio-ink">{hover.task}</dd>
          </>
        ) : null}
      </dl>

      <div className="mt-5 border-t border-studio-edge pt-3 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        @{hover.id} · h{hover.hue}
      </div>
    </div>
  );
}
