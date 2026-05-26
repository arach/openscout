/**
 * HudAssistant — slot 5 tab body.
 *
 * A DM-style thread with the universal assistant. Same brand on every
 * surface (iOS + desktop) per project-hud-slot5-scout-surface, so the
 * agent on the other end is the same Scout that powers iOS — the tab
 * is just a desktop view of that conversation.
 *
 * Layout:
 *   compact / medium → single-column thread + small "ASK" eyebrow header
 *   large            → two-pane: thread left (~600), context rail right
 *                      (current channel · suggested commands · recent
 *                      asks). The dock target stays @scout regardless.
 *
 * Inline rendering for message bodies:
 *   text     → plain prose, sans body
 *   mention  → @handle in scout-accent
 *   cmd      → /command in lime chip
 *   path     → file path in path-hue
 *   code     → backticked, ink + medium weight, mono
 *
 * No real form behavior in studio — the actual send happens through
 * HudMessageDock with the target auto-staged to @scout when this tab
 * is active (wired in the Swift port).
 */

import { SCOUT_THREAD } from "./mock";
import { PANEL_PAD_X } from "./tokens";
import type {
  HudSize,
  ScoutThreadMessage,
  ScoutThreadSpan,
} from "./types";

export function HudAssistant({ size }: { size: HudSize }) {
  if (size === "large") {
    return <LargeAssistant />;
  }
  return <CompactMediumAssistant size={size} />;
}

// ─── Compact + Medium — single-column thread ────────────────────────

function CompactMediumAssistant({ size }: { size: HudSize }) {
  return (
    <div className="flex h-full flex-col">
      <ThreadHeader size={size} />
      <div className="flex-1 overflow-y-auto">
        <div className={`${PANEL_PAD_X[size]} py-2.5`}>
          <Thread messages={SCOUT_THREAD} size={size} />
        </div>
      </div>
    </div>
  );
}

// ─── Large — two-pane (thread + context rail) ───────────────────────

function LargeAssistant() {
  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col border-r border-studio-edge">
        <ThreadHeader size="large" />
        <div className="flex-1 overflow-y-auto">
          <div className={`${PANEL_PAD_X.large} py-3`}>
            <Thread messages={SCOUT_THREAD} size="large" />
          </div>
        </div>
      </div>
      <aside className="w-[300px] shrink-0 overflow-y-auto">
        <ContextRail />
      </aside>
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────

function ThreadHeader({ size }: { size: HudSize }) {
  return (
    <div
      className={`flex items-baseline gap-3 border-b border-studio-edge ${PANEL_PAD_X[size]} py-2`}
    >
      <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · DESKTOP THREAD · TODAY
      </span>
      <span className="ml-auto inline-flex items-baseline gap-1.5">
        <span
          className="inline-block h-[5px] w-[5px] translate-y-[-1px] rounded-full"
          style={{ background: "var(--scout-accent)" }}
        />
        <span className="font-mono text-[10px] font-bold tracking-eyebrow text-studio-ink">
          ONLINE
        </span>
      </span>
    </div>
  );
}

// ─── Thread ─────────────────────────────────────────────────────────

function Thread({
  messages,
  size,
}: {
  messages: ScoutThreadMessage[];
  size: HudSize;
}) {
  return (
    <ol className="flex flex-col gap-3.5">
      {messages.map((m) => (
        <li key={m.id}>
          <Message message={m} size={size} />
        </li>
      ))}
    </ol>
  );
}

function Message({
  message,
  size,
}: {
  message: ScoutThreadMessage;
  size: HudSize;
}) {
  const isScout = message.source === "scout";
  const sourceLabel = isScout ? "scout" : "you";
  const bodySize =
    size === "compact" ? "text-[11.5px]" : size === "medium" ? "text-[12.5px]" : "text-[13px]";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        {isScout ? <RobotGlyph size={12} /> : <YouGlyph size={12} />}
        <span
          className="font-mono text-[10.5px] font-semibold lowercase"
          style={{
            color: isScout ? "var(--scout-accent)" : "var(--studio-ink)",
          }}
        >
          @{sourceLabel}
        </span>
        <span className="ml-auto font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
          {message.at}
        </span>
      </div>
      <div className={`pl-[18px] font-sans ${bodySize} leading-[1.5] text-studio-ink-muted`}>
        {message.body.map((span, i) => (
          <Span key={i} span={span} />
        ))}
      </div>
    </div>
  );
}

// ─── Inline spans ───────────────────────────────────────────────────

function Span({ span }: { span: ScoutThreadSpan }) {
  switch (span.kind) {
    case "text":
      return <span className="text-studio-ink">{span.text}</span>;
    case "mention":
      return (
        <span
          className="font-mono text-[0.92em] font-semibold"
          style={{ color: "var(--scout-accent)" }}
        >
          {span.text}
        </span>
      );
    case "cmd":
      return (
        <span
          className="mx-[1px] inline-flex items-baseline rounded-[3px] border px-1.5 py-[1px] font-mono text-[0.88em] font-semibold"
          style={{
            color: "var(--scout-accent)",
            borderColor:
              "color-mix(in oklab, var(--scout-accent) 45%, transparent)",
          }}
        >
          {span.text}
        </span>
      );
    case "path":
      return (
        <span
          className="font-mono text-[0.92em]"
          style={{ color: "rgb(107, 184, 178)" }}
        >
          {span.text}
        </span>
      );
    case "code":
      return (
        <span className="font-mono text-[0.92em] font-medium text-studio-ink">
          {span.text}
        </span>
      );
  }
}

// ─── Context rail (large only) ──────────────────────────────────────

function ContextRail() {
  return (
    <div className="flex flex-col gap-5 px-4 py-4">
      <RailSection label="QUICK">
        <RailCmd cmd="/help" hint="all commands" />
        <RailCmd cmd="/find" hint="agent by name or work" />
        <RailCmd cmd="/spin" hint="start a new agent" />
        <RailCmd cmd="/recent" hint="last 24h activity" />
      </RailSection>
      <RailSection label="ON YOU">
        <RailMention name="hudson" detail="compile error · 7m" />
      </RailSection>
      <RailSection label="RECENT ASKS">
        <RailRecent text="status pass on hudson" at="09:14" />
        <RailRecent text="open Sources/Mesh/PresenceCache.swift" at="09:15" />
      </RailSection>
    </div>
  );
}

function RailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {label}
      </span>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

function RailCmd({ cmd, hint }: { cmd: string; hint: string }) {
  return (
    <button
      type="button"
      className="flex items-baseline gap-2 rounded-[3px] px-1.5 py-[3px] text-left transition-colors hover:bg-studio-canvas-alt"
    >
      <span
        className="font-mono text-[10.5px] font-semibold"
        style={{ color: "var(--scout-accent)" }}
      >
        {cmd}
      </span>
      <span className="font-sans text-[10.5px] text-studio-ink-muted">{hint}</span>
    </button>
  );
}

function RailMention({ name, detail }: { name: string; detail: string }) {
  return (
    <button
      type="button"
      className="flex items-baseline gap-2 rounded-[3px] px-1.5 py-[3px] text-left transition-colors hover:bg-studio-canvas-alt"
    >
      <span
        className="font-mono text-[10.5px] font-semibold"
        style={{ color: "var(--scout-accent)" }}
      >
        @{name}
      </span>
      <span className="font-mono text-[9.5px] text-studio-ink-faint">{detail}</span>
    </button>
  );
}

function RailRecent({ text, at }: { text: string; at: string }) {
  return (
    <div className="flex items-baseline gap-2 px-1.5 py-[2px]">
      <span className="font-sans text-[10.5px] text-studio-ink-muted">{text}</span>
      <span className="ml-auto font-mono text-[9px] tabular-nums text-studio-ink-faint">
        {at}
      </span>
    </div>
  );
}

// ─── Glyphs (hand-drawn, no SF Symbols / icon libs) ─────────────────

/** Robot head — masthead glyph for the assistant tab + per-message
 *  signpost on Scout's messages. Designed to translate cleanly to a
 *  SwiftUI Shape for the native port: rounded square head, two dot
 *  eyes, antenna with finial. */
export function RobotGlyph({ size = 14 }: { size?: number }) {
  const sw = 1;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      {/* antenna */}
      <line
        x1={7}
        y1={1.5}
        x2={7}
        y2={3}
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
      />
      <circle cx={7} cy={1.2} r={0.7} fill="currentColor" />
      {/* head */}
      <rect
        x={2.5}
        y={3.2}
        width={9}
        height={7.6}
        rx={1.8}
        stroke="currentColor"
        strokeWidth={sw}
        fill="none"
      />
      {/* eyes */}
      <circle cx={5.2} cy={6.6} r={0.85} fill="currentColor" />
      <circle cx={8.8} cy={6.6} r={0.85} fill="currentColor" />
      {/* mouth */}
      <line
        x1={5.4}
        y1={8.8}
        x2={8.6}
        y2={8.8}
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
      />
      {/* feet (just two small ticks at the bottom) */}
      <line
        x1={4.5}
        y1={11.4}
        x2={4.5}
        y2={12.4}
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
      />
      <line
        x1={9.5}
        y1={11.4}
        x2={9.5}
        y2={12.4}
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Operator marker — a small caret / chevron facing right so it reads
 *  as "you said" without competing with the robot glyph's silhouette. */
function YouGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <polyline
        points="4,3 10,7 4,11"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
