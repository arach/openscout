/**
 * Inspector System — the IA-level design for the Scout right-rail
 * inspector. The grammar study (/studies/inspector-grammar) defines
 * the chrome (title rule, status badge, section title, spacing); this
 * study defines the *contents* — the block library, the composition
 * rules, and the canonical entity model.
 *
 * What this page is
 * -----------------
 * §1  Block library.   The named set of blocks every inspector is
 *                      composed from. Each block has a visual
 *                      specimen, a data contract, and a list of
 *                      inspectors that use it.
 * §2  Composition.     How blocks are ordered, what's conditional,
 *                      how width and rhythm work.
 * §3  Entity model.    The canonical `InspectorEntity` shape every
 *                      block reads from. ScoutChannel, ScoutAgent,
 *                      ScoutRepo, and ScoutTailEvent all conform.
 * §4  Comms as a       The Comms inspector as a concrete composition
 *      composition     from the library.
 * §5  Other            The Agents / Repos / Tail inspectors as
 *      compositions    compositions, for comparison.
 * §6  Open questions.
 *
 * The /studies/scout-comms-inspector study is the visual spec for
 * the Comms composition; this study is the IA spec that the visual
 * is built on.
 *
 * Status: draft.
 */

import { EyebrowLabel } from "@/components/EyebrowLabel";

/* ────────────────────────────────────────────────────────────────────
   §1 — Block library
   ──────────────────────────────────────────────────────────────────── */

type BlockKey =
  | "identity"
  | "status"
  | "action-row"
  | "key-value"
  | "project"
  | "session"
  | "worktrees"
  | "changes"
  | "attached"
  | "conversation"
  | "ask"
  | "stats"
  | "tracks"
  | "description";

interface BlockSpec {
  key: BlockKey;
  name: string;
  purpose: string;
  /** Which inspector surfaces compose this block into their inspector. */
  usedBy: ("comms" | "agents" | "repos" | "tail")[];
  /** Fields the block reads from the InspectorEntity. */
  reads: string[];
  /** Whether the block is conditional on data being present. */
  conditional: boolean;
  /** How the block renders. Composed as React in §4 / §5. */
  render: () => React.ReactNode;
}

const BLOCKS: BlockSpec[] = [
  {
    key: "identity",
    name: "Identity",
    purpose: "The entity's name, ID, and avatar. Every inspector leads with this.",
    usedBy: ["comms", "agents", "repos"],
    reads: ["name", "agentId", "avatar"],
    conditional: false,
    render: IdentitySpecimen,
  },
  {
    key: "status",
    name: "Status",
    purpose: "Filled tinted pill in the title row. Tone changes, weight doesn't.",
    usedBy: ["comms", "agents", "repos", "tail"],
    reads: ["state"],
    conditional: false,
    render: StatusSpecimen,
  },
  {
    key: "action-row",
    name: "Action row",
    purpose: "Primary filled CTA + secondary ghost. Render only when there's a primary action.",
    usedBy: ["comms", "agents", "repos"],
    reads: ["actions[].primary", "actions[].secondary"],
    conditional: true,
    render: ActionRowSpecimen,
  },
  {
    key: "key-value",
    name: "Key-value",
    purpose: "Stacked label-on-top, value right-aligned. The atomic data display.",
    usedBy: ["comms", "agents", "repos", "tail"],
    reads: ["rows[].label", "rows[].value"],
    conditional: false,
    render: KeyValueSpecimen,
  },
  {
    key: "project",
    name: "Project",
    purpose: "Repo + branch + path. The 'where is this work happening' block.",
    usedBy: ["comms", "agents", "repos"],
    reads: ["project.repo", "project.branch", "project.path"],
    conditional: true,
    render: ProjectSpecimen,
  },
  {
    key: "session",
    name: "Session",
    purpose: "Live session id + age + Observe action. Agents-only for now.",
    usedBy: ["agents"],
    reads: ["session.id", "session.started", "session.observed"],
    conditional: true,
    render: SessionSpecimen,
  },
  {
    key: "worktrees",
    name: "Worktrees",
    purpose: "Total + dirty worktree count. Repos-specific.",
    usedBy: ["repos"],
    reads: ["worktrees.total", "worktrees.dirty"],
    conditional: false,
    render: WorktreesSpecimen,
  },
  {
    key: "changes",
    name: "Changes",
    purpose: "Staged / unstaged / untracked counts. Repos-specific.",
    usedBy: ["repos"],
    reads: ["changes.staged", "changes.unstaged", "changes.untracked"],
    conditional: false,
    render: ChangesSpecimen,
  },
  {
    key: "attached",
    name: "Attached",
    purpose: "Agents + sessions attached to the entity. Repos-specific.",
    usedBy: ["repos"],
    reads: ["attached.agents", "attached.sessions"],
    conditional: false,
    render: AttachedSpecimen,
  },
  {
    key: "conversation",
    name: "Conversation",
    purpose: "Last activity + unread + channel/DM. Comms-specific.",
    usedBy: ["comms"],
    reads: ["conversation.last", "conversation.unread", "conversation.kind"],
    conditional: false,
    render: ConversationSpecimen,
  },
  {
    key: "ask",
    name: "Ask",
    purpose: "Pending or answered ask with author + body. Comms-specific today; reusable.",
    usedBy: ["comms"],
    reads: ["ask.state", "ask.from", "ask.text"],
    conditional: true,
    render: AskSpecimen,
  },
  {
    key: "stats",
    name: "Stats",
    purpose: "2×2 stat callouts (label-on-top, big number below). Used when a number is the point.",
    usedBy: ["tail", "repos"],
    reads: ["stats[].label", "stats[].value"],
    conditional: false,
    render: StatsSpecimen,
  },
  {
    key: "tracks",
    name: "Tracks",
    purpose: "Labelled list with descriptions. Tail's per-track block, reusable for any 'categories of X' surface.",
    usedBy: ["tail"],
    reads: ["tracks[].label", "tracks[].description"],
    conditional: false,
    render: TracksSpecimen,
  },
  {
    key: "description",
    name: "Description",
    purpose: "Faint mono one-liner under a section title. Used when a section needs a definition.",
    usedBy: ["comms", "agents", "repos", "tail"],
    reads: ["description"],
    conditional: true,
    render: DescriptionSpecimen,
  },
];

/* ────────────────────────────────────────────────────────────────────
   Block specimens — small visual artifacts for §1.
   Each renders a representative slice of the block in isolation.
   ──────────────────────────────────────────────────────────────────── */

function IdentitySpecimen() {
  return (
    <Specimen>
      <div className="flex items-center gap-2">
        <div className="grid h-[26px] w-[26px] place-items-center rounded-full bg-studio-canvas-alt font-mono text-[11px] text-studio-ink">
          D
        </div>
        <div>
          <div className="font-sans text-[13.5px] font-semibold leading-tight tracking-tight text-studio-ink">
            Dewey
          </div>
          <div className="font-mono text-[9.5px] text-studio-ink-faint">
            dewey.main.arts-mac-mini-local
          </div>
        </div>
      </div>
    </Specimen>
  );
}

function StatusSpecimen() {
  return (
    <Specimen>
      <div className="flex flex-wrap items-center gap-2">
        {(["ok", "warn", "error", "info", "neutral"] as const).map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-eyebrow"
            style={{
              background: `var(--status-${t}-bg)`,
              color: `var(--status-${t}-fg)`,
            }}
          >
            <span className="block h-1.5 w-1.5 rounded-full bg-current" />
            {t}
          </span>
        ))}
      </div>
    </Specimen>
  );
}

function ActionRowSpecimen() {
  return (
    <Specimen>
      <div className="flex items-center gap-1.5">
        <span
          className="rounded-[5px] border px-2.5 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow"
          style={{
            background: "var(--scout-accent-soft)",
            borderColor: "var(--scout-accent)",
            color: "var(--scout-accent)",
          }}
        >
          Open
        </span>
        <span className="rounded-[5px] border border-studio-edge bg-transparent px-2.5 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
          + New
        </span>
      </div>
    </Specimen>
  );
}

function KeyValueSpecimen() {
  return (
    <Specimen>
      <div className="flex flex-col gap-1.5">
        {[
          ["Role", "Relay agent"],
          ["Harness", "claude"],
          ["Transport", "claude_stream_json"],
        ].map(([k, v]) => (
          <div key={k} className="grid grid-cols-[64px_1fr] items-baseline gap-x-2">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              {k}
            </span>
            <span className="truncate text-right font-mono text-[10.5px] text-studio-ink-muted">
              {v}
            </span>
          </div>
        ))}
      </div>
    </Specimen>
  );
}

function ProjectSpecimen() {
  return (
    <Specimen>
      <div className="flex flex-col gap-1.5">
        <SecTitle />
        <KV k="Repo" v="dewey" />
        <KV k="Branch" v="main" />
        <KV k="Path" v="~/dev/dewey" />
      </div>
    </Specimen>
  );
}

function SessionSpecimen() {
  return (
    <Specimen>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <SecTitle label="Session" />
          <span className="rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
            ◉ Observe
          </span>
        </div>
        <KV k="Id" v="relay-action-claude" />
        <KV k="Active" v="1d" />
      </div>
    </Specimen>
  );
}

function WorktreesSpecimen() {
  return (
    <Specimen>
      <div className="flex flex-col gap-1.5">
        <SecTitle label="Worktrees" />
        <KV k="Total" v="1" />
        <KV k="Dirty" v="1" vColor="var(--status-warn-fg)" />
      </div>
    </Specimen>
  );
}

function ChangesSpecimen() {
  return (
    <Specimen>
      <div className="flex flex-col gap-1.5">
        <SecTitle label="Changes" />
        <KV k="Staged" v="0" />
        <KV k="Unstaged" v="2" vColor="var(--status-warn-fg)" />
        <KV k="Untracked" v="0" />
      </div>
    </Specimen>
  );
}

function AttachedSpecimen() {
  return (
    <Specimen>
      <div className="flex flex-col gap-1.5">
        <SecTitle label="Attached" />
        <KV k="Agents" v="2" />
        <KV k="Sessions" v="2" />
      </div>
    </Specimen>
  );
}

function ConversationSpecimen() {
  return (
    <Specimen>
      <div className="flex flex-col gap-1.5">
        <SecTitle label="Conversation" />
        <KV k="Last" v="2m" />
        <KV k="Unread" v="2" vColor="var(--status-info-fg)" />
        <KV k="Kind" v="DM" />
      </div>
    </Specimen>
  );
}

function AskSpecimen() {
  return (
    <Specimen>
      <div className="flex flex-col gap-1.5">
        <SecTitle label="Ask" />
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span
              className="rounded-[2px] px-1 py-px font-mono text-[7.5px] font-semibold uppercase tracking-eyebrow"
              style={{ background: "var(--status-warn-bg)", color: "var(--status-warn-fg)" }}
            >
              pending
            </span>
            <span className="font-mono text-[8.5px] text-studio-ink-faint">from Art</span>
          </div>
          <div className="font-sans text-[10.5px] leading-snug text-studio-ink-muted">
            Review AgentHomeShellView — should overlay settings render before send?
          </div>
        </div>
      </div>
    </Specimen>
  );
}

function StatsSpecimen() {
  return (
    <Specimen>
      <div className="grid grid-cols-2 gap-1.5">
        {[
          ["Logs", "40"],
          ["Processes", "19"],
          ["Sessions", "4"],
          ["Buffered", "700"],
        ].map(([k, v]) => (
          <div
            key={k}
            className="rounded-[5px] border border-studio-edge bg-studio-canvas-alt px-2.5 py-1.5"
          >
            <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              {k}
            </div>
            <div className="mt-0.5 font-mono text-[18px] font-medium tabular-nums leading-none text-studio-ink">
              {v}
            </div>
          </div>
        ))}
      </div>
    </Specimen>
  );
}

function TracksSpecimen() {
  return (
    <Specimen>
      <div className="flex flex-col gap-1.5">
        <SecTitle label="Tracks" />
        {[
          ["Transcript logs", "Claude and Codex JSONL files discovered on disk."],
          ["Live processes", "Harness process inventory and parent attribution."],
        ].map(([t, d]) => (
          <div key={t}>
            <div className="font-sans text-[11px] font-semibold text-studio-ink">{t}</div>
            <div className="font-mono text-[9.5px] leading-snug text-studio-ink-faint">{d}</div>
          </div>
        ))}
      </div>
    </Specimen>
  );
}

function DescriptionSpecimen() {
  return (
    <Specimen>
      <div className="flex flex-col gap-1">
        <SecTitle label="Defaults" />
        <div className="font-mono text-[9.5px] leading-snug text-studio-ink-faint">
          Metadata includes records like model, title, permission-mode, and last-prompt.
        </div>
      </div>
    </Specimen>
  );
}

function SecTitle({ label = "Section" }: { label?: string }) {
  return (
    <div>
      <div
        aria-hidden
        className="mb-1.5 h-px w-3.5"
        style={{ background: "var(--studio-edge-strong)" }}
      />
      <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
    </div>
  );
}

function KV({ k, v, vColor }: { k: string; v: string; vColor?: string }) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-baseline gap-x-2">
      <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {k}
      </span>
      <span
        className="truncate text-right font-mono text-[10.5px]"
        style={{ color: vColor ?? "var(--studio-ink-muted)" }}
      >
        {v}
      </span>
    </div>
  );
}

function Specimen({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface p-3">{children}</div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   §3 — Entity model
   The canonical `InspectorEntity` every block reads from.
   ──────────────────────────────────────────────────────────────────── */

interface InspectorEntity {
  // Universal
  name: string;
  agentId?: string;
  avatar?: string;
  state?: "ok" | "warn" | "error" | "info" | "neutral";
  // Project
  project?: { repo: string; branch: string; path: string };
  // Agent-specific
  role?: string;
  harness?: string;
  transport?: string;
  model?: string;
  node?: string;
  session?: { id: string; started: string; observed: boolean };
  // Repo-specific
  worktrees?: { total: number; dirty: number };
  changes?: { staged: number; unstaged: number; untracked: number };
  attached?: { agents: number; sessions: number };
  // Comms-specific
  conversation?: { last: string; unread: number; kind: "DM" | "Channel" };
  ask?: { state: "pending" | "answered"; from: string; text: string };
  // Tail-specific
  stats?: { label: string; value: string }[];
  tracks?: { label: string; description: string }[];
  description?: string;
}

const ENTITY_CONFORMERS: {
  surface: "comms" | "agents" | "repos" | "tail";
  source: string;
  // Which InspectorEntity fields the surface's concrete model provides.
  provides: (keyof InspectorEntity)[];
}[] = [
  {
    surface: "comms",
    source: "ScoutChannel",
    provides: ["name", "agentId", "avatar", "project", "conversation", "ask"],
  },
  {
    surface: "agents",
    source: "ScoutAgent",
    provides: [
      "name",
      "agentId",
      "avatar",
      "state",
      "project",
      "role",
      "harness",
      "transport",
      "model",
      "node",
      "session",
    ],
  },
  {
    surface: "repos",
    source: "ScoutRepo",
    provides: ["name", "state", "worktrees", "changes", "attached"],
  },
  {
    surface: "tail",
    source: "ScoutTailOverview",
    provides: ["stats", "tracks", "description"],
  },
];

/* ────────────────────────────────────────────────────────────────────
   §4 — Comms as a composition
   The Comms inspector expressed as a list of blocks in order.
   ──────────────────────────────────────────────────────────────────── */

const COMMS_COMPOSITION: {
  block: BlockKey;
  why: string;
}[] = [
  { block: "identity", why: "Every inspector leads with the entity." },
  { block: "action-row", why: "Open is the primary action on a thread." },
  { block: "conversation", why: "Last + Unread + Channel is the thread's at-a-glance." },
  { block: "project", why: "~80% of DMs have an underlying project." },
  { block: "ask", why: "Active asks are why a thread is highlighted." },
];

/* ────────────────────────────────────────────────────────────────────
   §5 — Other compositions
   The other three inspectors as compositions, for comparison.
   ──────────────────────────────────────────────────────────────────── */

const OTHER_COMPOSITIONS: {
  surface: "agents" | "repos" | "tail";
  href?: string;
  composition: { block: BlockKey; why: string }[];
}[] = [
  {
    surface: "agents",
    href: "/studies/agent-inspector-card",
    composition: [
      { block: "identity", why: "Agent name + ID." },
      { block: "action-row", why: "Message + New conversation." },
      { block: "key-value", why: "Runtime (Role, Harness, Transport, Model, Node)." },
      { block: "project", why: "Branch + Path + cId." },
      { block: "session", why: "Live session id + age + Observe." },
    ],
  },
  {
    surface: "repos",
    href: "/studies/branch-diff-sheet",
    composition: [
      { block: "identity", why: "Repo name + path." },
      { block: "worktrees", why: "Total + Dirty worktree count." },
      { block: "changes", why: "Staged / Unstaged / Untracked." },
      { block: "attached", why: "Agents + Sessions on this repo." },
    ],
  },
  {
    surface: "tail",
    href: "/studies/scout-tail",
    composition: [
      { block: "stats", why: "Logs · Processes · Sessions · Buffered." },
      { block: "key-value", why: "Sources · Origins · Kinds · Projects." },
      { block: "tracks", why: "Per-track label + description." },
      { block: "description", why: "Defaults block — toggle + helper." },
    ],
  },
];

/* ────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────── */

export default function InspectorSystemPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-10 max-w-prose">
        <EyebrowLabel size="sm">· studies · macos · inspector-system</EyebrowLabel>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Inspector system
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The IA-level design for the Scout right-rail inspector. The{" "}
          <a href="/studies/inspector-grammar" className="text-scout-accent hover:underline">
            grammar study
          </a>{" "}
          defines the chrome — title rule, status badge, section title,
          spacing. This study defines the <em>contents</em>: the block
          library, the composition rules, and the canonical entity
          model. Every per-screen inspector is a composition from this
          library.
        </p>
      </header>

      {/* §1 — Block library */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §1 · Block library
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Fourteen named blocks. Every inspector on every surface is a
          composition of these. Each block has a visual specimen below,
          a list of which inspectors use it, and a data contract.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {BLOCKS.map((b) => (
            <BlockCard key={b.key} block={b} />
          ))}
        </div>
      </section>

      {/* §2 — Composition rules */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §2 · Composition rules
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          How blocks are ordered, what's conditional, and how the
          spacing rhythm works.
        </p>

        <ol className="flex max-w-prose flex-col gap-4 font-sans text-[13px] leading-relaxed text-studio-ink">
          <Rule
            n="1"
            title="Identity always leads."
            body="When a block is `identity`, it renders first — at the top of the body, below the title row. The only exception is the Tail overview, which has no identity (it's a global rollup, not a per-entity inspector)."
          />
          <Rule
            n="2"
            title="Action row is second, but only when there's a primary action."
            body="If the entity has a primary action (Open, Message, Observe), the action row goes immediately after identity. Comms (Open), Agents (Message), Repos (Open diff) have one. Tail does not. The block is conditional on `actions.primary` being present."
          />
          <Rule
            n="3"
            title="Domain blocks come after the chrome."
            body="The domain blocks (Project, Session, Conversation, Ask, Worktrees, Changes, Attached, Stats, Tracks) are composed in surface-specific order. The order is part of the surface's identity, not the block library's."
          />
          <Rule
            n="4"
            title="Conditional blocks render only when their data is present."
            body="Project renders if `project` is non-null. Session renders if `session` is non-null. Ask renders if `ask` is non-null. Action row renders if `actions.primary` is present. This is what makes the library reusable: the same block serves a 3-section inspector and a 7-section inspector without changes."
          />
          <Rule
            n="5"
            title="Spacing is part of the grammar, not the block."
            body="Every block takes a fixed outer gap (12px) from the previous block. Internal spacing (6px title-to-row, 6px row-to-row) is also grammar-defined. Blocks don't set their own margins."
          />
          <Rule
            n="6"
            title="Width is fixed at 300px (matching the live app)."
            body="The inspector is 300px wide. Blocks are designed for that width and read at it. Going narrower or wider means re-validating every block; the SwiftUI InspectorFrame is the single place that owns the width."
          />
        </ol>
      </section>

      {/* §3 — Entity model */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §3 · Entity model
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The canonical <code className="text-studio-ink-muted">InspectorEntity</code>{" "}
          shape every block reads from. Concrete models (ScoutChannel,
          ScoutAgent, ScoutRepo, ScoutTailOverview) conform to this
          shape by exposing the fields they provide and leaving the
          rest undefined. Blocks read from the protocol, not the
          concrete type — that's what makes the library reusable.
        </p>

        <div className="overflow-hidden rounded-md border border-studio-edge">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="bg-studio-canvas-alt text-left text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Comms</th>
                <th className="px-3 py-2">Agents</th>
                <th className="px-3 py-2">Repos</th>
                <th className="px-3 py-2">Tail</th>
              </tr>
            </thead>
            <tbody>
              {ENTITY_FIELDS.map((row, i) => (
                <tr
                  key={row.field}
                  className={i % 2 === 0 ? "bg-studio-surface" : "bg-studio-canvas-alt"}
                >
                  <td className="px-3 py-2 text-studio-ink">{row.field}</td>
                  <td className="px-3 py-2 text-studio-ink-muted">{row.type}</td>
                  {(["comms", "agents", "repos", "tail"] as const).map((s) => (
                    <td key={s} className="px-3 py-2">
                      {row.providedBy.includes(s) ? (
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: "var(--status-ok-fg)" }}
                          title="provided"
                        />
                      ) : (
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: "var(--studio-edge-strong)" }}
                          title="not provided"
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 max-w-prose font-sans text-[11.5px] leading-snug text-studio-ink-faint">
          A field with a dot means the surface's concrete model exposes
          it. The InspectorEntity protocol is a <em>structural</em>{" "}
          interface, not a class — a value with the right fields
          conforms. In Swift, that's a protocol with optional
          requirements; in TypeScript, a partial type.
        </p>
      </section>

      {/* §4 — Comms as a composition */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §4 · Comms as a composition
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The Comms inspector is the following composition, in order.
          Each block renders only when its data is present; the
          composition is what makes the inspector fit every
          conversation shape (DM, channel, ask-active, no-ask, with-
          or without-project). The visual spec lives at{" "}
          <a href="/studies/scout-comms-inspector" className="text-scout-accent hover:underline">
            /studies/scout-comms-inspector
          </a>
          .
        </p>

        <CompositionDiagram
          title="Comms"
          href="/studies/scout-comms-inspector"
          items={COMMS_COMPOSITION}
        />
      </section>

      {/* §5 — Other compositions */}
      <section className="mb-12">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §5 · Other compositions
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The other three inspectors, for comparison. Same library,
          different compositions.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {OTHER_COMPOSITIONS.map((c) => (
            <CompositionDiagram
              key={c.surface}
              title={c.surface}
              href={c.href}
              items={c.composition}
              compact
            />
          ))}
        </div>
      </section>

      {/* §6 — Open questions */}
      <section className="mb-8">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §6 · Open questions
        </h2>

        <ul className="flex max-w-prose flex-col gap-3 font-sans text-[13px] leading-relaxed text-studio-ink">
          <OQ q="Is `InspectorEntity` the right level of abstraction?">
            It works as a structural protocol — every block reads only
            the fields it needs, and missing fields mean the block
            skips. An alternative is per-surface concrete types with
            adapter functions; that's more code but no protocol. The
            trade-off is reuse (protocol) vs. type-safety (concrete).
          </OQ>
          <OQ q="Should `Stats` and `KeyValue` be the same block?">
            Stats is a boxed callout (label-on-top, big number); KeyValue
            is a stacked row. Today they're distinct, but a Comms
            inspector might want both ('3 unread' as a stat, 'last
            message' as a kv). Keeping them separate matches the
            different visual weights.
          </OQ>
          <OQ q="Is 14 blocks the right count, or is the library over-split?">
            Identity, Status, ActionRow, KeyValue, Description, Project,
            Conversation, Ask, Session, Worktrees, Changes, Attached,
            Stats, Tracks. Some of these (Worktrees / Changes /
            Attached) could fold into a single "Repo stats" block; the
            split exists because they read from different concrete
            fields and have different update cadences.
          </OQ>
          <OQ q="What happens when a new surface needs a new block?">
            The library is open by design — a new block is a new
            specimen in §1, a new entry in ENTITY_FIELDS in §3, a new
            composition diagram in §4 / §5. The discipline is: a new
            block only earns its place if it appears in two or more
            compositions.
          </OQ>
        </ul>
      </section>

      <footer className="border-t border-studio-edge pt-4 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        Status · draft ·{" "}
        <span className="text-studio-ink-muted">drives</span>{" "}
        InspectorFrame (Swift) — the block library, the entity
        protocol, and the composition order
      </footer>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */

function BlockCard({ block }: { block: BlockSpec }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-studio-edge bg-studio-canvas-alt p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink">
          {block.name}
        </div>
        <code className="font-mono text-[8.5px] text-studio-ink-faint">{block.key}</code>
      </div>
      <p className="font-sans text-[11.5px] leading-snug text-studio-ink-faint">
        {block.purpose}
      </p>
      <div>{block.render()}</div>
      <div className="grid grid-cols-[80px_1fr] gap-x-2 font-mono text-[9.5px] leading-snug">
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">Used by</span>
        <span className="text-studio-ink-muted">{block.usedBy.join(", ")}</span>
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">Reads</span>
        <span className="text-studio-ink-muted">{block.reads.join(", ")}</span>
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">Conditional</span>
        <span className="text-studio-ink-muted">
          {block.conditional ? "yes — renders when data is present" : "no — always renders"}
        </span>
      </div>
    </div>
  );
}

function Rule({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border border-studio-edge bg-studio-canvas-alt font-mono text-[10px] font-semibold text-studio-ink">
        {n}
      </span>
      <div>
        <div className="font-medium text-studio-ink">{title}</div>
        <div className="mt-0.5 text-studio-ink-faint">{body}</div>
      </div>
    </li>
  );
}

function OQ({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <li className="rounded-md border border-studio-edge bg-studio-canvas-alt p-3">
      <div className="font-medium text-studio-ink">{q}</div>
      <div className="mt-1 text-studio-ink-faint">{children}</div>
    </li>
  );
}

function CompositionDiagram({
  title,
  href,
  items,
  compact,
}: {
  title: string;
  href?: string;
  items: { block: BlockKey; why: string }[];
  compact?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-md border border-studio-edge bg-studio-canvas-alt p-3",
        compact ? "" : "max-w-prose",
      ].join(" ")}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink">
          {title}
        </div>
        {href ? (
          <a href={href} className="font-mono text-[9px] uppercase tracking-eyebrow text-scout-accent hover:underline">
            visual spec →
          </a>
        ) : null}
      </div>
      <ol className="flex flex-col gap-1.5 font-sans text-[11.5px] leading-snug text-studio-ink">
        {items.map((it, i) => (
          <li key={it.block} className="flex gap-2">
            <span className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <code className="font-mono text-[10px] text-studio-ink">{it.block}</code>
              <span className="ml-2 text-studio-ink-faint">{it.why}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* Canonical entity fields — the source of truth for §3. */
const ENTITY_FIELDS: {
  field: keyof InspectorEntity;
  type: string;
  providedBy: ("comms" | "agents" | "repos" | "tail")[];
}[] = [
  { field: "name",          type: "string",                          providedBy: ["comms", "agents", "repos"] },
  { field: "agentId",       type: "string",                          providedBy: ["comms", "agents"] },
  { field: "avatar",        type: "string",                          providedBy: ["comms", "agents"] },
  { field: "state",         type: "ok | warn | error | info | neutral", providedBy: ["agents", "repos"] },
  { field: "project",       type: "{ repo, branch, path }",          providedBy: ["comms", "agents", "repos"] },
  { field: "role",          type: "string",                          providedBy: ["agents"] },
  { field: "harness",       type: "string",                          providedBy: ["agents"] },
  { field: "transport",     type: "string",                          providedBy: ["agents"] },
  { field: "model",         type: "string",                          providedBy: ["agents"] },
  { field: "node",          type: "string",                          providedBy: ["agents"] },
  { field: "session",       type: "{ id, started, observed }",       providedBy: ["agents"] },
  { field: "worktrees",     type: "{ total, dirty }",                providedBy: ["repos"] },
  { field: "changes",       type: "{ staged, unstaged, untracked }", providedBy: ["repos"] },
  { field: "attached",      type: "{ agents, sessions }",            providedBy: ["repos"] },
  { field: "conversation",  type: "{ last, unread, kind }",          providedBy: ["comms"] },
  { field: "ask",           type: "{ state, from, text }",            providedBy: ["comms"] },
  { field: "stats",         type: "{ label, value }[]",              providedBy: ["tail"] },
  { field: "tracks",        type: "{ label, description }[]",        providedBy: ["tail"] },
  { field: "description",   type: "string",                          providedBy: ["tail"] },
];
