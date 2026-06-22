/**
 * Agent Identity — generative marks from an agent's name.
 *
 * A deterministic identity system: hash the name → seed a PRNG → pull
 * every visual parameter from that one stream. Four engines off the same
 * seed (sprite / sigil / constellation / monogram), a live "type a name"
 * generator, composed identity cards, and the full roster as a wall.
 *
 * Design stance: all the color + personality lives in the generated mark.
 * The chrome around it stays calm and monochrome, so the roster still
 * sorts by name first (the recent neutral-avatar decision holds) while
 * every agent still gets a recognizable face.
 *
 * Algorithm: design/studio/lib/agent-identity.ts (pure TS — ports to
 * Swift for the macOS / iOS surfaces).
 */
"use client";

import { useMemo, useState } from "react";
import {
  type Constellation,
  type EngineId,
  identityFor,
  makeRng,
  type Monogram,
  type Sigil,
  type Sprite,
  spriteFor,
} from "@/lib/agent-identity";

// ─── Roster — the known fleet (AVATAR_HUES + macOS ScoutAgentHue table) ──
type State =
  | "working"
  | "available"
  | "needs-attention"
  | "idle"
  | "offline"
  | "error";

interface RosterAgent {
  name: string;
  handle: string;
  cls: string;
  harness: string;
  state: State;
}

const ROSTER: RosterAgent[] = [
  { name: "Scout", handle: "@scout", cls: "operator", harness: "native", state: "working" },
  { name: "Hudson", handle: "@hudson", cls: "reviewer", harness: "claude", state: "working" },
  { name: "QB", handle: "@qb", cls: "operator", harness: "codex", state: "needs-attention" },
  { name: "Cody", handle: "@cody", cls: "builder", harness: "codex", state: "available" },
  { name: "Ranger", handle: "@ranger", cls: "researcher", harness: "claude", state: "idle" },
  { name: "Vox", handle: "@vox", cls: "bridge", harness: "native", state: "error" },
  { name: "Atlas", handle: "@atlas", cls: "researcher", harness: "claude", state: "offline" },
  { name: "Vault", handle: "@vault", cls: "system", harness: "worker", state: "idle" },
  { name: "Pike", handle: "@pike", cls: "builder", harness: "cursor", state: "working" },
  { name: "Quill", handle: "@quill", cls: "general", harness: "claude", state: "available" },
  { name: "Cobalt", handle: "@cobalt", cls: "builder", harness: "codex", state: "working" },
  { name: "Drover", handle: "@drover", cls: "operator", harness: "native", state: "idle" },
];

const STATE_COLOR: Record<State, string> = {
  working: "var(--status-ok-fg)",
  available: "var(--scout-accent)",
  "needs-attention": "var(--status-warn-fg)",
  idle: "var(--studio-ink-faint)",
  offline: "var(--studio-edge-strong)",
  error: "var(--status-error-fg)",
};
const STATE_LABEL: Record<State, string> = {
  working: "working",
  available: "available",
  "needs-attention": "needs you",
  idle: "idle",
  offline: "offline",
  error: "error",
};

const ENGINES: { id: EngineId; label: string; blurb: string }[] = [
  { id: "sprite", label: "Sprite", blurb: "symmetric pixel-creature with eyes" },
  { id: "sigil", label: "Sigil", blurb: "single-tone geometric glyph" },
  { id: "constellation", label: "Constellation", blurb: "a star-chart per name" },
  { id: "monogram", label: "Monogram", blurb: "initials over a generated field" },
];

// ─── Engine renderers ────────────────────────────────────────────────────

function SpriteMark({ sprite, px = 96, glow = true }: { sprite: Sprite; px?: number; glow?: boolean }) {
  const { cells, size, palette } = sprite;
  const cell = px / size;
  const r = cell * 0.2;
  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${px} ${px}`}
      style={{ display: "block", filter: glow ? `drop-shadow(0 2px 7px ${palette.glow})` : undefined }}
      shapeRendering="geometricPrecision"
    >
      {cells.flatMap((row, ri) =>
        row.map((c, ci) => {
          if (c === "off") return null;
          const x = ci * cell;
          const y = ri * cell;
          const key = `${ri}-${ci}`;
          if (c === "eye") {
            return (
              <g key={key}>
                <rect x={x + 0.4} y={y + 0.4} width={cell - 0.8} height={cell - 0.8} rx={r} fill={palette.sclera} />
                <circle cx={x + cell / 2} cy={y + cell * 0.52} r={cell * 0.19} fill={palette.ink} />
              </g>
            );
          }
          const fill =
            c === "accent" ? palette.accent : c === "mouth" ? palette.ink : palette.body;
          return (
            <rect key={key} x={x + 0.4} y={y + 0.4} width={cell - 0.8} height={cell - 0.8} rx={r} fill={fill} />
          );
        }),
      )}
    </svg>
  );
}

function SigilMark({ sigil, px = 96 }: { sigil: Sigil; px?: number }) {
  const { palette, spokes, rotation, innerMark, gap, satellite, double } = sigil;
  const c = 50;
  const R = 38;
  const sw = 2;
  const spokeEls = Array.from({ length: spokes }, (_, i) => {
    const a = rotation + (i / spokes) * Math.PI * 2;
    const x1 = c + Math.cos(a) * 14;
    const y1 = c + Math.sin(a) * 14;
    const x2 = c + Math.cos(a) * R;
    const y2 = c + Math.sin(a) * R;
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={palette.body} strokeWidth={sw} strokeLinecap="round" />;
  });
  const sx = c + Math.cos(satellite) * R;
  const sy = c + Math.sin(satellite) * R;
  return (
    <svg width={px} height={px} viewBox="0 0 100 100" style={{ display: "block" }}>
      {gap ? (
        <path
          d={describeArc(c, c, R, 28, 332)}
          fill="none"
          stroke={palette.body}
          strokeWidth={sw}
          strokeLinecap="round"
        />
      ) : (
        <circle cx={c} cy={c} r={R} fill="none" stroke={palette.body} strokeWidth={sw} />
      )}
      {double && <circle cx={c} cy={c} r={R - 9} fill="none" stroke={palette.bodyDim} strokeWidth={1} opacity={0.7} />}
      {spokeEls}
      {innerMark === "dot" && <circle cx={c} cy={c} r={6} fill={palette.accent} />}
      {innerMark === "ring" && <circle cx={c} cy={c} r={7} fill="none" stroke={palette.accent} strokeWidth={sw} />}
      {innerMark === "square" && <rect x={c - 6} y={c - 6} width={12} height={12} rx={2} fill={palette.accent} />}
      <circle cx={sx} cy={sy} r={4} fill={palette.accent} />
    </svg>
  );
}

function ConstellationMark({ data, px = 96 }: { data: Constellation; px?: number }) {
  const { palette, nodes, links } = data;
  return (
    <svg width={px} height={px} viewBox="0 0 100 100" style={{ display: "block" }}>
      {links.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a].x * 100}
          y1={nodes[a].y * 100}
          x2={nodes[b].x * 100}
          y2={nodes[b].y * 100}
          stroke={palette.bodyDim}
          strokeWidth={1}
          opacity={0.55}
        />
      ))}
      {nodes.map((n, i) => (
        <circle
          key={i}
          cx={n.x * 100}
          cy={n.y * 100}
          r={n.r * 100}
          fill={i === 0 ? palette.accent : palette.body}
        />
      ))}
    </svg>
  );
}

function MonogramMark({ data, px = 96 }: { data: Monogram; px?: number }) {
  const { palette, field, angle } = data;
  const id = useMemo(() => `mg-${palette.hue}-${field}-${Math.round(angle)}`, [palette.hue, field, angle]);
  const radius = px * 0.22;
  return (
    <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id={id} gradientTransform={`rotate(${angle} 0.5 0.5)`}>
          <stop offset="0%" stopColor={palette.body} />
          <stop offset="100%" stopColor={palette.accent} />
        </linearGradient>
        <pattern id={`${id}-dots`} width={px / 6} height={px / 6} patternUnits="userSpaceOnUse">
          <circle cx={px / 12} cy={px / 12} r={px / 40} fill={palette.sclera} opacity={0.22} />
        </pattern>
        <pattern id={`${id}-grid`} width={px / 5} height={px / 5} patternUnits="userSpaceOnUse">
          <path d={`M ${px / 5} 0 L 0 0 0 ${px / 5}`} fill="none" stroke={palette.sclera} strokeWidth={1} opacity={0.18} />
        </pattern>
      </defs>
      <rect width={px} height={px} rx={radius} fill={`url(#${id})`} />
      {field === "dots" && <rect width={px} height={px} rx={radius} fill={`url(#${id}-dots)`} />}
      {field === "grid" && <rect width={px} height={px} rx={radius} fill={`url(#${id}-grid)`} />}
      {field === "rings" && (
        <>
          <circle cx={px / 2} cy={px / 2} r={px * 0.42} fill="none" stroke={palette.sclera} strokeWidth={1.5} opacity={0.2} />
          <circle cx={px / 2} cy={px / 2} r={px * 0.3} fill="none" stroke={palette.sclera} strokeWidth={1.5} opacity={0.2} />
        </>
      )}
      <text
        x="50%"
        y="52%"
        dominantBaseline="central"
        textAnchor="middle"
        fill={palette.sclera}
        className="font-display"
        style={{ fontWeight: 600, fontSize: px * 0.4, letterSpacing: "-0.02em" }}
      >
        {data.initials}
      </text>
    </svg>
  );
}

/** Render whichever engine is selected, at a given size. */
function Mark({ name, engine, px, glow }: { name: string; engine: EngineId; px: number; glow?: boolean }) {
  const id = useMemo(() => identityFor(name), [name]);
  switch (engine) {
    case "sprite":
      return <SpriteMark sprite={id.sprite} px={px} glow={glow} />;
    case "sigil":
      return <SigilMark sigil={id.sigil} px={px} />;
    case "constellation":
      return <ConstellationMark data={id.constellation} px={px} />;
    case "monogram":
      return <MonogramMark data={id.monogram} px={px} />;
  }
}

// SVG arc helper (for the broken-ring sigil).
function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polar(cx, cy, r, endDeg);
  const e = polar(cx, cy, r, startDeg);
  const large = endDeg - startDeg <= 180 ? "0" : "1";
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
}

// ─── Identity card — the composed surface ────────────────────────────────

function IdentityCard({ agent, engine }: { agent: RosterAgent; engine: EngineId }) {
  const id = useMemo(() => identityFor(agent.name), [agent.name]);
  const seed = useMemo(() => makeRng(agent.name).seed, [agent.name]);
  const dim = agent.state === "offline";
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-studio-edge bg-studio-surface p-4 transition-colors"
      style={{ opacity: dim ? 0.72 : 1 }}
    >
      <div className="flex items-start gap-3">
        <div
          className="grid shrink-0 place-items-center rounded-xl"
          style={{ width: 64, height: 64, background: id.palette.soft }}
        >
          <Mark name={agent.name} engine={engine} px={48} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-sans text-[15px] font-semibold tracking-tight text-studio-ink">
              {agent.name}
            </span>
            <span className="font-mono text-[10.5px] text-studio-ink-faint">{agent.handle}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background: STATE_COLOR[agent.state],
                boxShadow:
                  agent.state === "working"
                    ? `0 0 0 3px color-mix(in oklab, ${STATE_COLOR[agent.state]} 30%, transparent)`
                    : undefined,
              }}
            />
            <span className="font-mono text-[10px] uppercase tracking-eyebrow" style={{ color: STATE_COLOR[agent.state] }}>
              {STATE_LABEL[agent.state]}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Tag>{agent.cls}</Tag>
            <Tag>{agent.harness}</Tag>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-studio-edge pt-2 font-mono text-[9px] text-studio-ink-faint">
        <span>hue {id.palette.hue}°</span>
        <span>seed 0x{seed.toString(16).padStart(8, "0")}</span>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-studio-edge px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
      {children}
    </span>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

const EXAMPLES = ["Hudson", "Scout", "QB", "Ranger", "Sparrow", "Mongoose", "Tycho", "Wren"];

export default function AgentIdentityPage() {
  const [name, setName] = useState("Hudson");
  const [engine, setEngine] = useState<EngineId>("sprite");
  const seed = useMemo(() => spriteFor(name).palette.hue, [name]);

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-10 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agent-identity
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent identity
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          A delightful, <span className="text-studio-ink">systematic</span> mark for every agent — derived entirely from
          its name. Hash the name to a seed, seed a PRNG, and pull every visual parameter from that one stream. Same name,
          same creature, forever, on every surface. All the color and personality lives in the mark; the chrome around it
          stays calm, so the roster still sorts by name first.
        </p>
      </header>

      {/* 00 — The heuristic */}
      <Section label="00 · The heuristic" hint="name → seed → stream → params">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-md border border-studio-edge bg-studio-surface p-4 font-mono text-[11.5px] leading-relaxed text-studio-ink-faint">
            <div><span className="text-studio-ink">name</span> = "{name}"</div>
            <div className="text-studio-ink-faint">↓ xmur3() — string → 32-bit seed</div>
            <div><span className="text-studio-ink">seed</span> = mulberry32(…) → repeatable [0,1) stream</div>
            <div className="text-studio-ink-faint">↓ pull in fixed order</div>
            <div><span className="text-studio-ink">hue</span> = {seed}° &nbsp;·&nbsp; lightness + chroma fixed by role</div>
            <div className="text-studio-ink-faint">↓ silhouette · eyes · antennae · legs · speckle …</div>
            <div className="mt-1 text-studio-ink">stable, storage-free, portable to Swift</div>
          </div>
          <ul className="flex flex-col justify-center gap-2 font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
            <li><span className="text-studio-ink">Deterministic.</span> No DB column, no upload — the name is the seed.</li>
            <li><span className="text-studio-ink">One hue per agent.</span> Lightness/chroma are fixed so nothing is garish; every mark belongs to the same family.</li>
            <li><span className="text-studio-ink">Color is quarantined to the mark.</span> Tags, rows, and state stay monochrome — the eye still sorts by name.</li>
            <li><span className="text-studio-ink">Pure TS.</span> The generator (<code className="text-studio-ink-muted">lib/agent-identity.ts</code>) ports straight to the native <code className="text-studio-ink-muted">ScoutAgentHue</code> path.</li>
          </ul>
        </div>
      </Section>

      {/* 01 — Live generator */}
      <Section label="01 · Live generator" hint="type a name — watch it become four marks">
        <div className="rounded-md border border-studio-edge bg-studio-surface p-5">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              className="focus-ring w-[220px] rounded-sm border border-studio-edge bg-studio-canvas px-3 py-1.5 font-mono text-[13px] text-studio-ink outline-none"
              placeholder="agent name…"
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setName(ex)}
                  className="focus-ring rounded-sm border border-studio-edge px-2 py-1 font-mono text-[10.5px] text-studio-ink-faint transition-colors hover:bg-studio-canvas-alt hover:text-studio-ink"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {ENGINES.map((eng) => (
              <div key={eng.id} className="flex flex-col items-center gap-2.5">
                <div className="grid h-[120px] w-full place-items-center rounded-md border border-studio-edge bg-studio-canvas">
                  <Mark name={name || " "} engine={eng.id} px={84} />
                </div>
                <div className="text-center">
                  <div className="font-mono text-[11px] text-studio-ink">{eng.label}</div>
                  <div className="font-mono text-[9px] text-studio-ink-faint">{eng.blurb}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* 02 — Sprite anatomy */}
      <Section label="02 · Sprite anatomy" hint="why random pixels read as a creature">
        <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
          <div className="grid place-items-center rounded-md border border-studio-edge bg-studio-surface p-5">
            <SpriteMark sprite={spriteFor(name || "Hudson")} px={160} />
          </div>
          <ul className="flex flex-col justify-center gap-2.5 font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
            <li><span className="text-studio-ink">Mirror axis.</span> Only the left half is generated and reflected — bilateral symmetry is what turns noise into an organism.</li>
            <li><span className="text-studio-ink">Forced eye-band + spine.</span> A solid row gets a symmetric pair of eyes (sclera + pupil); a strong center column keeps the body connected. Guarantees a face.</li>
            <li><span className="text-studio-ink">Seeded traits.</span> Antennae, legs, wide/narrow eyes, a quiet mouth, and accent-tone speckle ("markings") are each a coin-flip from the stream — that's where the individuality comes from.</li>
            <li><span className="text-studio-ink">Two tones + glow.</span> Body + analogous accent, a dark pupil/ink, and a soft drop-shadow in the agent's own hue for the lit, bloomed look.</li>
          </ul>
        </div>
      </Section>

      {/* 03 — Engine across the roster */}
      <Section label="03 · One engine, the whole roster" hint="compare a system's variety + consistency">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {ENGINES.map((eng) => (
            <button
              key={eng.id}
              onClick={() => setEngine(eng.id)}
              aria-pressed={engine === eng.id}
              className={[
                "focus-ring rounded-sm border px-3 py-1.5 font-mono text-[11px] transition-colors",
                engine === eng.id
                  ? "border-transparent bg-scout-accent-soft text-studio-ink"
                  : "border-studio-edge text-studio-ink-faint hover:bg-studio-canvas-alt hover:text-studio-ink",
              ].join(" ")}
            >
              {eng.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4 rounded-md border border-studio-edge bg-studio-surface p-5 sm:grid-cols-4 lg:grid-cols-6">
          {ROSTER.map((a) => (
            <div key={a.name} className="flex flex-col items-center gap-2">
              <Mark name={a.name} engine={engine} px={72} />
              <span className="font-mono text-[10px] text-studio-ink-faint">{a.name}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* 04 — Identity cards */}
      <Section label="04 · Identity card" hint="the mark composed with name · state · class · harness">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {ROSTER.slice(0, 6).map((a) => (
            <IdentityCard key={a.name} agent={a} engine={engine} />
          ))}
        </div>
        <div className="mt-3 font-mono text-[9.5px] text-studio-ink-faint">
          cards follow the engine selected above · color lives in the mark, chrome stays monochrome
        </div>
      </Section>

      {/* 05 — The wall */}
      <Section label="05 · The wall" hint="every agent × every engine">
        <div className="overflow-x-auto rounded-md border border-studio-edge bg-studio-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-studio-edge">
                <th className="px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                  agent
                </th>
                {ENGINES.map((eng) => (
                  <th key={eng.id} className="px-4 py-2 text-center font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                    {eng.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROSTER.map((a) => (
                <tr key={a.name} className="border-b border-studio-edge last:border-b-0">
                  <td className="px-4 py-2 align-middle">
                    <div className="font-sans text-[12.5px] text-studio-ink">{a.name}</div>
                    <div className="font-mono text-[9.5px] text-studio-ink-faint">{a.handle}</div>
                  </td>
                  {ENGINES.map((eng) => (
                    <td key={eng.id} className="px-4 py-2 text-center">
                      <div className="inline-grid place-items-center">
                        <Mark name={a.name} engine={eng.id} px={44} glow={false} />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Footer */}
      <section className="mt-16 max-w-prose border-t border-studio-edge pt-6">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · source
        </div>
        <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-studio-ink-faint">
          <li><span className="text-studio-ink">lib/agent-identity.ts</span> — pure generator: hash · prng · palette · 4 engines</li>
          <li><span className="text-studio-ink">apps/macos/Sources/ScoutAppCore/ScoutCommsModels.swift</span> — ScoutAgentHue (the Swift port target)</li>
          <li><span className="text-studio-ink">packages/web/client/lib/colors.ts</span> — actorColor (the flat 8-color predecessor)</li>
        </ul>
      </section>
    </main>
  );
}

// ─── Local chrome ────────────────────────────────────────────────────────

function Section({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mb-14">
      <div className="mb-4 flex items-baseline gap-3">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">{label}</div>
        <div className="font-mono text-[10px] text-studio-ink-faint">{hint}</div>
        <div className="ml-3 h-px flex-1 bg-studio-edge" />
      </div>
      {children}
    </section>
  );
}
