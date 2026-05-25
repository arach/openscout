/**
 * Sessions tab content. Single-line snippet at compact; 3-line pane
 * preview card on canvas-alt inside a hairline at medium/large.
 *
 * Universal row affordances:
 *   · Preview-engage  — click anywhere on the row to expand inline
 *   · Scout link       — trailing ↗ chip linking to scout.local/session/<id>
 */

"use client";

import { useState } from "react";
import { HudScoutLink } from "./HudScoutLink";
import { HudSectionHeader } from "./HudSectionHeader";
import { SESSIONS } from "./mock";
import {
  SESSION_PANE_LINES,
  SESSION_PANE_LINES_ENGAGED,
} from "./tokens";
import type {
  EngageState,
  HudSize,
  ScoutSession,
  SessionKind,
} from "./types";

export function HudSessions({ size }: { size: HudSize }) {
  const [engaged, setEngaged] = useState<EngageState>(null);

  return (
    <section>
      <HudSectionHeader
        eyebrow={`TERMINALS · ${SESSIONS.length} ROOMS`}
        headline="Local sessions"
        size={size}
      />
      <ul className="flex flex-col">
        {SESSIONS.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            size={size}
            engaged={engaged === s.id}
            onToggle={() => setEngaged(engaged === s.id ? null : s.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function SessionRow({
  session,
  size,
  engaged,
  onToggle,
}: {
  session: ScoutSession;
  size: HudSize;
  engaged: boolean;
  onToggle: () => void;
}) {
  const compact = size === "compact";
  const glyphColor = session.attached
    ? "var(--scout-accent)"
    : "var(--studio-ink-muted)";

  const padX = compact ? "pl-4 pr-3.5" : size === "medium" ? "pl-4 pr-4" : "pl-5 pr-5";
  const padY = compact ? "pt-2.5 pb-2.5" : "pt-3 pb-3";

  return (
    <li
      className={`relative border-b border-studio-edge ${
        engaged ? "bg-studio-canvas-alt" : ""
      }`}
    >
      {session.attached ? (
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
        {/* Top line: glyph · name · attached · ago · ↗ */}
        <div className="flex items-baseline gap-2.5">
          <SessionGlyph kind={session.kind} color={glyphColor} />
          <span className="font-mono text-[13.5px] font-semibold leading-none text-studio-ink">
            {session.name}
          </span>
          {session.attached ? <CursorBlock /> : null}
          <span className="ml-auto inline-flex items-baseline gap-2">
            <span className="font-mono text-[10px] font-medium tabular-nums text-studio-ink-muted">
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

        {/* Meta line: KIND · N WIN · ATTACHED (compact) / + CWD (medium/large) */}
        <div
          className="mt-1.5 flex items-baseline gap-1.5"
          style={{ paddingLeft: 25 }}
        >
          <span
            className="font-mono text-[9px] font-bold uppercase"
            style={{
              color: session.attached
                ? "var(--scout-accent)"
                : "var(--studio-ink-faint)",
            }}
          >
            {session.kind}
          </span>
          <MetaDot />
          <span className="font-mono text-[9px] font-semibold uppercase text-studio-ink-faint">
            {session.windows} {session.windows === 1 ? "WIN" : "WINS"}
          </span>
          {session.attached ? (
            <>
              <MetaDot />
              <span
                className="font-mono text-[9px] font-bold uppercase"
                style={{ color: "var(--scout-accent)" }}
              >
                ATTACHED
              </span>
            </>
          ) : null}
          {compact ? null : (
            <>
              <MetaDot />
              <span className="truncate font-mono text-[10px] text-studio-ink-muted">
                {session.cwd}
              </span>
            </>
          )}
        </div>

        {/* Snippet (compact) vs full pane preview (medium + large) */}
        {compact ? (
          <div
            className="mt-1 truncate font-mono text-[10.5px] text-studio-ink-muted"
            style={{ paddingLeft: 25 }}
          >
            {session.snippet}
          </div>
        ) : (
          <div
            className="mt-2.5 overflow-hidden rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-2.5 py-1.5"
            style={{ marginLeft: 25 }}
          >
            {session.pane.slice(0, SESSION_PANE_LINES[size]).map((line, i) => (
              <div
                key={i}
                className="truncate font-mono text-[10.5px] leading-[1.55] text-studio-ink-muted"
              >
                {line}
              </div>
            ))}
          </div>
        )}
      </button>

      {engaged ? <SessionDetail session={session} size={size} /> : null}
    </li>
  );
}

function SessionDetail({
  session,
  size,
}: {
  session: ScoutSession;
  size: HudSize;
}) {
  const compact = size === "compact";
  const padX = compact ? "px-4" : size === "medium" ? "px-4" : "px-5";

  return (
    <div className={`border-t border-studio-edge bg-studio-canvas-alt ${padX} py-2.5`}>
      <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · pane
      </div>
      <div className="mt-1 overflow-hidden rounded-[3px] border border-studio-edge bg-studio-canvas px-2.5 py-1.5">
        {session.pane
          .slice(0, SESSION_PANE_LINES_ENGAGED)
          .map((line, i) => (
            <div
              key={i}
              className="truncate font-mono text-[10.5px] leading-[1.55] text-studio-ink-muted"
            >
              {line}
            </div>
          ))}
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px] font-mono text-[10px] leading-snug">
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">cwd</dt>
        <dd className="truncate text-studio-ink-muted">{session.cwd}</dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">client</dt>
        <dd className="text-studio-ink-muted">
          {session.client ?? (session.attached ? "attached" : "detached")}
        </dd>
        {session.lastCommand ? (
          <>
            <dt className="uppercase tracking-eyebrow text-studio-ink-faint">last</dt>
            <dd className="truncate text-studio-ink-muted">
              {session.lastCommand}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
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

function CursorBlock() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-1.5 translate-y-[2px] animate-pulse"
      style={{ background: "var(--scout-accent)" }}
    />
  );
}

function SessionGlyph({
  kind,
  color,
}: {
  kind: SessionKind;
  color: string;
}) {
  if (kind === "tmux") {
    return (
      <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
        <rect
          x="1.5"
          y="1.5"
          width="13"
          height="11"
          fill="none"
          stroke={color}
          strokeWidth="1"
        />
        <line x1="8" y1="1.5" x2="8" y2="12.5" stroke={color} strokeWidth="1" />
        <line x1="8" y1="7" x2="14.5" y2="7" stroke={color} strokeWidth="1" />
        <rect
          x="8.5"
          y="7.5"
          width="5.5"
          height="4.5"
          fill={color}
          fillOpacity="0.32"
        />
      </svg>
    );
  }
  if (kind === "iterm") {
    return (
      <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
        <polyline
          points="2.5,3.5 7,7 2.5,10.5"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="8.5" y="9.6" width="5" height="1.6" fill={color} />
      </svg>
    );
  }
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="9"
        fill="none"
        stroke={color}
        strokeWidth="1"
      />
      <line
        x1="1.5"
        y1="5"
        x2="14.5"
        y2="5"
        stroke={color}
        strokeOpacity="0.55"
        strokeWidth="0.75"
      />
      <polyline
        points="3.5,7 5.5,8.5 3.5,10"
        fill="none"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
