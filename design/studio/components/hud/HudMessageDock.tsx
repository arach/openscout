/**
 * HudMessageDock — universal bottom-of-panel conversational dock.
 *
 * Replaces the old HudFooter on every panel. Always visible. Two stacked
 * rows at medium/large, one row at compact.
 *
 *   row 1 — activity strip  (e.g. `↑ 3 responses · 12 messages today`)
 *           collapses to an inline `12 msg ↑` chip at compact
 *   row 2 — input row       (mic glyph · text input · ↵ SEND · ESC + hotkey)
 *
 * The text input is rendered as a `<span>` placeholder — this is a studio
 * surface, no real form behavior. The mic is a hand-drawn SVG (no SF
 * Symbols, no third-party icon libs). All chrome reads ink-faint by
 * default; hover lifts to ink-muted. A hairline divider separates the
 * dock from the panel body above it.
 */

import { PANEL_PAD_X } from "./tokens";
import type { HudSize } from "./types";

const FULL_PLACEHOLDER =
  "talk to the assistant — / for commands, /s to search";
const COMPACT_PLACEHOLDER = "talk — / commands · /s search";

export function HudMessageDock({
  size,
  responseCount = 3,
  messageCount = 12,
}: {
  size: HudSize;
  responseCount?: number;
  messageCount?: number;
}) {
  if (size === "compact") {
    return <CompactDock responseCount={responseCount} messageCount={messageCount} />;
  }
  return (
    <MediumLargeDock
      size={size}
      responseCount={responseCount}
      messageCount={messageCount}
    />
  );
}

// ─── Compact — single 32px row ──────────────────────────────────────

function CompactDock({
  responseCount,
  messageCount,
}: {
  responseCount: number;
  messageCount: number;
}) {
  return (
    <div
      className={`flex items-center gap-2 bg-studio-canvas-alt ${PANEL_PAD_X.compact}`}
      style={{ height: 32 }}
    >
      <button
        type="button"
        aria-label="Voice input"
        className="grid h-5 w-5 shrink-0 place-items-center text-studio-ink-faint transition-colors hover:text-studio-ink-muted"
      >
        <MicGlyph size={12} />
      </button>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-studio-ink-faint">
        {COMPACT_PLACEHOLDER}
      </span>
      <span className="hidden shrink-0 items-baseline gap-1 font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint xs:inline-flex">
        <span aria-hidden>↑</span>
        <span className="tabular-nums">{responseCount}</span>
        <span>·</span>
        <span className="tabular-nums">{messageCount}</span>
        <span>msg</span>
      </span>
      <span className="inline-flex shrink-0 items-baseline gap-1 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors hover:text-[var(--scout-accent)]">
        <span aria-hidden>↵</span>
        <span>SEND</span>
      </span>
      <span className="rounded-[2px] border border-studio-edge bg-studio-canvas px-1 py-px font-mono text-[8px] font-bold tracking-[0.05em] text-studio-ink-faint">
        ESC
      </span>
      <HyperKeyChip />
    </div>
  );
}

// ─── Medium / Large — two rows ──────────────────────────────────────

function MediumLargeDock({
  size,
  responseCount,
  messageCount,
}: {
  size: HudSize;
  responseCount: number;
  messageCount: number;
}) {
  const isLarge = size === "large";
  const stripH = isLarge ? 18 : 16;
  const inputH = isLarge ? 46 : 36;
  const micBox = isLarge ? 28 : 24;
  const micSize = isLarge ? 16 : 14;
  const placeholderClass = isLarge
    ? "font-sans text-[12.5px] text-studio-ink-faint"
    : "font-sans text-[11.5px] text-studio-ink-faint";

  return (
    <div className="flex flex-col">
      {/* Activity strip — sits on panel-body canvas, reads as closing
          line of the content rather than part of the dock. */}
      <button
        type="button"
        className={`flex items-center gap-1.5 bg-studio-canvas text-left font-mono text-[10px] text-studio-ink-faint transition-colors hover:text-studio-ink-muted ${PANEL_PAD_X[size]}`}
        style={{ height: stripH }}
      >
        <span aria-hidden>↑</span>
        <span className="tabular-nums">{responseCount}</span>
        <span>responses</span>
        <span aria-hidden className="text-studio-ink-faint/70">·</span>
        <span className="tabular-nums">{messageCount}</span>
        <span>messages today</span>
      </button>

      {/* Input row — the actual dock surface, slightly lifted. */}
      <div
        className={`flex items-center gap-2.5 bg-studio-canvas-alt ${PANEL_PAD_X[size]}`}
        style={{ height: inputH }}
      >
        <button
          type="button"
          aria-label="Voice input"
          className="grid shrink-0 place-items-center text-studio-ink-faint transition-colors hover:text-studio-ink-muted"
          style={{ height: micBox, width: micBox }}
        >
          <MicGlyph size={micSize} />
        </button>
        <span className={`min-w-0 flex-1 truncate ${placeholderClass}`}>
          {FULL_PLACEHOLDER}
        </span>
        <span className="inline-flex shrink-0 items-baseline gap-1 font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors hover:text-[var(--scout-accent)]">
          <span aria-hidden>↵</span>
          <span>SEND</span>
        </span>
        <span className="ml-1 inline-flex shrink-0 items-center gap-2">
          <span className="rounded-[2px] border border-studio-edge bg-studio-canvas px-1 py-px font-mono text-[8px] font-bold tracking-[0.05em] text-studio-ink-faint">
            ESC
          </span>
          <HyperKeyChip />
        </span>
      </div>
    </div>
  );
}

// ─── Hand-drawn microphone (no SF Symbols, no icon libs) ────────────

function MicGlyph({ size = 14 }: { size?: number }) {
  // Capsule body (5,2 → 9,8.5 rx=2) + arc cradle + stem to base. Stroke
  // 1px, currentColor — inherits ink-faint / hover lift from the
  // button's text color.
  const sw = 1;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect
        x={5}
        y={2}
        width={4}
        height={6.5}
        rx={2}
        stroke="currentColor"
        strokeWidth={sw}
        fill="none"
      />
      <path
        d="M3.5 7.5 A3.5 3.5 0 0 0 10.5 7.5"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        fill="none"
      />
      <line
        x1={7}
        y1={10.5}
        x2={7}
        y2={12}
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </svg>
  );
}

function HyperKeyChip() {
  return (
    <span className="inline-flex items-center gap-[1px] rounded-[3px] border border-studio-edge bg-studio-canvas px-1.5 py-[1.5px]">
      {["⌃", "⌥", "⇧", "⌘"].map((g) => (
        <span
          key={g}
          className="font-mono text-[8px] font-semibold text-studio-ink-faint"
        >
          {g}
        </span>
      ))}
      <span
        className="ml-[1px] font-mono text-[8px] font-bold"
        style={{ color: "var(--scout-accent)" }}
      >
        H
      </span>
    </span>
  );
}
