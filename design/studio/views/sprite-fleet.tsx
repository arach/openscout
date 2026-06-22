/**
 * Sprite Fleet — the sprite identity, productized + semantic.
 *
 * The mapping the system encodes, all at a glance:
 *   shape      = WHO        (deterministic from the name)
 *   hue        = HARNESS    (which runtime — claude / codex / cursor / …)
 *   brightness = STATE      (how alive: working is vivid, offline greys out)
 *
 * And ownership: every agent gets one creature for free (the name's
 * default). Reroll to explore variants, then KEEP the one you want — it
 * becomes yours and persists. All that's stored is a tiny salt; the rest
 * stays derived.
 *
 * The calm rule still holds: the creature carries liveliness via contrast,
 * the semantic state dot carries the precise state. Ambient by default,
 * attention as a precedence layer.
 *
 * Avatar:    components/SpriteAvatar.tsx
 * Generator: lib/agent-identity.ts
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { makeRng, type Tone } from "@/lib/agent-identity";

// ─── Vocab ─────────────────────────────────────────────────────────────
type State = "working" | "available" | "needs-attention" | "idle" | "offline" | "error";

interface Agent {
  name: string;
  handle: string;
  cls: string;
  harness: string;
  state: State;
  task: string;
}

const FLEET: Agent[] = [
  { name: "Scout", handle: "@scout", cls: "operator", harness: "native", state: "working", task: "indexing channel.shared" },
  { name: "Hudson", handle: "@hudson", cls: "reviewer", harness: "claude", state: "working", task: "reviewing PR #214" },
  { name: "QB", handle: "@qb", cls: "operator", harness: "codex", state: "needs-attention", task: "awaiting decision · flight 0c8f" },
  { name: "Cody", handle: "@cody", cls: "builder", harness: "codex", state: "available", task: "ready to dispatch" },
  { name: "Ranger", handle: "@ranger", cls: "researcher", harness: "claude", state: "idle", task: "tail watcher" },
  { name: "Vox", handle: "@vox", cls: "bridge", harness: "native", state: "error", task: "TTS provider auth failed" },
  { name: "Atlas", handle: "@atlas", cls: "researcher", harness: "claude", state: "offline", task: "—" },
  { name: "Vault", handle: "@vault", cls: "system", harness: "worker", state: "idle", task: "snapshot sync" },
  { name: "Pike", handle: "@pike", cls: "builder", harness: "cursor", state: "working", task: "scaffolding ios surfaces" },
  { name: "Quill", handle: "@quill", cls: "general", harness: "claude", state: "available", task: "drafting release notes" },
  { name: "Cobalt", handle: "@cobalt", cls: "builder", harness: "codex", state: "working", task: "migrating broker schema" },
  { name: "Drover", handle: "@drover", cls: "operator", harness: "native", state: "idle", task: "herding stale sessions" },
];

// hue = harness. Distinct, pleasant families.
const HARNESS_HUE: Record<string, number> = {
  claude: 25, // ember (the crab's lineage)
  codex: 135, // terminal green
  cursor: 235, // blue
  native: 280, // indigo
  worker: 195, // teal
};
const HARNESS_FALLBACK = 60;

const HARNESSES = [
  { id: "claude", rep: "Hudson" },
  { id: "codex", rep: "Cody" },
  { id: "cursor", rep: "Pike" },
  { id: "native", rep: "Scout" },
  { id: "worker", rep: "Vault" },
];

// brightness/chroma = state. The creature shows liveliness; the dot shows
// the precise state. working/needs-attention read alive; dormant greys out.
const STATE_TONE: Record<State, Tone> = {
  working: { l: 0.75, c: 0.16 },
  available: { l: 0.73, c: 0.13 },
  "needs-attention": { l: 0.75, c: 0.16 },
  idle: { l: 0.64, c: 0.075 },
  error: { l: 0.56, c: 0.05 },
  offline: { l: 0.5, c: 0.02 },
};
const MATRIX_STATES: State[] = ["working", "available", "needs-attention", "idle", "error", "offline"];

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

const STORAGE_KEY = "scout.sprite.kept.v1";

function harnessHue(a: Agent): number {
  const base = HARNESS_HUE[a.harness] ?? HARNESS_FALLBACK;
  const jitter = makeRng(a.name).int(-1, 1) * 10; // gentle per-name spread within the family
  return (base + jitter + 360) % 360;
}

// ─── Page ────────────────────────────────────────────────────────────────
export default function SpriteFleetPage() {
  const [hueBy, setHueBy] = useState<"harness" | "name">("harness");
  const [rangeBy, setRangeBy] = useState<"state" | "flat">("state");

  // Ownership: kept = persisted claim (name → salt). draft = unsaved
  // preview while rerolling. salt 0 = the free default.
  const [kept, setKept] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [probe, setProbe] = useState("Sparrow");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setKept(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (next: Record<string, number>) => {
    setKept(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const saltOf = (name: string) => draft[name] ?? kept[name] ?? 0;
  const isDraft = (name: string) => name in draft && draft[name] !== (kept[name] ?? 0);
  const isKept = (name: string) => name in kept;

  const reroll = (name: string) => setDraft((d) => ({ ...d, [name]: saltOf(name) + 1 }));
  const keep = (name: string) => {
    persist({ ...kept, [name]: saltOf(name) });
    setDraft((d) => {
      const n = { ...d };
      delete n[name];
      return n;
    });
  };
  const release = (name: string) => {
    const n = { ...kept };
    delete n[name];
    persist(n);
    setDraft((d) => {
      const c = { ...d };
      delete c[name];
      return c;
    });
  };

  const propsFor = (a: Agent) => {
    const s = saltOf(a.name);
    return {
      hue: hueBy === "harness" ? harnessHue(a) : undefined,
      tone: rangeBy === "state" ? STATE_TONE[a.state] : undefined,
      salt: s ? String(s) : undefined,
    };
  };

  const keptList = Object.entries(kept);

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-9 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · sprite-fleet
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Sprite fleet
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          An agent's mark you can read at a glance — <span className="text-studio-ink">shape is who</span> (from the name),{" "}
          <span className="text-studio-ink">hue is the harness</span>, and <span className="text-studio-ink">brightness is
          state</span> (working is vivid; offline greys out). You get one for free, reroll to explore, and{" "}
          <span className="text-studio-ink">keep</span> the one you want — it's yours, and all that's stored is a tiny salt.
        </p>
      </header>

      {/* Controls */}
      <div className="mb-10 flex flex-wrap items-center gap-x-7 gap-y-3 rounded-md border border-studio-edge bg-studio-surface px-4 py-3">
        <Toggle label="hue" value={hueBy} onChange={setHueBy} options={[["harness", "Harness"], ["name", "Name"]]} />
        <Toggle label="range" value={rangeBy} onChange={setRangeBy} options={[["state", "State"], ["flat", "Flat"]]} />
        <span className="font-mono text-[9.5px] text-studio-ink-faint">
          shape always = the name · hue + range are the knobs
        </span>
      </div>

      {/* 00 — The mapping matrix */}
      <Section label="00 · The mapping" hint="hue down the rows (harness) · brightness across (state)">
        <div className="overflow-x-auto rounded-md border border-studio-edge bg-studio-surface p-1">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                  harness ↓ / state →
                </th>
                {MATRIX_STATES.map((s) => (
                  <th key={s} className="px-2 py-2 text-center font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                    {STATE_LABEL[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HARNESSES.map((h) => (
                <tr key={h.id} className="border-t border-studio-edge">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: `oklch(0.72 0.15 ${HARNESS_HUE[h.id]})` }} />
                      <span className="font-mono text-[11px] text-studio-ink">{h.id}</span>
                    </div>
                  </td>
                  {MATRIX_STATES.map((s) => (
                    <td key={s} className="px-2 py-2 text-center">
                      <div className="inline-grid place-items-center">
                        <SpriteAvatar name={h.rep} size={44} hue={HARNESS_HUE[h.id]} tone={STATE_TONE[s]} glow={false} />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 font-mono text-[9.5px] text-studio-ink-faint">
          one creature per row (shape held constant) so you read the color change · same name → same shape, always
        </div>
      </Section>

      {/* 01 — The fleet, with reroll + keep */}
      <Section label="01 · Your fleet" hint="reroll to explore · keep to claim · it persists">
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 rounded-md border border-studio-edge bg-studio-surface p-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {FLEET.map((a) => {
            const drafting = isDraft(a.name);
            const claimed = isKept(a.name);
            const salt = saltOf(a.name);
            return (
              <div key={a.name} className="flex flex-col items-center gap-2">
                <div className="relative">
                  <SpriteAvatar name={a.name} size={84} tile {...propsFor(a)} />
                  {claimed && !drafting && (
                    <span
                      title="kept"
                      className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-scout-accent font-mono text-[9px] text-studio-canvas"
                    >
                      ✓
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="font-sans text-[12px] text-studio-ink">{a.name}</div>
                  <div className="flex items-center gap-1.5">
                    <MiniBtn onClick={() => reroll(a.name)} title="reroll — a new creature">↻</MiniBtn>
                    {(drafting || (!claimed && salt === 0)) && (
                      <MiniBtn onClick={() => keep(a.name)} accent title="keep this one">keep</MiniBtn>
                    )}
                    {claimed && (
                      <MiniBtn onClick={() => release(a.name)} title="release the claim">✕</MiniBtn>
                    )}
                  </div>
                  <div className="font-mono text-[8.5px] text-studio-ink-faint">
                    {drafting ? `draft · v${salt}` : claimed ? `kept · v${salt}` : "free"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* 02 — Claimed identity / the data model */}
      <Section label="02 · Claimed identity" hint="one free · reroll · keep — and all that's stored is a salt">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <ul className="flex flex-col justify-center gap-2 font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
            <li><span className="text-studio-ink">One for free.</span> A brand-new agent already has a creature — the name's default (salt 0). Nothing to pick.</li>
            <li><span className="text-studio-ink">Reroll.</span> Don't love it? Cycle variants until one feels right. Still nothing stored.</li>
            <li><span className="text-studio-ink">Keep.</span> Claim the one you want and it's yours — persisted, and it follows the agent everywhere.</li>
            <li><span className="text-studio-ink">Tiny footprint.</span> The agent row stores one field — the salt. Shape, hue family, and range stay fully derived.</li>
          </ul>
          <div className="rounded-md border border-studio-edge bg-studio-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">claimed · localStorage</span>
              {keptList.length > 0 && (
                <button
                  onClick={() => persist({})}
                  className="focus-ring rounded-sm border border-studio-edge px-2 py-0.5 font-mono text-[9.5px] text-studio-ink-faint transition-colors hover:bg-studio-canvas-alt hover:text-studio-ink"
                >
                  reset all
                </button>
              )}
            </div>
            {keptList.length === 0 ? (
              <div className="font-mono text-[11px] text-studio-ink-faint">
                nothing claimed yet — reroll a creature above and hit <span className="text-studio-ink">keep</span>.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {keptList.map(([name, salt]) => {
                  const a = FLEET.find((f) => f.name === name);
                  return (
                    <div key={name} className="flex items-center gap-2.5 font-mono text-[11px]">
                      {a ? <SpriteAvatar name={name} size={22} {...propsFor(a)} /> : <SpriteAvatar name={name} size={22} salt={salt ? String(salt) : undefined} />}
                      <span className="text-studio-ink">{name}</span>
                      <span className="text-studio-ink-faint">{`{ salt: ${salt} }`}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* 03 — Legibility ramp */}
      <Section label="03 · Legibility" hint="16 → 160px · the face has to survive a roster bullet">
        <div className="flex flex-wrap items-end gap-7 rounded-md border border-studio-edge bg-studio-surface p-6">
          {[16, 20, 24, 32, 48, 96, 160].map((s) => (
            <div key={s} className="flex flex-col items-center gap-2">
              <SpriteAvatar name="Scout" size={s} {...propsFor(FLEET[0])} />
              <span className="font-mono text-[9px] text-studio-ink-faint">{s}px</span>
            </div>
          ))}
        </div>
      </Section>

      {/* 04 — In context */}
      <Section label="04 · In our designs" hint="the same avatar, every real surface, at true size">
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Roster · comfortable">
            {FLEET.slice(0, 5).map((a) => (
              <RosterRow key={a.name} agent={a} density="comfortable" props={propsFor(a)} />
            ))}
          </Panel>
          <Panel title="Roster · manifest (ops/tail)">
            {FLEET.slice(0, 6).map((a) => (
              <RosterRow key={a.name} agent={a} density="manifest" props={propsFor(a)} />
            ))}
          </Panel>
          <Panel title="Agent card">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FLEET.slice(0, 2).map((a) => (
                <AgentCard key={a.name} agent={a} props={propsFor(a)} />
              ))}
            </div>
          </Panel>
          <Panel title="Agents tree">
            <TreeNode label="openscout" depth={0} />
            {FLEET.slice(0, 4).map((a, i) => (
              <TreeLeaf key={a.name} agent={a} last={i === 3} props={propsFor(a)} />
            ))}
          </Panel>
          <Panel title="iOS · Agents">
            <div className="mx-auto w-[300px] rounded-[28px] border border-studio-edge-strong bg-studio-canvas p-3 shadow-lg">
              <div className="mb-2 px-1 font-display text-[15px] text-studio-ink">Agents</div>
              {FLEET.slice(0, 5).map((a) => (
                <IosRow key={a.name} agent={a} props={propsFor(a)} />
              ))}
            </div>
          </Panel>
          <Panel title="Comms · avatar-led turns">
            {FLEET.slice(1, 4).map((a, i) => (
              <CommsTurn key={a.name} agent={a} props={propsFor(a)} body={COMMS_LINES[i]} />
            ))}
          </Panel>
        </div>
      </Section>

      {/* 05 — Any name */}
      <Section label="05 · Any name" hint="unknown agents still get a stable creature from the curated hash">
        <div className="flex flex-wrap items-center gap-5 rounded-md border border-studio-edge bg-studio-surface p-6">
          <SpriteAvatar name={probe || " "} size={96} tile tone={STATE_TONE.working} />
          <div className="flex flex-col gap-2">
            <input
              value={probe}
              onChange={(e) => setProbe(e.target.value)}
              spellCheck={false}
              className="focus-ring w-[220px] rounded-sm border border-studio-edge bg-studio-canvas px-3 py-1.5 font-mono text-[13px] text-studio-ink outline-none"
              placeholder="any agent name…"
            />
            <div className="flex flex-wrap gap-1.5">
              {["Sparrow", "Mongoose", "Tycho", "Wren", "Juno", "Bishop"].map((n) => (
                <button
                  key={n}
                  onClick={() => setProbe(n)}
                  className="focus-ring rounded-sm border border-studio-edge px-2 py-1 font-mono text-[10.5px] text-studio-ink-faint transition-colors hover:bg-studio-canvas-alt hover:text-studio-ink"
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="font-mono text-[9.5px] text-studio-ink-faint">
              seed 0x{makeRng(probe || " ").seed.toString(16).padStart(8, "0")} · the name is the seed
            </div>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <section className="mt-14 max-w-prose border-t border-studio-edge pt-6">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">· source · next</div>
        <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-studio-ink-faint">
          <li><span className="text-studio-ink">components/SpriteAvatar.tsx</span> — the drop-in avatar (hue · tone · salt)</li>
          <li><span className="text-studio-ink">lib/agent-identity.ts</span> — spriteFor(name, {`{ hue, tone, salt }`})</li>
          <li className="pt-1 text-studio-ink-faint">port → add an `identitySalt` field on the agent record · web AgentRow/AgentCard · then SwiftUI</li>
        </ul>
      </section>
    </main>
  );
}

const COMMS_LINES = [
  "PR #214 is green — inspector atoms landed, no regressions in the tail.",
  "Need a decision on flight 0c8f before I restart the broker on archie.",
  "Tail watcher is quiet. Standing by; ping if you want a deeper sweep.",
];

type AvatarProps = { hue?: number; tone?: Tone; salt?: string };

// ─── In-context replicas ─────────────────────────────────────────────────

function RosterRow({ agent, density, props }: { agent: Agent; density: "comfortable" | "manifest"; props: AvatarProps }) {
  const color = STATE_COLOR[agent.state];
  const dim = agent.state === "offline";
  if (density === "manifest") {
    return (
      <div className="flex items-center gap-3 border-b border-studio-edge px-1 py-1.5 last:border-b-0" style={{ opacity: dim ? 0.6 : 1 }}>
        <SpriteAvatar name={agent.name} size={18} glow={false} {...props} />
        <span className="w-[72px] shrink-0 font-sans text-[12.5px] text-studio-ink">{agent.name}</span>
        <span className="w-[92px] shrink-0 font-mono text-[10px] uppercase tracking-eyebrow" style={{ color }}>
          {STATE_LABEL[agent.state]}
        </span>
        <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-studio-ink-faint">{agent.task}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 rounded-sm px-1.5 py-1.5" style={{ opacity: dim ? 0.6 : 1 }}>
      <SpriteAvatar
        name={agent.name}
        size={28}
        tile
        glow={false}
        corner={color}
        cornerPulse={agent.state === "working"}
        {...props}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-sans text-[12.5px] text-studio-ink">{agent.name}</span>
        <span className="truncate font-mono text-[10px]" style={{ color }}>
          {STATE_LABEL[agent.state]}
          <span className="text-studio-ink-faint"> · {agent.task}</span>
        </span>
      </div>
    </div>
  );
}

function AgentCard({ agent, props }: { agent: Agent; props: AvatarProps }) {
  const color = STATE_COLOR[agent.state];
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-studio-edge bg-studio-canvas p-3">
      <div className="flex items-center gap-2.5">
        <SpriteAvatar name={agent.name} size={44} tile {...props} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate font-sans text-[14px] font-semibold tracking-tight text-studio-ink">{agent.name}</span>
            <span className="font-mono text-[10px] text-studio-ink-faint">{agent.handle}</span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-eyebrow" style={{ color }}>{STATE_LABEL[agent.state]}</span>
        </div>
      </div>
      <div className="font-sans text-[12px] leading-snug text-studio-ink-faint">{agent.task}</div>
      <div className="flex gap-1.5">
        <Tag>{agent.cls}</Tag>
        <Tag>{agent.harness}</Tag>
      </div>
    </div>
  );
}

function TreeNode({ label, depth }: { label: string; depth: number }) {
  return (
    <div className="flex items-center gap-2 py-1 font-mono text-[12px] text-studio-ink-muted" style={{ paddingLeft: depth * 16 }}>
      <span className="text-studio-ink-faint">▾</span>
      {label}
    </div>
  );
}

function TreeLeaf({ agent, last, props }: { agent: Agent; last: boolean; props: AvatarProps }) {
  const color = STATE_COLOR[agent.state];
  return (
    <div className="flex items-center gap-2 py-1 pl-4">
      <span className="select-none font-mono text-[12px] text-studio-edge-strong">{last ? "└─" : "├─"}</span>
      <SpriteAvatar name={agent.name} size={20} glow={false} {...props} />
      <span className="font-sans text-[12.5px] text-studio-ink">{agent.name}</span>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span className="truncate font-mono text-[10px] text-studio-ink-faint">{agent.task}</span>
    </div>
  );
}

function IosRow({ agent, props }: { agent: Agent; props: AvatarProps }) {
  const color = STATE_COLOR[agent.state];
  return (
    <div className="flex items-center gap-3 border-b border-studio-edge px-1 py-2 last:border-b-0">
      <SpriteAvatar name={agent.name} size={34} tile {...props} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-sans text-[14px] text-studio-ink">{agent.name}</span>
        <span className="truncate font-mono text-[10.5px] text-studio-ink-faint">{agent.task}</span>
      </div>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
    </div>
  );
}

function CommsTurn({ agent, body, props }: { agent: Agent; body: string; props: AvatarProps }) {
  return (
    <div className="flex gap-2.5 py-2">
      <SpriteAvatar name={agent.name} size={32} {...props} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <span className="font-sans text-[12.5px] font-semibold text-studio-ink">{agent.name}</span>
          <span className="font-mono text-[9.5px] text-studio-ink-faint">{agent.handle}</span>
        </div>
        <p className="mt-0.5 font-sans text-[12.5px] leading-snug text-studio-ink-muted">{body}</p>
      </div>
    </div>
  );
}

// ─── Chrome ──────────────────────────────────────────────────────────────

function Toggle<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">{label}</span>
      <div className="flex gap-1">
        {options.map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={[
              "focus-ring rounded-sm border px-2.5 py-1 font-mono text-[11px] transition-colors",
              value === v
                ? "border-transparent bg-scout-accent-soft text-studio-ink"
                : "border-studio-edge text-studio-ink-faint hover:bg-studio-canvas-alt hover:text-studio-ink",
            ].join(" ")}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

function MiniBtn({
  children,
  onClick,
  title,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        "focus-ring rounded-sm border px-1.5 py-0.5 font-mono text-[9.5px] transition-colors",
        accent
          ? "border-transparent bg-scout-accent-soft text-studio-ink hover:bg-scout-accent hover:text-studio-canvas"
          : "border-studio-edge text-studio-ink-faint hover:bg-studio-canvas-alt hover:text-studio-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface p-3">
      <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">· {title}</div>
      {children}
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
