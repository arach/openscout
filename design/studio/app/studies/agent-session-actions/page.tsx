import { Fragment } from "react";

/**
 * Agent Session Actions — study (iterating).
 *
 * Model (from the operator): a session is the unit; an agent config can run
 * many sessions; the per-session verbs live ON the session:
 *
 *   · per-session  → Observe · Take over · Clone/Fork · Message
 *   · global       → New session   (lives at the TOP of the card — locked)
 *
 * Per-session disclosure is a three-tier progression (NOT all-on):
 *
 *   · rest    → identity + role + a metadata line (role alone isn't enough,
 *               especially with several sessions stacked)
 *   · hover   → + 1–2 quick actions (Observe / Message) + ⋯
 *   · engaged → a mini-card: full metadata + ALL actions as a 2×2 grid
 *                 ┌ Observe   │ Take over ┐
 *                 └ Message   │ Fork      ┘
 *
 * All four cells are equal — single line, same dimensions, no "soon" state:
 * an action is either there or it isn't. (Take over + Fork are net-new — they
 * get wired at port time, not faked.) The live well (native) stays as-is.
 *
 * Ports to: apps/macos/Sources/Scout/ScoutRootView.swift (ScoutAgentInspector)
 */

interface SessionRow {
  title: string;
  role: string;
  state: "working" | "available" | "idle";
  id: string;
  path: string;
  branch: string;
  model: string;
  msgs: number;
  age: string;
  active?: boolean;
}

const SESSIONS: SessionRow[] = [
  {
    title: "Openscout",
    role: "Relay agent",
    state: "working",
    id: "c.4ffc26a9-5a3d-4e5a-bca3-f093b4d01ef9",
    path: "~/dev/openscout",
    branch: "feat/macos-agent-work-preview",
    model: "grok-4.3",
    msgs: 14,
    age: "1m",
    active: true,
  },
  {
    title: "Lattices",
    role: "Reviewer",
    state: "available",
    id: "c.6dc7a3cc-12bb-4a90-8f0e-7c1d2e9a4b55",
    path: "~/dev/lattices",
    branch: "main",
    model: "claude-opus-4.7",
    msgs: 6,
    age: "2h",
  },
  {
    title: "Lattices <> Scoutbot",
    role: "Builder",
    state: "idle",
    id: "c.aa19f7e0-44c2-4b71-9d3a-0b5e6f8c1d22",
    path: "~/dev/lattices",
    branch: "design/atlas",
    model: "gpt-5.5",
    msgs: 31,
    age: "1d",
  },
];

const STATE_COLOR: Record<SessionRow["state"], string> = {
  working: "var(--status-warn-fg)",
  available: "var(--status-ok-fg)",
  idle: "var(--studio-ink-faint)",
};

export default function AgentSessionActionsPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · agent-session-actions
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agent session actions
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          A session is the unit. Per-session verbs —{" "}
          <strong className="text-studio-ink-muted">Observe · Take over · Fork · Message</strong> —
          disclose progressively: role + metadata at rest, quick actions on
          hover, the full 2×2 grid when engaged (a mini-card). Global{" "}
          <em>New session</em> + <em>Message</em> sit at the top. Inspector
          width ~300px.
        </p>
      </header>

      {/* ── 1. Disclosure tiers ──────────────────────────────────────── */}
      <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
        1 · Disclosure tiers
      </h2>
      <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
        Same session, three states. Rest carries a metadata line (not role
        alone); hover surfaces Observe/Message + ⋯; engaged is a mini-card with
        every action.
      </p>
      <div className="flex flex-wrap items-start gap-10">
        <Labeled label="Rest — role + metadata">
          <Tile>
            <SectionLabel>Sessions</SectionLabel>
            <div className="mt-1.5">
              <StaticTile row={{ ...SESSIONS[0], active: false }} tier="rest" />
            </div>
          </Tile>
        </Labeled>
        <Labeled label="Hover — quick actions + ⋯">
          <Tile>
            <SectionLabel>Sessions</SectionLabel>
            <div className="mt-1.5">
              <StaticTile row={{ ...SESSIONS[0], active: false }} tier="hover" />
            </div>
          </Tile>
        </Labeled>
        <Labeled label="Engaged — mini-card, all actions">
          <Tile>
            <SectionLabel>Sessions</SectionLabel>
            <div className="mt-1.5">
              <StaticTile row={SESSIONS[0]} tier="engaged" />
            </div>
          </Tile>
        </Labeled>
      </div>

      <p className="mt-5 mb-3 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
        Live — hover a row for quick actions; the ⋯ opens the full 2×2.
      </p>
      <div className="w-[300px]">
        <Tile>
          <SectionLabel>Sessions</SectionLabel>
          <div className="mt-1.5 flex flex-col gap-0.5">
            {SESSIONS.map((r) => (
              <HoverTile key={r.id} row={r} />
            ))}
          </div>
        </Tile>
      </div>

      {/* ── 2. The settled card ──────────────────────────────────────── */}
      <h2 className="mt-14 mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
        2 · Card — global actions at top
      </h2>
      <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
        <em>Message</em> + <em>New session</em> as real CTAs directly under the
        identity, then metadata, then the session list.
      </p>
      <div className="w-[300px]">
        <InspectorCard />
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

function Tile({ children }: { children: React.ReactNode }) {
  return <article className="rounded-md border border-studio-edge bg-studio-surface p-3.5">{children}</article>;
}

/* ── Session tiles ────────────────────────────────────────────────── */

/** Pinned to a tier — for the side-by-side comparison. */
function StaticTile({ row, tier }: { row: SessionRow; tier: "rest" | "hover" | "engaged" }) {
  if (tier === "engaged") return <MiniCard row={row} />;
  return (
    <div
      className="rounded-[5px] px-1.5 py-1.5"
      style={tier === "hover" ? { background: "color-mix(in oklab, var(--studio-ink) 5%, transparent)" } : undefined}
    >
      <RowHead row={row} quick={tier === "hover"} />
      <MetaLine row={row} />
    </div>
  );
}

/** Real CSS-hover row: rest → hover quick actions; ⋯ opens the 2×2. */
function HoverTile({ row }: { row: SessionRow }) {
  return (
    <div className="group/row rounded-[5px] px-1.5 py-1.5 transition-colors hover:bg-[color-mix(in_oklab,var(--studio-ink)_5%,transparent)]">
      <div className="flex items-center gap-2">
        <Dot state={row.state} />
        <span className="truncate font-sans text-[11px] font-medium text-studio-ink-muted group-hover/row:text-studio-ink">
          {row.title}
        </span>
        <RoleBadge role={row.role} />
        <span className="ml-auto font-mono text-[9px] text-studio-ink-faint group-hover/row:hidden">{row.age}</span>
        <div className="hidden items-center gap-0.5 group-hover/row:flex">
          <QuickAction icon={<EyeIcon />} label="Observe" accent />
          <QuickAction icon={<ChatIcon />} label="Message" />
          <KebabMenu />
        </div>
      </div>
      <MetaLine row={row} />
    </div>
  );
}

function RowHead({ row, quick }: { row: SessionRow; quick?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Dot state={row.state} />
      <span className="truncate font-sans text-[11px] font-medium text-studio-ink">{row.title}</span>
      <RoleBadge role={row.role} />
      {quick ? (
        <div className="ml-auto flex items-center gap-0.5">
          <QuickAction icon={<EyeIcon />} label="Observe" accent />
          <QuickAction icon={<ChatIcon />} label="Message" />
          <KebabButton />
        </div>
      ) : (
        <span className="ml-auto font-mono text-[9px] text-studio-ink-faint">{row.age}</span>
      )}
    </div>
  );
}

function MetaLine({ row }: { row: SessionRow }) {
  return (
    <div className="mt-0.5 truncate pl-4 font-mono text-[9px] text-studio-ink-faint">
      {row.branch} · {row.model} · {row.msgs} msgs
    </div>
  );
}

/** Engaged state — a lifted mini-card with full metadata + the 2×2 grid. */
function MiniCard({ row }: { row: SessionRow }) {
  return (
    <div
      className="rounded-md border border-studio-edge-strong bg-studio-canvas-alt p-2.5"
      style={{ boxShadow: "0 4px 14px -8px rgba(0,0,0,0.6)" }}
    >
      <div className="flex items-center gap-2">
        <Dot state={row.state} />
        <span className="truncate font-sans text-[11.5px] font-semibold text-studio-ink">{row.title}</span>
        <RoleBadge role={row.role} />
        <span className="ml-auto font-mono text-[9px] text-studio-ink-faint">{row.age}</span>
      </div>
      <div className="mt-2 grid grid-cols-[44px_1fr] gap-x-2 gap-y-1 font-mono text-[9px]">
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">id</span>
        <span className="truncate text-studio-ink-muted">{row.id}</span>
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">path</span>
        <span className="truncate text-studio-ink-muted">{row.path}</span>
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">branch</span>
        <span className="truncate text-studio-ink-muted">{row.branch}</span>
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">model</span>
        <span className="truncate text-studio-ink-muted">{row.model} · {row.msgs} msgs</span>
      </div>
      <div className="mt-2.5">
        <ActionGrid />
      </div>
    </div>
  );
}

/* ── Actions ──────────────────────────────────────────────────────── */

/** The full per-session set as a 2×2 of equal, single-line cells:
 *  Observe · Take over / Message · Fork. Either an action is here or it isn't —
 *  no "soon" states. */
function ActionGrid() {
  return (
    <div className="grid grid-cols-2 gap-1">
      <ActionCell icon={<EyeIcon />} label="Observe" accent />
      <ActionCell icon={<HandIcon />} label="Take over" />
      <ActionCell icon={<ChatIcon />} label="Message" />
      <ActionCell icon={<ForkIcon />} label="Fork" />
    </div>
  );
}

function ActionCell({ icon, label, accent }: { icon: React.ReactNode; label: string; accent?: boolean }) {
  return (
    <button
      type="button"
      className={`flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border px-2 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow transition-colors ${
        accent
          ? "border-[color-mix(in_oklab,var(--status-ok-fg)_45%,transparent)] bg-[color-mix(in_oklab,var(--status-ok-fg)_12%,transparent)] text-[var(--status-ok-fg)] hover:bg-[color-mix(in_oklab,var(--status-ok-fg)_22%,transparent)]"
          : "border-studio-edge-strong text-studio-ink-muted hover:border-[color-mix(in_oklab,var(--scout-accent)_45%,transparent)] hover:text-studio-ink"
      }`}
    >
      <span className="grid h-3 w-3 shrink-0 place-items-center">{icon}</span>
      {label}
    </button>
  );
}

function QuickAction({ icon, label, accent }: { icon: React.ReactNode; label: string; accent?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      className={`grid h-5 w-5 place-items-center rounded-[4px] transition-colors ${
        accent
          ? "text-[var(--status-ok-fg)] hover:bg-[color-mix(in_oklab,var(--status-ok-fg)_14%,transparent)]"
          : "text-studio-ink-muted hover:bg-[color-mix(in_oklab,var(--studio-ink)_8%,transparent)] hover:text-studio-ink"
      }`}
    >
      {icon}
    </button>
  );
}

function KebabButton() {
  return (
    <button
      type="button"
      title="All actions"
      className="grid h-5 w-5 place-items-center rounded-full text-studio-ink-faint hover:bg-[color-mix(in_oklab,var(--studio-ink)_8%,transparent)] hover:text-studio-ink"
    >
      <KebabIcon />
    </button>
  );
}

/** ⋯ whose 2×2 menu opens on hover (CSS only). */
function KebabMenu() {
  return (
    <div className="group/menu relative">
      <button
        type="button"
        title="All actions"
        className="grid h-5 w-5 place-items-center rounded-full text-studio-ink-faint hover:bg-[color-mix(in_oklab,var(--studio-ink)_8%,transparent)] hover:text-studio-ink"
      >
        <KebabIcon />
      </button>
      <div className="invisible absolute right-0 top-full z-10 mt-1 w-[188px] rounded-md border border-studio-edge-strong bg-studio-canvas-alt p-1.5 opacity-0 shadow-lg transition-opacity group-hover/menu:visible group-hover/menu:opacity-100">
        <ActionGrid />
      </div>
    </div>
  );
}

/* ── Global action bar (top of card) ──────────────────────────────── */

function ActionBar() {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-eyebrow"
        style={{ background: "var(--scout-accent)", color: "var(--studio-canvas)" }}
      >
        <ChatIcon /> Message
      </button>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-full border border-studio-edge-strong bg-studio-canvas-alt px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted transition-colors hover:border-[color-mix(in_oklab,var(--scout-accent)_50%,transparent)] hover:text-studio-ink"
      >
        <PlusIcon /> New session
      </button>
    </div>
  );
}

/* ── Full card ────────────────────────────────────────────────────── */

function InspectorCard() {
  return (
    <article className="flex flex-col gap-3 rounded-md border border-studio-edge bg-studio-surface p-3.5">
      <Header />
      <ActionBar />
      <Divider />
      <Section
        label="Runtime"
        rows={[
          ["Role", "Relay agent"],
          ["Harness", "pi"],
          ["Model", "grok-4.3"],
          ["Node", "arts-mac-mini-local"],
        ]}
      />
      <Divider />
      <Section label="Workspace" rows={[["Branch", "feat/macos-agent-work-preview"], ["Path", "~/dev/openscout"]]} />
      <Divider />
      <div>
        <SectionLabel>Sessions</SectionLabel>
        <div className="mt-1.5 flex flex-col gap-0.5">
          {SESSIONS.slice(0, 2).map((r) => (
            <HoverTile key={r.id} row={r} />
          ))}
        </div>
      </div>
    </article>
  );
}

function Header() {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <div
        className="relative grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full font-mono text-[12px]"
        style={{ background: "oklch(0.42 0.008 80)", color: "var(--studio-canvas)" }}
      >
        G
        <span
          className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full"
          style={{ background: "var(--status-warn-fg)", boxShadow: "0 0 0 2px var(--studio-surface)" }}
        />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="truncate font-sans text-[15px] font-semibold tracking-tight text-studio-ink">Grok</div>
        <div className="truncate font-mono text-[9.5px] text-studio-ink-faint">grok.feat-macos.arts-mac-mini-local</div>
      </div>
    </div>
  );
}

function Section({ label, rows }: { label: string; rows: [string, string][] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>{label}</SectionLabel>
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">{children}</div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="shrink-0 rounded-[3px] border border-studio-edge px-1.5 py-px font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-muted">
      {role}
    </span>
  );
}

function Dot({ state }: { state: SessionRow["state"] }) {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATE_COLOR[state] }} />;
}

function Divider() {
  return <div className="h-px w-full bg-studio-edge" />;
}

/* ── Icons ────────────────────────────────────────────────────────── */

function EyeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5.6v2c0 1 .5 1.6 1.5 2L8 10.4M12 5.6v2c0 1-.5 1.6-1.5 2L8 10.4" stroke="currentColor" strokeWidth="1.2" />
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

function KebabIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="8" cy="3" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="13" r="1.3" />
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
