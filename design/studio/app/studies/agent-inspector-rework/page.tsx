/**
 * Agent inspector — engage at two levels (study, v2).
 *
 * v1 removed the ENGAGE block wholesale. That went too far: Observe and Take
 * over are real verbs you want as buttons — the mistake was the *scope* and the
 * mislabeling, not the buttons. Message is the only one that leaves (it belongs
 * in the conversation's composer, not the inspector).
 *
 * The corrected model — engage lives at TWO levels:
 *
 *   · agent level   → a compact engage bar on the card: Observe · Take over,
 *                     operating the agent's live (bound) session. One tap to
 *                     jump into what the agent is doing. Hidden when the agent
 *                     has no live session to engage.
 *   · session level → each session row carries its own Observe · Take over, so
 *                     you can engage a SPECIFIC session (not just the live one).
 *                     Visible on the working row; hover-revealed on the rest.
 *
 * Plus the v1 wins that stay: "+ New session" in the Sessions header, and the
 * session dot lighting only when working (not merely selected).
 *
 * Ports to: apps/macos/Sources/Scout/ScoutRootView.swift
 *   · ScoutAgentInspector       — add `agentEngage` bar (Observe · Take over)
 *   · ScoutInspectorSessionRow  — surface Observe · Take over on the row
 */

type SessionState = "working" | "idle";

interface SessionRow {
  title: string;
  role: string;
  state: SessionState;
  branch: string;
  msgs: number;
  age: string;
}

const SESSIONS: SessionRow[] = [
  { title: "Openscout", role: "Relay agent", state: "working", branch: "codex/scoutd-apple-silicon-install-path", msgs: 14, age: "now" },
  { title: "Lattices", role: "Reviewer", state: "idle", branch: "main", msgs: 6, age: "2h" },
  { title: "Atlas <> Scout", role: "Builder", state: "idle", branch: "design/atlas", msgs: 31, age: "1d" },
];

export default function AgentInspectorReworkPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · agent-inspector-rework
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Engage — two levels
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Bring back the engage buttons — just scope them. <strong className="text-studio-ink-muted">Observe</strong>{" "}
          and <strong className="text-studio-ink-muted">Take over</strong> live both at the{" "}
          <strong className="text-studio-ink-muted">agent level</strong> (a compact bar that operates the live
          session) and the <strong className="text-studio-ink-muted">session level</strong> (on each row, for a
          specific session). <strong className="text-studio-ink-muted">Message</strong> stays out — it&apos;s the
          composer&apos;s job. New session stays with Sessions; the dot lights only when working.
        </p>
      </header>

      <div className="flex flex-wrap items-start gap-12">
        <Labeled label="Now — buttons gone (v1 over-corrected)" tone="muted">
          <Card variant="before" />
        </Labeled>
        <Labeled label="Proposed — engage at two levels" tone="accent">
          <Card variant="after" />
        </Labeled>
      </div>

      <div className="mt-12 max-w-prose">
        <h2 className="mb-3 font-display text-[16px] font-medium tracking-tight text-studio-ink">
          The two levels
        </h2>
        <ul className="flex flex-col gap-2.5">
          <Change tag="AGENT">
            A compact engage bar under the identity — <strong className="text-studio-ink">Observe · Take over</strong>{" "}
            on the agent&apos;s live session. One tap into the running work. Hidden when there&apos;s no live session.
          </Change>
          <Change tag="SESSION">
            Each row carries <strong className="text-studio-ink">Observe · Take over</strong> for that specific
            session — visible on the working row, hover-revealed on the rest. Expand for id · path · branch + Fork.
          </Change>
          <Change tag="KEEP">
            <strong className="text-studio-ink">Message</strong> stays in the composer (not a button).{" "}
            <strong className="text-studio-ink">+ New session</strong> stays in the Sessions header. The dot is{" "}
            <strong className="text-studio-ink">accent only when working</strong>.
          </Change>
        </ul>
        <p className="mt-4 font-sans text-[12px] leading-relaxed text-studio-ink-faint">
          Note: for a single-session agent the agent bar and the one row&apos;s buttons are the same target — the
          agent bar earns its place once there are several sessions. Could auto-hide the bar at 1 session if the
          redundancy reads heavy.
        </p>
      </div>
    </main>
  );
}

function Labeled({ label, tone, children }: { label: string; tone: "muted" | "accent"; children: React.ReactNode }) {
  return (
    <div className="w-[300px]">
      <div
        className={`mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow ${
          tone === "accent" ? "text-scout-accent" : "text-studio-ink-faint"
        }`}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

/* ── The card ───────────────────────────────────────────────────── */

function Card({ variant }: { variant: "before" | "after" }) {
  const after = variant === "after";
  return (
    <article className="flex flex-col gap-3 rounded-md border border-studio-edge bg-studio-surface p-3.5">
      <Essentials />
      {after && <AgentEngageBar />}
      <Elided>Activity · Context — unchanged</Elided>
      <Divider />
      <FilesChanged />
      <Divider />
      <Sessions variant={variant} />
      <Divider />
      <Runtime />
    </article>
  );
}

function Essentials() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className="relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[8px] font-mono text-[12px]"
          style={{ background: "oklch(0.42 0.008 80)", color: "var(--studio-canvas)" }}
        >
          O
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-sans text-[14px] font-semibold tracking-tight text-studio-ink">
            Openscout Card T
          </div>
          <div className="truncate font-mono text-[9px] text-studio-ink-faint">@openscout-card-t-39kmsa</div>
        </div>
        <CopyDot />
      </div>
      <GlyphFacts />
    </div>
  );
}

/** AGENT-level engage — operates the agent's live (bound) session. */
function AgentEngageBar() {
  return (
    <div className="flex items-center gap-1.5">
      <Chip icon={<EyeIcon />} label="Observe" accent />
      <Chip icon={<HandIcon />} label="Take over" />
    </div>
  );
}

function GlyphFacts() {
  return (
    <div className="flex flex-col gap-1 font-mono text-[9.5px] text-studio-ink-muted">
      <div className="flex items-center gap-2">
        <Glyph>▤</Glyph>
        <span className="truncate">~/dev/openscout</span>
        <Glyph>⑂</Glyph>
        <span className="truncate">codex/scoutd-apple…</span>
      </div>
      <div className="flex items-center gap-2">
        <Glyph>▦</Glyph>
        <span className="truncate">Arts-Mac-mini.local</span>
        <Glyph>▢</Glyph>
        <span className="truncate">claude</span>
      </div>
    </div>
  );
}

function FilesChanged() {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>Files changed</SectionLabel>
      <div className="font-mono text-[10px] text-studio-ink-faint">No file touches yet</div>
    </div>
  );
}

function Sessions({ variant }: { variant: "before" | "after" }) {
  const after = variant === "after";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <SectionLabel>Sessions</SectionLabel>
        <button
          type="button"
          className="flex items-center gap-1 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors hover:text-scout-accent"
        >
          <PlusIcon /> New session
        </button>
      </div>
      <div className="mt-0.5 flex flex-col gap-0.5">
        {SESSIONS.map((s) => (
          <SessionRowView key={s.title} row={s} showButtons={after} />
        ))}
      </div>
    </div>
  );
}

function SessionRowView({ row, showButtons }: { row: SessionRow; showButtons: boolean }) {
  const working = row.state === "working";
  const dot = showButtons && working ? "var(--scout-accent)" : "var(--studio-ink-faint)";
  return (
    <div className="rounded-[5px] px-1.5 py-1.5">
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: dot, boxShadow: showButtons && working ? "0 0 0 3px color-mix(in oklab, var(--scout-accent) 22%, transparent)" : undefined }}
        />
        <span className="truncate font-sans text-[11px] font-medium text-studio-ink">{row.title}</span>
        <RoleBadge role={row.role} />
        <span className="ml-auto shrink-0 font-mono text-[9px] text-studio-ink-faint">{row.age}</span>
      </div>
      <div className="mt-0.5 truncate pl-4 font-mono text-[9px] text-studio-ink-faint">
        {row.branch} · {row.msgs} msgs
      </div>
      {showButtons ? (
        <div className="mt-1.5 flex items-center gap-1.5 pl-4">
          <Chip icon={<EyeIcon />} label="Observe" accent small />
          <Chip icon={<HandIcon />} label="Take over" small />
          {working ? null : <span className="font-mono text-[8px] uppercase tracking-eyebrow text-studio-ink-faint/60">on hover</span>}
        </div>
      ) : null}
    </div>
  );
}

function Runtime() {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>Runtime</SectionLabel>
      <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 font-mono text-[10px]">
        {[
          ["Transport", "tmux"],
          ["Role", "Relay agent"],
          ["Class", "general"],
        ].map(([k, v]) => (
          <div key={k} className="contents">
            <span className="uppercase tracking-eyebrow text-studio-ink-faint">{k}</span>
            <span className="truncate text-right text-studio-ink">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Bits ───────────────────────────────────────────────────────── */

function Chip({ icon, label, accent, small }: { icon: React.ReactNode; label: string; accent?: boolean; small?: boolean }) {
  return (
    <button
      type="button"
      className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border font-mono font-semibold uppercase tracking-eyebrow transition-colors ${
        small ? "h-6 px-2 text-[9px]" : "h-7 px-2.5 text-[9.5px]"
      } ${
        accent
          ? "border-[color-mix(in_oklab,var(--scout-accent)_45%,transparent)] bg-[color-mix(in_oklab,var(--scout-accent)_12%,transparent)] text-[var(--scout-accent)]"
          : "border-studio-edge-strong text-studio-ink-muted hover:text-studio-ink"
      }`}
    >
      <span className="grid h-3 w-3 shrink-0 place-items-center">{icon}</span>
      {label}
    </button>
  );
}

function Elided({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5 font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint/70">
      <span className="h-px flex-1" style={{ background: "color-mix(in oklab, var(--studio-ink) 8%, transparent)" }} />
      {children}
      <span className="h-px flex-1" style={{ background: "color-mix(in oklab, var(--studio-ink) 8%, transparent)" }} />
    </div>
  );
}

function CopyDot() {
  return (
    <button
      type="button"
      title="Copy agent details"
      className="grid h-6 w-6 shrink-0 place-items-center rounded-[5px] border border-studio-edge text-studio-ink-faint hover:text-studio-ink"
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">{children}</div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="shrink-0 rounded-[3px] border border-studio-edge px-1.5 py-px font-mono text-[8px] uppercase tracking-eyebrow text-studio-ink-muted">
      {role}
    </span>
  );
}

function Glyph({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 text-studio-ink-faint">{children}</span>;
}

function Divider() {
  return <div className="h-px w-full bg-studio-edge" />;
}

function Change({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-px w-[58px] shrink-0 rounded-[3px] border border-studio-edge-strong px-1 py-0.5 text-center font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-scout-accent">
        {tag}
      </span>
      <div className="flex-1 font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">{children}</div>
    </li>
  );
}

/* ── Icons ──────────────────────────────────────────────────────── */

function EyeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function HandIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M5 7V3.5a1 1 0 0 1 2 0V7m0 0V2.5a1 1 0 0 1 2 0V7m0 0V3.5a1 1 0 0 1 2 0V8c0 3-2 5-4.5 5S4 11 3.5 9.5L3 8a1 1 0 0 1 1.7-1L5 7Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
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
