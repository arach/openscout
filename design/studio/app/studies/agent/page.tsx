/**
 * Agent Vocabulary — consolidated study.
 *
 * Every visible form an agent takes in the scout web client, gathered
 * onto one page so the vocabulary is auditable in a single scroll.
 * Each section pairs a real component (extracted to `components/Agent*`)
 * with a "lifted from" footnote pointing at the production source.
 *
 * Sections:
 *   1. Identity block          standalone + inspector context
 *   2. Presence dot            6 states × 3 treatments
 *   3. Row densities           comfortable / compact / manifest
 *   4. Card tile               4 card states
 *   5. Mention chip            in prose, in a list, standalone
 *   6. Observe stats matrix    2×4 trace metrics grid
 *   7. Incoming ask card       amber awaiting state
 *   8. Presence mesh           static radial topology
 *
 * Static mock data — no broker connection.
 */
import {
  AGENT_STATE_COLOR,
  AGENT_STATE_LABEL,
  AgentPresenceDot,
  type AgentState,
} from "@/components/AgentPresenceDot";
import { AgentRow, avatarColor, type AgentRowAgent } from "@/components/AgentRow";
import { AgentCard, type AgentCardAgent } from "@/components/AgentCard";
import { AgentMentionChip } from "@/components/AgentMentionChip";
import { ObserveStatsMatrix } from "@/components/ObserveStatsMatrix";
import { AgentAskAlertCard } from "@/components/AgentAskAlertCard";
import { AgentPresenceMesh } from "@/components/AgentPresenceMesh";

// ─── Shared types re-exported for downstream studies ───────────────────
export type { AgentState } from "@/components/AgentPresenceDot";
export interface Agent {
  id: string;
  name: string;
  handle: string;
  state: AgentState;
  task?: string;
  updatedAgo: string;
}

// ─── Mock data ─────────────────────────────────────────────────────────
const ROW_AGENTS: AgentRowAgent[] = [
  { id: "scout", name: "Scout", state: "working", task: "indexing channel.shared", updatedAgo: "2s" },
  { id: "hudson", name: "Hudson", state: "working", task: "reviewing PR #214", updatedAgo: "11s" },
  { id: "qb", name: "QB", state: "needs-attention", task: "awaiting decision on flight 0c8f", updatedAgo: "1m" },
  { id: "cody", name: "Cody", state: "available", task: "idle, ready to dispatch", updatedAgo: "4m" },
  { id: "ranger", name: "Ranger", state: "idle", task: "tail watcher", updatedAgo: "18m" },
  { id: "vox", name: "Vox", state: "error", task: "TTS provider auth failed", updatedAgo: "32m" },
  { id: "atlas", name: "Atlas", state: "offline", updatedAgo: "2h" },
];

const CARD_AGENTS: AgentCardAgent[] = [
  {
    id: "hudson",
    name: "Hudson",
    handle: "@hudson",
    state: "working",
    task: "Reviewing PR #214 — inspector atom rollout",
    taskProgress: 0.62,
    project: { repo: "openscout", branch: "atoms/inspector-section", cwd: "packages/web/client/scout/inspector" },
    harness: "claude-code",
    model: "opus-4.7",
    tools: ["bash", "edit", "grep", "ToolSearch"],
    lastTouched: "12s",
    unread: 2,
  },
  {
    id: "qb",
    name: "QB",
    handle: "@qb",
    state: "needs-attention",
    task: "Awaiting decision on flight 0c8fee",
    project: { repo: "openscout", branch: "main", cwd: "packages/runtime" },
    harness: "codex",
    model: "gpt-5",
    tools: ["bash", "edit"],
    lastTouched: "1m",
    unread: 5,
  },
  {
    id: "scout",
    name: "Scout",
    handle: "@scout",
    state: "available",
    task: "idle, ready to dispatch",
    project: { repo: "openscout", branch: "main", cwd: "packages/web/client" },
    harness: "claude-code",
    model: "sonnet-4.6",
    tools: ["bash", "edit", "grep", "WebFetch"],
    lastTouched: "4m",
  },
  {
    id: "atlas",
    name: "Atlas",
    handle: "@atlas",
    state: "offline",
    project: { repo: "openscout", branch: "design/atlas-iconography" },
    harness: "claude-code",
    model: "opus-4.7",
    tools: ["bash", "edit"],
    lastTouched: "2h",
  },
];

const PRESENCE_STATES: AgentState[] = [
  "working",
  "available",
  "needs-attention",
  "idle",
  "offline",
  "error",
];

const MESH_PEERS: { name: string; state: AgentState }[] = [
  { name: "Scout", state: "working" },
  { name: "QB", state: "needs-attention" },
  { name: "Cody", state: "available" },
  { name: "Ranger", state: "idle" },
  { name: "Vox", state: "error" },
  { name: "Atlas", state: "offline" },
];

// ─── Page ──────────────────────────────────────────────────────────────
export default function AgentVocabularyPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-10 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agent
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent vocabulary
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Every visible form an agent takes in scout's web client, on one
          page. Each section pairs the canonical component with a footnote
          pointing at the production source it was lifted from. Toggle the
          sidebar theme to verify both palettes.
        </p>
      </header>

      {/* 1 — Identity block */}
      <Section
        label="01 · Identity block"
        hint="Avatar + name + handle + class + presence dot"
        liftedFrom="packages/web/client/scout/inspector/HomeAgentsInspector.tsx:69"
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen caption="Standalone">
            <IdentityBlock
              name="Hudson"
              handle="@hudson"
              role="Reviewer · claude-code"
              state="working"
            />
          </Specimen>
          <Specimen caption="Inside an inspector header">
            <div className="rounded-md border border-studio-edge bg-studio-surface p-3">
              <IdentityBlock
                name="QB"
                handle="@qb"
                role="Quarterback · codex"
                state="needs-attention"
              />
              <div className="mt-3 border-t border-studio-edge pt-2 font-mono text-[10px] text-studio-ink-faint">
                opened 1m ago · 5 unread
              </div>
            </div>
          </Specimen>
        </div>
      </Section>

      {/* 2 — Presence dot */}
      <Section
        label="02 · Presence dot"
        hint="Six agent states × three treatments"
        liftedFrom="packages/web/client/scout/inspector/HomeAgentsInspector.tsx:94"
      >
        <div className="overflow-hidden rounded-md border border-studio-edge bg-studio-surface">
          <div className="grid grid-cols-[160px_1fr_1fr_1fr] gap-4 border-b border-studio-edge px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            <div>State</div>
            <div>Bare</div>
            <div>With halo</div>
            <div>On avatar corner</div>
          </div>
          {PRESENCE_STATES.map((s) => (
            <div
              key={s}
              className="grid grid-cols-[160px_1fr_1fr_1fr] items-center gap-4 border-b border-studio-edge px-4 py-3 last:border-b-0"
            >
              <div>
                <div className="font-sans text-[12.5px] text-studio-ink">
                  {AGENT_STATE_LABEL[s]}
                </div>
                <code className="font-mono text-[9.5px] text-studio-ink-faint">
                  state: "{s}"
                </code>
              </div>
              <div>
                <AgentPresenceDot state={s} size="md" />
              </div>
              <div>
                <AgentPresenceDot state={s} size="md" withHalo />
              </div>
              <div>
                <AvatarWithCorner state={s} name="Hudson" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 3 — Row densities */}
      <Section
        label="03 · Row densities"
        hint="Same agent shape, three layouts"
        liftedFrom="design/studio/app/studies/agent-pulse/page.tsx + HomeAgentsInspector.tsx:69"
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <Specimen caption="Comfortable · roster default">
            <div className="rounded-md border border-studio-edge bg-studio-surface p-2">
              {ROW_AGENTS.map((a) => (
                <AgentRow key={a.id} agent={a} density="comfortable" />
              ))}
            </div>
          </Specimen>
          <Specimen caption="Compact · ~25 above the fold">
            <div className="rounded-md border border-studio-edge bg-studio-surface p-1">
              {ROW_AGENTS.map((a) => (
                <AgentRow key={a.id} agent={a} density="compact" />
              ))}
            </div>
          </Specimen>
          <Specimen caption="Manifest · ops + tail">
            <div className="rounded-md border border-studio-edge bg-studio-surface">
              {ROW_AGENTS.map((a) => (
                <AgentRow key={a.id} agent={a} density="manifest" />
              ))}
            </div>
          </Specimen>
        </div>
      </Section>

      {/* 4 — Card tile */}
      <Section
        label="04 · Card tile"
        hint="Five rows · identity · state · task · project · capabilities"
        liftedFrom="design/studio/app/studies/agent-cards/page.tsx (AgentCardView)"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {CARD_AGENTS.map((a, i) => (
            <AgentCard key={a.id} agent={a} selected={i === 0} />
          ))}
        </div>
      </Section>

      {/* 5 — Mention chip */}
      <Section
        label="05 · Mention chip"
        hint="Inline @-form for prose, lists, and standalone chips"
        liftedFrom="packages/web/client/scout/chat composer + mention rendering"
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <Specimen caption="In prose">
            <p className="font-sans text-[13.5px] leading-relaxed text-studio-ink">
              The PR was reviewed by{" "}
              <AgentMentionChip agent={{ name: "Hudson", handle: "hudson" }} />{" "}
              and merged after{" "}
              <AgentMentionChip agent={{ name: "QB", handle: "qb" }} /> signed
              off on flight 0c8f.
            </p>
          </Specimen>
          <Specimen caption="Attendees row">
            <div className="rounded-md border border-studio-edge bg-studio-surface px-3 py-2">
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
                attendees · 4
              </div>
              <div className="flex flex-wrap gap-1.5">
                <AgentMentionChip agent={{ name: "Hudson", handle: "hudson" }} />
                <AgentMentionChip agent={{ name: "Scout", handle: "scout" }} />
                <AgentMentionChip agent={{ name: "QB", handle: "qb" }} />
                <AgentMentionChip agent={{ name: "Cody", handle: "cody" }} />
              </div>
            </div>
          </Specimen>
          <Specimen caption="Standalone · size variants">
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
                  md
                </span>
                <AgentMentionChip agent={{ name: "Hudson", handle: "hudson" }} />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
                  sm
                </span>
                <AgentMentionChip
                  agent={{ name: "Hudson", handle: "hudson" }}
                  size="sm"
                />
              </div>
            </div>
          </Specimen>
        </div>
      </Section>

      {/* 6 — Observe stats matrix */}
      <Section
        label="06 · Observe stats matrix"
        hint="2×N trace-metric grid from the agent inspector"
        liftedFrom="packages/web/client/scout/inspector/AgentsInspector.tsx:344-356"
      >
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <Specimen caption="Live agent · Hudson">
            <ObserveStatsMatrix
              metrics={[
                { label: "Turns", value: 42 },
                { label: "Tools", value: 318 },
                { label: "Thinks", value: 19 },
                { label: "Asks", value: 4 },
                { label: "Reads", value: 87 },
                { label: "Edits", value: 23 },
                { label: "Files", value: 31 },
                { label: "Window", value: "1h 12m" },
              ]}
            />
          </Specimen>
          <Specimen caption="Annotations">
            <ul className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
              <li>
                <span className="text-studio-ink">2-column grid</span> at every
                breakpoint — the surface lives in the right inspector rail at
                ~260px wide, so columns never expand.
              </li>
              <li>
                <span className="text-studio-ink">Display font</span> for the
                numeric value gives the matrix a "scoreboard" texture.
              </li>
              <li>
                <span className="text-studio-ink">Window</span> is the only
                cell that may overflow the numeric assumption; the cell
                tolerates a short string like "1h 12m" or "—".
              </li>
            </ul>
          </Specimen>
        </div>
      </Section>

      {/* 7 — Incoming ask card */}
      <Section
        label="07 · Incoming ask card"
        hint="Amber awaiting state with origin breadcrumb"
        liftedFrom="packages/web/client/scout/inspector/AgentsInspector.tsx:606-631"
      >
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          <AgentAskAlertCard
            task="Decide whether to land the InspectorSection atom into scout, or hold for the cross-screen audit. Hudson opened the PR; needs human routing."
            from={{ harness: "claude-code", agent: "Hudson" }}
            updatedAgo="38s"
          />
          <AgentAskAlertCard
            task="Confirm DB migration order before broker restart on archie. Two unsynced rows in fleet.snapshot."
            from={{ harness: "codex", agent: "QB" }}
            updatedAgo="2m"
          />
          <AgentAskAlertCard
            task="Pick a name for the meta agent before tomorrow's iOS build cut. Robot-head icon stays either way."
            from={{ harness: "claude-code", agent: "Scout" }}
            updatedAgo="14m"
          />
        </div>
      </Section>

      {/* 8 — Presence mesh */}
      <Section
        label="08 · Presence mesh"
        hint="Radial SVG topology — focus at center, peers orbiting"
        liftedFrom="packages/web/client/scout/inspector/AgentsInspector.tsx:433-584"
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Specimen caption="Focus · Hudson">
            <div className="rounded-md border border-studio-edge bg-studio-surface p-3">
              <AgentPresenceMesh focus={{ name: "Hudson" }} peers={MESH_PEERS} />
            </div>
          </Specimen>
          <Specimen caption="Notes">
            <ul className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
              <li>
                <span className="text-studio-ink">240×180 viewBox</span>,
                scaled with <code className="font-mono text-[11px]">width="100%"</code>{" "}
                so the mesh fills whatever rail it lands in.
              </li>
              <li>
                <span className="text-studio-ink">Peer ring color</span>{" "}
                follows {`var(--status-*)`} — active peers gain a faint outer
                ring to telegraph movement without animation.
              </li>
              <li>
                <span className="text-studio-ink">Production version</span>{" "}
                adds <code className="font-mono text-[11px]">{`<animateMotion>`}</code>{" "}
                pulses along each connection line; this study is static.
              </li>
            </ul>
          </Specimen>
        </div>
      </Section>

      {/* Footer */}
      <section className="mt-16 max-w-prose border-t border-studio-edge pt-6">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · components
        </div>
        <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-studio-ink-faint">
          <li><span className="text-studio-ink">components/AgentPresenceDot.tsx</span> — colored dot, 3 sizes, optional halo</li>
          <li><span className="text-studio-ink">components/AgentRow.tsx</span> — agent row in 3 densities</li>
          <li><span className="text-studio-ink">components/AgentCard.tsx</span> — info-dense 5-row tile</li>
          <li><span className="text-studio-ink">components/AgentMentionChip.tsx</span> — inline @mention chip</li>
          <li><span className="text-studio-ink">components/ObserveStatsMatrix.tsx</span> — 2×N metric grid</li>
          <li><span className="text-studio-ink">components/AgentAskAlertCard.tsx</span> — amber awaiting card</li>
          <li><span className="text-studio-ink">components/AgentPresenceMesh.tsx</span> — radial mesh SVG</li>
        </ul>
      </section>
    </main>
  );
}

// ─── Local helpers (study-only chrome) ─────────────────────────────────

function Section({
  label,
  hint,
  liftedFrom,
  children,
}: {
  label: string;
  hint: string;
  liftedFrom: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-14">
      <div className="mb-4 flex items-baseline gap-3">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          {label}
        </div>
        <div className="font-mono text-[10px] text-studio-ink-faint">{hint}</div>
        <div className="ml-3 h-px flex-1 bg-studio-edge" />
      </div>
      {children}
      <div className="mt-3 font-mono text-[9.5px] text-studio-ink-faint">
        lifted from <code className="text-studio-ink-muted">{liftedFrom}</code>
      </div>
    </section>
  );
}

function Specimen({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {caption}
      </div>
      {children}
    </div>
  );
}

function IdentityBlock({
  name,
  handle,
  role,
  state,
}: {
  name: string;
  handle: string;
  role: string;
  state: AgentState;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full font-mono text-[14px]"
        style={{
          background: avatarColor(name),
          color: "var(--studio-canvas)",
        }}
      >
        {name[0]?.toUpperCase()}
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-baseline gap-2">
          <span className="font-sans text-[15px] font-semibold tracking-tight text-studio-ink">
            {name}
          </span>
          <span className="font-mono text-[10.5px] text-studio-ink-faint">
            {handle}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <AgentPresenceDot state={state} size="sm" withHalo={state === "working"} />
          <span
            className="font-mono text-[10px] uppercase tracking-eyebrow"
            style={{ color: AGENT_STATE_COLOR[state] }}
          >
            {AGENT_STATE_LABEL[state]}
          </span>
          <span className="font-mono text-[10px] text-studio-ink-faint">
            · {role}
          </span>
        </div>
      </div>
    </div>
  );
}

function AvatarWithCorner({ state, name }: { state: AgentState; name: string }) {
  return (
    <div className="inline-flex">
      <div
        className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[11px]"
        style={{
          background: avatarColor(name),
          color: "var(--studio-canvas)",
        }}
      >
        {name[0]?.toUpperCase()}
        <span
          className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2"
          style={{
            background: AGENT_STATE_COLOR[state],
            boxShadow: `0 0 0 2px var(--studio-surface)`,
          }}
        />
      </div>
    </div>
  );
}
