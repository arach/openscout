/**
 * Sessions tab content — agent run sessions.
 *
 * NOT local tmux/iTerm sessions. These are the working sessions of
 * broker agents, mirroring the webapp's OpsScreen session ledger. Each
 * row carries an agent identity, a harness, a run status, message
 * counts, and lifecycle timestamps.
 *
 * Layout:
 *   compact → single-column rows. Identity + status above harness/branch
 *             meta + last-turn excerpt. Click reveals inline-below.
 *   medium  → wider rows; meta strip widens to surface project + duration.
 *   large   → two pane: list left (~480), session detail right.
 *
 * Universal row affordances:
 *   · Engage     — click → reveal inline (compact/medium) / swap detail
 *                  (large). Esc closes.
 *   · Scout link — trailing ↗ chip linking to scout.local/session/<id>.
 */

"use client";

import { HudScoutLink } from "./HudScoutLink";
import { HudSectionHeader } from "./HudSectionHeader";
import { SESSIONS } from "./mock";
import type {
  AgentSession,
  HudSize,
  SessionHarness,
  SessionStatus,
} from "./types";
import { useHudEngage } from "./useHudEngage";

const LIST_COL_W_LARGE = 480;

export function HudSessions({ size }: { size: HudSize }) {
  const engage = useHudEngage();

  if (size === "large") {
    const selectedId =
      (engage.engaged && SESSIONS.find((s) => s.id === engage.engaged)?.id) ??
      SESSIONS[0]?.id ??
      null;
    const selected = SESSIONS.find((s) => s.id === selectedId) ?? SESSIONS[0];

    return (
      <section className="flex h-full flex-col">
        <HudSectionHeader
          eyebrow={sessionEyebrow(SESSIONS)}
          headline="Sessions"
          size="large"
        />
        <div className="flex min-h-0 flex-1">
          <ul
            className="flex shrink-0 flex-col overflow-y-auto"
            style={{ width: LIST_COL_W_LARGE }}
          >
            {SESSIONS.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                size="large"
                engaged={selectedId === s.id}
                onClick={() => engage.select(s.id)}
                showInlineDetail={false}
              />
            ))}
          </ul>
          <div
            aria-hidden
            className="shrink-0 self-stretch border-l border-studio-edge"
            style={{ width: 1 }}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {selected ? <SessionDetailLarge session={selected} /> : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <HudSectionHeader
        eyebrow={sessionEyebrow(SESSIONS)}
        headline="Sessions"
        size={size}
      />
      <ul className="flex flex-col">
        {SESSIONS.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            size={size}
            engaged={engage.isEngaged(s.id)}
            onClick={() => engage.toggle(s.id)}
            showInlineDetail
          />
        ))}
      </ul>
    </section>
  );
}

function sessionEyebrow(sessions: AgentSession[]): string {
  const running = sessions.filter((s) => s.status === "running").length;
  return `LEDGER · ${sessions.length} SESSIONS · ${running} RUNNING`;
}

function statusColor(status: SessionStatus): string {
  return status === "running"
    ? "var(--scout-accent)"
    : status === "idle"
      ? "var(--studio-ink-muted)"
      : "var(--studio-ink-faint)";
}

function SessionRow({
  session,
  size,
  engaged,
  onClick,
  showInlineDetail,
}: {
  session: AgentSession;
  size: HudSize;
  engaged: boolean;
  onClick: () => void;
  showInlineDetail: boolean;
}) {
  const compact = size === "compact";
  const padX =
    compact ? "pl-4 pr-3.5" : size === "medium" ? "pl-4 pr-4" : "pl-4 pr-4";
  const padY = compact ? "pt-2.5 pb-2.5" : "pt-3 pb-3";

  return (
    <li
      className={`relative border-b border-studio-edge ${
        engaged ? "bg-studio-canvas-alt" : ""
      }`}
    >
      {session.status === "running" || engaged ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[1.5px]"
          style={{
            background:
              session.status === "running"
                ? "var(--scout-accent)"
                : engaged
                  ? "var(--scout-accent)"
                  : "transparent",
          }}
        />
      ) : null}

      <button
        type="button"
        onClick={onClick}
        className={`group w-full text-left transition-colors hover:bg-studio-canvas-alt ${padX} ${padY}`}
      >
        {/* Identity row: status dot · agent · @handle · STATUS · ago */}
        <div className="flex items-baseline gap-2">
          <StatusDot status={session.status} />
          <span className="font-sans text-[13px] font-semibold leading-none tracking-tight text-studio-ink">
            {session.agentName}
          </span>
          <span className="font-mono text-[10px] text-studio-ink-faint">
            {session.agentHandle}
          </span>
          <span
            className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow"
            style={{ color: statusColor(session.status) }}
          >
            {session.statusLabel}
          </span>
          <span className="ml-auto inline-flex items-baseline gap-2">
            <span className="font-mono text-[10px] tabular-nums text-studio-ink-faint">
              {session.ago}
            </span>
            <HudScoutLink
              kind="session"
              id={session.id}
              size={size}
              rowHoverGated
            />
          </span>
        </div>

        {/* Meta row: HARNESS · project · branch (medium/large add duration + msgs) */}
        <div
          className="mt-1.5 flex items-baseline gap-1.5"
          style={{ paddingLeft: 14 }}
        >
          <HarnessChip harness={session.harness} />
          <MetaDot />
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-muted">
            {session.project}
          </span>
          <MetaDot />
          <span className="truncate font-mono text-[10px] text-studio-ink-faint">
            {session.branch}
          </span>
          {compact ? null : (
            <>
              <MetaDot />
              <span className="font-mono text-[10px] tabular-nums text-studio-ink-faint">
                {session.duration}
              </span>
              <MetaDot />
              <span className="font-mono text-[10px] tabular-nums text-studio-ink-faint">
                {session.messages} msg
              </span>
            </>
          )}
        </div>

        {/* Last turn excerpt */}
        <div
          className={
            compact
              ? "mt-1.5 truncate font-sans text-[11px] leading-snug text-studio-ink-muted"
              : "mt-2 font-sans text-[12px] leading-snug text-studio-ink-muted"
          }
          style={{ paddingLeft: 14 }}
        >
          <span className="font-mono text-[10px] text-studio-ink-faint">↪</span>{" "}
          {session.lastTurn}
        </div>
      </button>

      {engaged && showInlineDetail ? (
        <SessionDetail session={session} size={size} />
      ) : null}
    </li>
  );
}

function SessionDetail({
  session,
  size,
}: {
  session: AgentSession;
  size: HudSize;
}) {
  const compact = size === "compact";
  const padX = compact ? "px-4" : "px-4";

  return (
    <div
      className={`border-t border-studio-edge bg-studio-canvas-alt ${padX} py-2.5`}
    >
      <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · last turn
      </div>
      <div className="mt-1 font-sans text-[12px] leading-snug text-studio-ink">
        {session.lastTurn}
      </div>

      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px] font-mono text-[10px] leading-snug">
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
          ref
        </dt>
        <dd className="tabular-nums text-studio-ink-muted">{session.refId}</dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
          harness
        </dt>
        <dd className="text-studio-ink-muted">{session.harness}</dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
          model
        </dt>
        <dd className="text-studio-ink-muted">{session.model}</dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
          started
        </dt>
        <dd className="tabular-nums text-studio-ink-muted">
          {session.startedAt} · {session.startedAgo} ago
        </dd>
        {session.endedAgo ? (
          <>
            <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
              ended
            </dt>
            <dd className="tabular-nums text-studio-ink-muted">
              {session.endedAgo} ago
            </dd>
          </>
        ) : null}
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
          duration
        </dt>
        <dd className="tabular-nums text-studio-ink-muted">
          {session.duration}
        </dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
          messages
        </dt>
        <dd className="tabular-nums text-studio-ink-muted">
          {session.messages}
        </dd>
      </dl>
    </div>
  );
}

function SessionDetailLarge({ session }: { session: AgentSession }) {
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4">
      {/* Header */}
      <header className="flex items-baseline gap-2">
        <StatusDot status={session.status} />
        <span className="font-sans text-[15px] font-semibold leading-none tracking-tight text-studio-ink">
          {session.agentName}
        </span>
        <span className="font-mono text-[11px] text-studio-ink-faint">
          {session.agentHandle}
        </span>
        <span
          className="ml-auto font-mono text-[10px] font-semibold uppercase tracking-eyebrow"
          style={{ color: statusColor(session.status) }}
        >
          {session.statusLabel}
        </span>
      </header>

      {/* Meta strip */}
      <div className="flex flex-wrap items-baseline gap-2">
        <HarnessChip harness={session.harness} />
        <span className="rounded-[2px] border border-studio-edge bg-studio-canvas px-1.5 py-px font-mono text-[10px] tabular-nums text-studio-ink-muted">
          {session.refId}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-muted">
          {session.project}
        </span>
        <span className="font-mono text-[10px] text-studio-ink-faint">
          {session.branch}
        </span>
      </div>

      {/* Last turn */}
      <section>
        <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · last turn
        </div>
        <p className="mt-1.5 font-sans text-[12px] leading-relaxed text-studio-ink">
          {session.lastTurn}
        </p>
      </section>

      {/* Lifecycle grid */}
      <section>
        <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · lifecycle
        </div>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px] font-mono text-[11px] leading-snug">
          <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
            started
          </dt>
          <dd className="tabular-nums text-studio-ink-muted">
            {session.startedAt} · {session.startedAgo} ago
          </dd>
          {session.endedAgo ? (
            <>
              <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
                ended
              </dt>
              <dd className="tabular-nums text-studio-ink-muted">
                {session.endedAgo} ago
              </dd>
            </>
          ) : (
            <>
              <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
                running
              </dt>
              <dd className="tabular-nums text-studio-ink-muted">
                {session.duration} elapsed
              </dd>
            </>
          )}
          <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
            duration
          </dt>
          <dd className="tabular-nums text-studio-ink-muted">
            {session.duration}
          </dd>
          <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
            messages
          </dt>
          <dd className="tabular-nums text-studio-ink-muted">
            {session.messages}
          </dd>
          <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
            model
          </dt>
          <dd className="text-studio-ink-muted">{session.model}</dd>
        </dl>
      </section>

      {/* Drill list */}
      <section className="mt-auto flex flex-col gap-[3px]">
        <DrillLink label="open transcript" />
        <DrillLink label="follow live" />
        <DrillLink label="agent profile" />
      </section>
    </div>
  );
}

function StatusDot({ status }: { status: SessionStatus }) {
  const color = statusColor(status);
  if (status === "running") {
    return (
      <span
        aria-hidden
        className="relative inline-block h-[7px] w-[7px] translate-y-[1px] rounded-full"
        style={{ background: color }}
      >
        <span
          aria-hidden
          className="absolute inset-[-3px] rounded-full"
          style={{
            border:
              "1px solid color-mix(in oklab, var(--scout-accent) 55%, transparent)",
          }}
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block h-[7px] w-[7px] translate-y-[1px] rounded-full"
      style={{
        background:
          status === "idle" ? "color-mix(in oklab, var(--studio-ink-muted) 65%, transparent)" : "transparent",
        border: status === "ended" ? "1px solid var(--studio-ink-faint)" : "none",
      }}
    />
  );
}

function HarnessChip({ harness }: { harness: SessionHarness }) {
  return (
    <span className="rounded-[2px] border border-studio-edge bg-studio-canvas px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
      {harness}
    </span>
  );
}

function MetaDot() {
  return (
    <span
      aria-hidden
      className="inline-block h-[2px] w-[2px] translate-y-[-2px] rounded-full"
      style={{ background: "var(--studio-ink-faint)" }}
    />
  );
}

function DrillLink({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded-[2px] px-1.5 py-1 text-left transition-colors hover:bg-studio-canvas-alt"
    >
      <span aria-hidden className="font-mono text-[11px] text-studio-ink-faint">
        →
      </span>
      <span className="flex-1 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-muted">
        {label}
      </span>
    </button>
  );
}
