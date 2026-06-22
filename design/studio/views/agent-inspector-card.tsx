import { Fragment } from "react";

/**
 * Agent Inspector Card — study (locked direction: variant C, refined).
 *
 * The per-agent card in the Scout macOS sidebar inspector. A DM shows one
 * card per participant. Settled design:
 *
 *   · no "AVAILABLE" tag — state rides the presence dot on the avatar
 *   · the whole identity header is clickable → opens the agent's profile
 *   · the card is ONE cohesive concept with internal sections
 *   · Observe lives WITH the live session (you observe a session), not
 *     floating top-right — it only appears when there's a session to watch
 *   · "New session" is a quiet inline link at the foot (continuing is the
 *     default action elsewhere, so it stays unemphasized)
 *   · Observe / New session read as buttons at rest but never out-shout
 *     the agent identity
 *
 * Ports to: apps/macos/Sources/Scout/ScoutRootView.swift (ScoutAgentInspector)
 */

type AgentState = "working" | "available" | "needs-attention" | "idle" | "offline";

interface InspectorAgent {
  name: string;
  id: string;
  state: AgentState;
  role: string;
  harness: string;
  transport: string;
  model: string;
  node: string;
  branch: string;
  path: string;
  cid: string;
  session?: { id: string; started: string };
  skills?: string[];
}

const STATE_COLOR: Record<AgentState, string> = {
  working: "var(--status-warn-fg)",
  "needs-attention": "var(--status-error-fg)",
  available: "var(--status-ok-fg)",
  idle: "var(--scout-accent)",
  offline: "var(--studio-ink-faint)",
};

const DEWEY: InspectorAgent = {
  name: "Dewey",
  id: "dewey.main.arts-mac-mini-local",
  state: "available",
  role: "Relay agent",
  harness: "claude",
  transport: "claude_stream_json",
  model: "—",
  node: "arts-mac-mini-local",
  branch: "main",
  path: "~/dev/dewey",
  cid: "c.960f31ec",
  session: { id: "3e9c6337-7aec-4367-b43d-291c873fd60e", started: "6m" },
  skills: ["docs.audit", "docs.score"],
};

const SCOUT: InspectorAgent = {
  name: "Scout",
  id: "scoutbot",
  state: "working",
  role: "Relay agent",
  harness: "codex",
  transport: "codex_app_server",
  model: "gpt-5.5",
  node: "arts-mac-mini-local",
  branch: "main",
  path: "~/dev/openscout",
  cid: "c.960f31ec",
  session: { id: "0199a2f1-8c4d-7b2a-9e10-4f6db8c1a233", started: "2m" },
};

const ATLAS: InspectorAgent = {
  name: "Atlas",
  id: "atlas.main.arts-mac-mini-local",
  state: "idle",
  role: "Session agent",
  harness: "claude",
  transport: "claude_stream_json",
  model: "opus-4.7",
  node: "arts-mac-mini-local",
  branch: "design/atlas-iconography",
  path: "~/dev/atlas",
  cid: "c.7f21aa0c",
  // no session → no Observe row
};

function avatarColor(_name: string): string {
  return "oklch(0.42 0.008 80)";
}

export default function AgentInspectorCardPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · agent-inspector-card
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent inspector card
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The per-agent card in the Scout sidebar. No <em>AVAILABLE</em>{" "}
          tag (state rides the dot), header click opens the profile, the
          card is one cohesive unit. <strong className="text-studio-ink-muted">Observe lives with the
          live session</strong> — it only shows when there's a session to
          watch. <em>New session</em> is a quiet inline link. Rendered at
          the real inspector width (~300px).
        </p>
      </header>

      <div className="flex flex-wrap items-start gap-10">
        <Labeled label="With a live session">
          <AgentCard agent={DEWEY} />
        </Labeled>
        <Labeled label="No session — no Observe">
          <AgentCard agent={ATLAS} />
        </Labeled>
      </div>

      <h2 className="mt-14 mb-4 font-display text-[18px] font-medium tracking-tight text-studio-ink">
        In a DM — two cards stacked
      </h2>
      <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
        Dewey <span className="text-studio-ink-faint">{"<>"}</span> Scout, stacked in the narrow inspector column.
      </p>
      <div className="flex w-[300px] flex-col gap-3">
        <AgentCard agent={DEWEY} />
        <AgentCard agent={SCOUT} />
      </div>
    </main>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="w-[300px]">
      <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-scout-accent">
        {label}
      </div>
      {children}
    </div>
  );
}

/* ── The card ───────────────────────────────────────────────────── */

function AgentCard({ agent }: { agent: InspectorAgent }) {
  return (
    <article className="flex flex-col gap-3 rounded-md border border-studio-edge bg-studio-surface p-3.5">
      <CardHeader agent={agent} />
      <Divider />
      <Section
        label="Runtime"
        rows={[
          ["Role", agent.role],
          ["Harness", agent.harness],
          ["Transport", agent.transport],
          ["Model", agent.model],
          ["Node", agent.node],
        ]}
      />
      <Divider />
      <Section
        label="Workspace"
        rows={[
          ["Branch", agent.branch],
          ["Path", agent.path],
          ["cId", agent.cid],
        ]}
      />
      {agent.session ? (
        <>
          <Divider />
          <SessionSection session={agent.session} />
        </>
      ) : null}
      {agent.skills?.length ? (
        <>
          <Divider />
          <Skills skills={agent.skills} />
        </>
      ) : null}
      <NewSessionLink />
    </article>
  );
}

/** Clickable identity header → profile. State rides the presence dot only. */
function CardHeader({ agent }: { agent: InspectorAgent }) {
  const stateColor = STATE_COLOR[agent.state];
  return (
    <button
      type="button"
      className="group flex min-w-0 items-start gap-2.5 text-left"
      title={`Open ${agent.name}'s profile`}
    >
      <div
        className="relative grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full font-mono text-[12px]"
        style={{ background: avatarColor(agent.name), color: "var(--studio-canvas)" }}
      >
        {agent.name[0]?.toUpperCase()}
        <span
          className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full"
          style={{ background: stateColor, boxShadow: "0 0 0 2px var(--studio-surface)" }}
        />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="truncate font-sans text-[15px] font-semibold tracking-tight text-studio-ink decoration-studio-ink-faint underline-offset-2 group-hover:underline">
          {agent.name}
        </div>
        <div className="truncate font-mono text-[9.5px] text-studio-ink-faint">
          {agent.id}
        </div>
      </div>
    </button>
  );
}

/** Live session block — the only home for Observe. */
function SessionSection({ session }: { session: NonNullable<InspectorAgent["session"]> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          Session
        </div>
        <ObserveButton />
      </div>
      <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 font-mono text-[10.5px]">
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">id</span>
        <span className="truncate text-right text-studio-ink" title={session.id}>
          {session.id.slice(0, 8)}
          <span className="text-studio-ink-faint">…{session.id.slice(-4)}</span>
        </span>
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">started</span>
        <span className="truncate text-right text-studio-ink-muted">{session.started} ago</span>
      </div>
    </div>
  );
}

/** Reads as a button at rest (hairline border + faint inset), muted; warms
 *  to observe-green on hover so it never out-shouts the identity. */
function ObserveButton() {
  return (
    <button
      type="button"
      title="Observe this session"
      className="flex shrink-0 items-center gap-1.5 rounded-[5px] border border-studio-edge-strong bg-studio-canvas-alt px-2 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted transition-colors hover:border-[color-mix(in_oklab,var(--status-ok-fg)_50%,transparent)] hover:bg-[color-mix(in_oklab,var(--status-ok-fg)_12%,transparent)] hover:text-[var(--status-ok-fg)]"
    >
      <EyeIcon />
      Observe
    </button>
  );
}

function NewSessionLink() {
  return (
    <button
      type="button"
      className="flex items-center gap-1 self-start font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors hover:text-scout-accent"
    >
      <PlusIcon /> New session
    </button>
  );
}

function Section({ label, rows }: { label: string; rows: [string, string][] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 font-mono text-[10.5px]">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <span className="uppercase tracking-eyebrow text-studio-ink-faint">{k}</span>
            <span className="truncate text-right text-studio-ink">{v}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function Skills({ skills }: { skills: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        Skills
      </div>
      <div className="flex flex-wrap gap-1">
        {skills.map((s) => (
          <code
            key={s}
            className="rounded-[3px] bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[9.5px] text-studio-ink-muted"
          >
            {s}
          </code>
        ))}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-px w-full bg-studio-edge" />;
}

/* ── Icons ──────────────────────────────────────────────────────── */

function EyeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
