/**
 * Fleet tab content. Row layout switches on size:
 *  · compact → single-column rows, identity line above work + last-action lines
 *  · medium  → 2-up tile grid; pulse gets its own labeled row inside the tile
 *  · large   → three columns side-by-side:
 *                A · Fleet list      (~280px)
 *                B · Context         (~300px)
 *                C · Last turn       (fills remainder)
 *              Clicking a row in column A swaps columns B + C; there is
 *              no inline expand at large.
 *
 * Universal row affordances at compact/medium:
 *   · Preview-engage  — click anywhere on the row to expand inline
 *   · Scout link       — trailing ↗ chip linking to scout.local/agent/<id>
 */

"use client";

import { useState } from "react";
import { AgentPresenceDot } from "@/components/AgentPresenceDot";
import { HudActivityPulse } from "./HudActivityPulse";
import { HudScoutLink } from "./HudScoutLink";
import { HudSectionHeader } from "./HudSectionHeader";
import { FLEET } from "./mock";
import type { EngageState, FleetAgent, HudSize } from "./types";

// Three-pane column widths at `large` (panel width 900, ~14px gutters):
//   column A — fleet list   280
//   column B — context      300
//   column C — last turn    fills remaining (~320)
const FLEET_COL_A_W = 280;
const FLEET_COL_B_W = 300;

export function HudFleet({ size }: { size: HudSize }) {
  const [engaged, setEngaged] = useState<EngageState>(null);

  if (size === "large") {
    // At large, the row is never "expanded inline" — selection drives
    // columns B + C instead. There is always a selected agent; default
    // to the first when nothing is engaged.
    const selectedId =
      (engaged && FLEET.find((a) => a.id === engaged)?.id) ??
      FLEET.find((a) => a.selected)?.id ??
      FLEET[0]?.id ??
      null;
    const selected = FLEET.find((a) => a.id === selectedId) ?? FLEET[0];

    return (
      <section className="flex h-full flex-col">
        <HudSectionHeader
          eyebrow={`FLEET · ${FLEET.length} AGENTS`}
          headline="Fleet"
          size={size}
        />
        <div className="flex min-h-0 flex-1">
          <FleetColumnA
            agents={FLEET}
            selectedId={selected.id}
            onSelect={(id) => setEngaged(id)}
          />
          <FleetColumnDivider />
          <FleetColumnB agent={selected} />
          <FleetColumnDivider />
          <FleetColumnC agent={selected} />
        </div>
      </section>
    );
  }

  return (
    <section>
      <HudSectionHeader
        eyebrow={`FLEET · ${FLEET.length} AGENTS`}
        headline="Fleet"
        size={size}
      />
      {size === "medium" ? (
        <div className="grid grid-cols-2 gap-px bg-studio-edge">
          {FLEET.map((a) => (
            <FleetTileMedium
              key={a.id}
              agent={a}
              engaged={engaged === a.id}
              onToggle={() => setEngaged(engaged === a.id ? null : a.id)}
            />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col">
          {FLEET.map((a) => (
            <FleetRow
              key={a.id}
              agent={a}
              size={size}
              engaged={engaged === a.id}
              onToggle={() => setEngaged(engaged === a.id ? null : a.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function stateColor(agent: FleetAgent) {
  return agent.state === "working" || agent.state === "needs-attention"
    ? "var(--scout-accent)"
    : agent.state === "offline"
      ? "var(--studio-ink-faint)"
      : "var(--studio-ink-muted)";
}

/** Compact (420) + Large (900): single-column rows. */
function FleetRow({
  agent,
  size,
  engaged,
  onToggle,
}: {
  agent: FleetAgent;
  size: HudSize;
  engaged: boolean;
  onToggle: () => void;
}) {
  const compact = size === "compact";
  const padX = compact ? "pl-4 pr-3.5" : "pl-5 pr-5";
  const padY = compact ? "pt-2.5 pb-2.5" : "pt-3 pb-3";

  return (
    <li
      className={[
        "relative border-b border-studio-edge",
        agent.dim ? "opacity-70" : "",
        engaged ? "bg-studio-canvas-alt" : "",
      ].join(" ")}
    >
      {agent.selected || engaged ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[1.5px]"
          style={{ background: "var(--scout-accent)" }}
        />
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        className={`group w-full text-left transition-colors hover:bg-studio-canvas-alt ${padX} ${padY}`}
      >
        {/* Identity line: dot · name · @handle · STATE · [pulse] · ago */}
        <div className="flex items-baseline gap-2">
          <span className="relative inline-flex translate-y-[2px]">
            <AgentPresenceDot
              state={agent.state}
              size="sm"
              withHalo={agent.isWorking}
            />
          </span>
          <span
            className={
              compact
                ? "font-sans text-[13px] font-medium leading-none text-studio-ink"
                : "font-sans text-[14px] font-semibold leading-none tracking-tight text-studio-ink"
            }
          >
            {agent.name}
          </span>
          <span
            className={
              compact
                ? "font-mono text-[9.5px] text-studio-ink-faint"
                : "font-mono text-[10.5px] text-studio-ink-faint"
            }
          >
            {agent.handle}
          </span>
          <span
            className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow"
            style={{ color: stateColor(agent) }}
          >
            {agent.stateLabel}
          </span>
          <span className="ml-auto flex items-baseline gap-3">
            <HudActivityPulse values={agent.pulse} size={size} dim={agent.dim} />
            <span className="font-mono text-[10px] font-medium tabular-nums text-studio-ink-faint">
              {agent.ago}
            </span>
            <HudScoutLink
              kind="agent"
              id={agent.id}
              size={size}
              rowHoverGated
            />
          </span>
        </div>

        {/* Work item — indented under the dot */}
        <div
          className={
            compact
              ? "mt-1.5 font-sans text-[12px] leading-snug text-studio-ink"
              : "mt-2 font-sans text-[13px] leading-snug text-studio-ink"
          }
          style={{ paddingLeft: compact ? 14 : 16 }}
        >
          <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            work
          </span>{" "}
          <span>{agent.work}</span>
        </div>

        {/* Last action — ink-muted, prefixed with arrow */}
        {agent.lastAction ? (
          <div
            className={
              compact
                ? "mt-1 flex items-baseline gap-1.5 font-sans text-[11px] leading-snug text-studio-ink-muted"
                : "mt-1.5 flex items-baseline gap-1.5 font-sans text-[11.5px] leading-snug text-studio-ink-muted"
            }
            style={{ paddingLeft: compact ? 14 : 16 }}
          >
            <span className="font-mono text-[10px] text-studio-ink-faint">
              ↪
            </span>
            <span className="min-w-0 flex-1 truncate">{agent.lastAction}</span>
            {agent.lastActionAgo ? (
              <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
                · {agent.lastActionAgo}
              </span>
            ) : null}
          </div>
        ) : (
          <div
            className="mt-1 font-mono text-[10px] text-studio-ink-faint"
            style={{ paddingLeft: compact ? 14 : 16 }}
          >
            —
          </div>
        )}
      </button>

      {engaged ? <FleetDetail agent={agent} size={size} /> : null}
    </li>
  );
}

/** Medium (680): 2-up tiles, more breathing room. Pulse row gets its
 *  own labeled line inside the tile. */
function FleetTileMedium({
  agent,
  engaged,
  onToggle,
}: {
  agent: FleetAgent;
  engaged: boolean;
  onToggle: () => void;
}) {
  return (
    <article
      className={[
        "relative",
        engaged ? "bg-studio-canvas-alt" : "bg-studio-canvas",
        agent.selected && !engaged ? "bg-studio-canvas-alt" : "",
        agent.dim ? "opacity-70" : "",
      ].join(" ")}
    >
      {agent.selected || engaged ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[1.5px]"
          style={{ background: "var(--scout-accent)" }}
        />
      ) : null}

      <button
        type="button"
        onClick={onToggle}
        className="group w-full px-4 py-3 text-left transition-colors hover:bg-studio-canvas-alt"
      >
        {/* Identity */}
        <header className="flex items-baseline gap-2">
          <span className="relative inline-flex translate-y-[2px]">
            <AgentPresenceDot
              state={agent.state}
              size="sm"
              withHalo={agent.isWorking}
            />
          </span>
          <span className="font-sans text-[13.5px] font-semibold leading-none tracking-tight text-studio-ink">
            {agent.name}
          </span>
          <span className="font-mono text-[10px] text-studio-ink-faint">
            {agent.handle}
          </span>
          <span
            className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow"
            style={{ color: stateColor(agent) }}
          >
            {agent.stateLabel}
          </span>
          <span className="ml-auto inline-flex items-baseline gap-2">
            <span className="font-mono text-[10px] font-medium tabular-nums text-studio-ink-faint">
              {agent.ago}
            </span>
            <HudScoutLink kind="agent" id={agent.id} size="medium" />
          </span>
        </header>

        {/* Pulse strip on its own labeled row */}
        <div
          className="mt-2 flex items-center gap-2"
          style={{ paddingLeft: 14 }}
        >
          <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            pulse
          </span>
          <HudActivityPulse values={agent.pulse} size="medium" dim={agent.dim} />
        </div>

        {/* Work */}
        <div
          className="mt-2 font-sans text-[12px] leading-snug text-studio-ink"
          style={{ paddingLeft: 14 }}
        >
          <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            work
          </span>{" "}
          <span>{agent.work}</span>
        </div>

        {/* Last action */}
        {agent.lastAction ? (
          <div
            className="mt-1.5 flex items-baseline gap-1.5 font-sans text-[11px] leading-snug text-studio-ink-muted"
            style={{ paddingLeft: 14 }}
          >
            <span className="font-mono text-[10px] text-studio-ink-faint">↪</span>
            <span className="min-w-0 flex-1">{agent.lastAction}</span>
            {agent.lastActionAgo ? (
              <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
                · {agent.lastActionAgo}
              </span>
            ) : null}
          </div>
        ) : (
          <div
            className="mt-1.5 font-mono text-[10px] text-studio-ink-faint"
            style={{ paddingLeft: 14 }}
          >
            —
          </div>
        )}
      </button>

      {engaged ? <FleetDetail agent={agent} size="medium" /> : null}
    </article>
  );
}

function FleetDetail({ agent, size }: { agent: FleetAgent; size: HudSize }) {
  const compact = size === "compact";
  const padX = compact ? "px-4" : size === "medium" ? "px-4" : "px-5";

  return (
    <div
      className={`border-t border-studio-edge bg-studio-canvas-alt ${padX} py-2.5`}
    >
      <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · last turn
      </div>
      <div className="mt-1 font-sans text-[12px] leading-snug text-studio-ink">
        {agent.lastAction ?? agent.work}
      </div>

      {agent.recentActions && agent.recentActions.length > 0 ? (
        <>
          <div className="mt-2.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · recent actions
          </div>
          <ul className="mt-1 flex flex-col gap-[2px]">
            {agent.recentActions.slice(0, 3).map((line, i) => (
              <li
                key={i}
                className="flex items-baseline gap-1.5 font-sans text-[11.5px] leading-snug text-studio-ink-muted"
              >
                <span className="font-mono text-[9px] text-studio-ink-faint">
                  ↪
                </span>
                <span className="min-w-0 flex-1">{line}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {agent.capabilities && agent.capabilities.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-baseline gap-1.5">
          <span className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · caps
          </span>
          {agent.capabilities.map((cap) => (
            <span
              key={cap}
              className="rounded-[2px] border border-studio-edge bg-studio-canvas px-1 py-px font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-muted"
            >
              {cap}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Large — three-pane treatment ────────────────────────────────────

function FleetColumnDivider() {
  return (
    <div
      aria-hidden
      className="shrink-0 self-stretch border-l border-studio-edge"
      style={{ width: 1 }}
    />
  );
}

/** Column A — manifest-style list of every fleet agent. The currently
 *  engaged row gets a 1.5px lime left rule + canvas-alt fill. State
 *  eyebrow and activity pulse stay inline on the same row. */
function FleetColumnA({
  agents,
  selectedId,
  onSelect,
}: {
  agents: FleetAgent[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="flex shrink-0 flex-col overflow-y-auto"
      style={{ width: FLEET_COL_A_W }}
    >
      <ul className="flex flex-col">
        {agents.map((a) => (
          <FleetColumnARow
            key={a.id}
            agent={a}
            selected={a.id === selectedId}
            onSelect={() => onSelect(a.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function FleetColumnARow({
  agent,
  selected,
  onSelect,
}: {
  agent: FleetAgent;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li
      className={[
        "relative border-b border-studio-edge",
        agent.dim ? "opacity-70" : "",
        selected ? "bg-studio-canvas-alt" : "",
      ].join(" ")}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[1.5px]"
          style={{ background: "var(--scout-accent)" }}
        />
      ) : null}
      <button
        type="button"
        onClick={onSelect}
        className="group w-full px-3.5 py-2.5 text-left transition-colors hover:bg-studio-canvas-alt"
      >
        <div className="flex items-baseline gap-2">
          <span className="relative inline-flex translate-y-[2px]">
            <AgentPresenceDot
              state={agent.state}
              size="sm"
              withHalo={agent.isWorking}
            />
          </span>
          <span className="font-sans text-[12.5px] font-semibold leading-none tracking-tight text-studio-ink">
            {agent.name}
          </span>
          <span className="font-mono text-[9.5px] text-studio-ink-faint">
            {agent.handle}
          </span>
          <span
            className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
            style={{ color: stateColor(agent) }}
          >
            {agent.stateLabel}
          </span>
          <span className="ml-auto inline-flex shrink-0 items-baseline gap-2">
            <HudActivityPulse values={agent.pulse} size="compact" dim={agent.dim} />
            <span className="font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
              {agent.ago}
            </span>
          </span>
        </div>
        <div
          className="mt-1.5 font-sans text-[11.5px] leading-snug text-studio-ink-muted"
          style={{ paddingLeft: 14 }}
        >
          {agent.work}
        </div>
      </button>
    </li>
  );
}

/** Column B — context for the engaged agent: header, work item,
 *  recent actions, stat block, drill list. */
function FleetColumnB({ agent }: { agent: FleetAgent }) {
  const recent = (agent.recentActions ?? []).slice(0, 3);
  const recentAgos = agent.recentActionAgos ?? [];

  return (
    <div
      className="flex shrink-0 flex-col gap-3 overflow-y-auto px-3.5 py-3"
      style={{ width: FLEET_COL_B_W }}
    >
      {/* Header */}
      <header className="flex items-baseline gap-2">
        <span className="relative inline-flex translate-y-[2px]">
          <AgentPresenceDot
            state={agent.state}
            size="sm"
            withHalo={agent.isWorking}
          />
        </span>
        <span className="font-sans text-[13px] font-semibold leading-none tracking-tight text-studio-ink">
          {agent.name}
        </span>
        <span className="font-mono text-[10px] text-studio-ink-faint">
          {agent.handle}
        </span>
        <span
          className="ml-auto font-mono text-[9px] font-semibold uppercase tracking-eyebrow"
          style={{ color: stateColor(agent) }}
        >
          {agent.stateLabel}
        </span>
      </header>

      {/* Work item — full sentence, sans 13 */}
      <section>
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · work
        </div>
        <p className="mt-1 font-sans text-[13px] leading-snug text-studio-ink">
          {agent.work}
        </p>
      </section>

      {/* Recent actions — last 3 with relative time, sans 12 ink-muted */}
      {recent.length > 0 ? (
        <section>
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · recent
          </div>
          <ul className="mt-1 flex flex-col gap-[3px]">
            {recent.map((line, i) => (
              <li
                key={i}
                className="flex items-baseline gap-1.5 font-sans text-[12px] leading-snug text-studio-ink-muted"
              >
                <span className="font-mono text-[10px] text-studio-ink-faint">↪</span>
                <span className="min-w-0 flex-1">{line}</span>
                {recentAgos[i] ? (
                  <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
                    · {recentAgos[i]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Stat block — mono eyebrow + sans value, three KVs */}
      <section className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <StatKV label="BRANCH" value={agent.branch ?? "—"} mono />
        <StatKV label="CWD" value={agent.cwd ?? "—"} mono />
        <StatKV label="MODEL" value={agent.model ?? "—"} mono />
      </section>

      {/* Drill list */}
      <section className="mt-auto flex flex-col gap-[3px]">
        <FleetDrillRow label="last 5 turns" count={5} />
        <FleetDrillRow label="changed files" count={14} />
        <FleetDrillRow label="message log" count={47} />
      </section>
    </div>
  );
}

function StatKV({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
      <span
        className={
          mono
            ? "truncate font-mono text-[11px] text-studio-ink"
            : "truncate font-sans text-[12px] text-studio-ink"
        }
      >
        {value}
      </span>
    </>
  );
}

function FleetDrillRow({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded-[2px] px-1.5 py-1 text-left transition-colors hover:bg-studio-canvas-alt"
    >
      <span aria-hidden className="font-mono text-[11px] text-studio-ink-faint">
        →
      </span>
      <span className="flex-1 font-mono text-[10.5px] uppercase tracking-eyebrow text-studio-ink-muted">
        {label}
      </span>
      <span className="rounded-[2px] border border-studio-edge bg-studio-canvas px-1 py-px font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
        ({count})
      </span>
    </button>
  );
}

/** Column C — full text of the engaged agent's most recent turn, wrapped
 *  at column width, with a · LAST TURN · @agent eyebrow on top and a
 *  small · TURN BUFFER · N/5 indicator + pagination dots below. */
function FleetColumnC({ agent }: { agent: FleetAgent }) {
  const body =
    agent.lastTurnText ?? agent.lastAction ?? agent.work ?? "—";
  const pos = agent.turnBufferPosition ?? 5;
  const total = agent.turnBufferTotal ?? 5;

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-3.5 py-3">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · LAST TURN · {agent.handle}
      </div>
      <p className="mt-2 font-sans text-[12px] leading-relaxed text-studio-ink">
        {body}
      </p>
      <div className="mt-auto flex items-center gap-2 pt-3">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · TURN BUFFER ·
        </span>
        <span className="font-mono text-[10px] tabular-nums text-studio-ink-muted">
          {pos}/{total}
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              aria-hidden
              className="inline-block rounded-full"
              style={{
                width: 4,
                height: 4,
                background:
                  i === pos - 1
                    ? "var(--scout-accent)"
                    : "var(--studio-edge)",
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
