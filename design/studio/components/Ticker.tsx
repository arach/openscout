"use client";

/**
 * Ticker — the scrolling activity-tape primitive.
 *
 * Owns:
 *  - The seamless infinite scroll (duplicate-and-translate-50% trick).
 *  - The morse-flavored event glyphs per kind.
 *  - The NOW/locked indicator on the right edge.
 *  - The edge fades (left seam, right NOW dissolve).
 *
 * Delegates steer behavior (chip cluster + input dock + mic + send) to
 * <QuickSteer> wrapped around each slot. Hover NEVER pauses the
 * scroll — only an open input dock does (you can't type on a moving
 * target). This keeps the ambient feel of the strip intact while
 * still allowing interactive steer.
 *
 * Telegraph, the HUD chrome bottom strip, and any other "agent
 * activity scroll" surface should compose this component.
 */

import { useId, useState } from "react";
import {
  QuickSteer,
  DEFAULT_STEER_ACTIONS,
  type SteerAction,
  type SteerActionGlyph,
  type SteerEvent,
  type SteerKind,
} from "@/components/QuickSteer";

// ── Backward-compat type aliases ─────────────────────────────────────
// These match the old TickerEvent/TickerAction/etc. names so the
// existing two callers (Telegraph study, HUD chrome study) keep
// importing without churn. New code can use the Steer* names directly
// from QuickSteer.

export type TickerKind = SteerKind;
export type TickerActionGlyph = SteerActionGlyph;
export type TickerAction = SteerAction;
export type TickerEvent = SteerEvent;

export const DEFAULT_TICKER_ACTIONS = DEFAULT_STEER_ACTIONS;

export interface TickerProps {
  events: TickerEvent[];
  speed?: "calm" | "brisk";
  mode?: "passive" | "steer";
  showNow?: boolean;
  /** Fires when an action commits. `text` is set only when the action
   *  used the input dock. Equivalent to QuickSteer's onAction. */
  onAction?: (event: TickerEvent, actionId: string, text?: string) => void;
  className?: string;
}

// ── Component ────────────────────────────────────────────────────────

export function Ticker({
  events,
  speed = "calm",
  mode = "passive",
  showNow = true,
  onAction,
  className,
}: TickerProps) {
  const id = useId().replace(/:/g, "");
  const duration = speed === "calm" ? "180s" : "90s";
  const isSteer = mode === "steer";
  // Track which slot(s) currently have an open input dock. We pause
  // scroll while any slot is locked, so the operator can type without
  // the target sliding out from under them.
  const [lockedKeys, setLockedKeys] = useState<Set<string>>(new Set());
  const locked = lockedKeys.size > 0;

  const setLocked = (key: string, isLocked: boolean) => {
    setLockedKeys((prev) => {
      const next = new Set(prev);
      if (isLocked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  return (
    <div
      className={[
        "relative border-y border-studio-edge bg-studio-canvas-alt",
        // overflow-x-clip lets chip clusters overflow upward while
        // still clipping the duplicated event row horizontally.
        "overflow-x-clip",
        className ?? "",
      ].join(" ")}
      style={{ overflowY: "visible" }}
    >
      <style>{`
        @keyframes ticker-scroll-${id} {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>

      <div
        className="flex w-max items-center py-2"
        style={{
          animation: `ticker-scroll-${id} ${duration} linear infinite`,
          animationPlayState: locked ? "paused" : "running",
        }}
      >
        {[...events, ...events].map((evt, i) => {
          const key = `${evt.id}-${i}`;
          return (
            <TickerSlot
              key={key}
              evt={evt}
              steer={isSteer}
              onAction={onAction}
              onLock={(isLocked) => setLocked(key, isLocked)}
            />
          );
        })}
      </div>

      {/* Right-edge NOW marker + locked indicator. Both pinned via
       *  absolute, so they don't scroll with the tape. */}
      {showNow ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 h-full w-16"
            style={{
              background:
                "linear-gradient(to right, transparent, color-mix(in oklab, var(--studio-canvas-alt) 92%, transparent) 60%, var(--studio-canvas-alt))",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 h-full w-px"
            style={{ background: "var(--scout-accent)", opacity: 0.78 }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute right-2 top-1 font-mono text-[8px] uppercase"
            style={{
              color: "var(--scout-accent)",
              letterSpacing: "0.22em",
            }}
          >
            {locked ? "locked" : "now"}
          </div>
        </>
      ) : null}

      {/* Soft fade on the LEFT edge so the looping seam dissolves. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 h-full w-10"
        style={{
          background:
            "linear-gradient(to right, var(--studio-canvas-alt), transparent)",
        }}
      />
    </div>
  );
}

// ── Slot ─────────────────────────────────────────────────────────────

export function tickerSlotWidth(kind: TickerKind): number {
  switch (kind) {
    case "message":
      return 130;
    case "work":
      return 170;
    case "decision":
      return 180;
    case "artifact":
      return 150;
  }
}

/** Pure presentational slot card — glyph + label + time/@agent — no
 *  width, no scrolling, no steer wrapping. The outer container sets
 *  width. Exported so static studies can render slots out of the
 *  scrolling context. */
export function TickerSlotCard({ evt }: { evt: TickerEvent }) {
  const color = `oklch(0.74 0.15 ${evt.agentHue})`;
  return (
    <div className="flex flex-col items-start gap-0.5 px-3 py-1">
      <div className="flex items-center gap-2">
        <Glyph kind={evt.kind} color={color} />
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {evt.label}
        </span>
      </div>
      <div
        className="font-mono text-[8.5px] tabular-nums text-studio-ink-faint"
        style={{ opacity: 0.7 }}
      >
        {evt.time} · @{evt.agent}
      </div>
    </div>
  );
}

function TickerSlot({
  evt,
  steer,
  onAction,
  onLock,
}: {
  evt: TickerEvent;
  steer: boolean;
  onAction?: (event: TickerEvent, actionId: string, text?: string) => void;
  onLock: (locked: boolean) => void;
}) {
  const width = tickerSlotWidth(evt.kind);

  if (!steer) {
    return (
      <div className="shrink-0" style={{ width: `${width}px` }}>
        <TickerSlotCard evt={evt} />
      </div>
    );
  }

  return (
    <QuickSteer
      event={evt}
      onAction={onAction}
      onLock={onLock}
      className="shrink-0"
      style={{ width: `${width}px`, cursor: "pointer" }}
    >
      <TickerSlotCard evt={evt} />
    </QuickSteer>
  );
}

// ── Event glyphs (morse-flavored) ────────────────────────────────────

function Glyph({ kind, color }: { kind: TickerKind; color: string }) {
  if (kind === "message") {
    return (
      <svg width={14} height={10} aria-hidden>
        <circle cx={7} cy={5} r={2.2} fill={color} />
      </svg>
    );
  }
  if (kind === "work") {
    return (
      <svg width={14} height={10} aria-hidden>
        <rect x={1} y={3.5} width={12} height={3} rx={1.2} fill={color} />
      </svg>
    );
  }
  if (kind === "decision") {
    return (
      <svg width={14} height={10} aria-hidden>
        <rect x={1} y={2.5} width={12} height={2} fill={color} />
        <rect x={1} y={5.5} width={12} height={2} fill={color} />
      </svg>
    );
  }
  // artifact
  return (
    <svg width={14} height={10} aria-hidden>
      <circle cx={7} cy={5} r={2.5} fill={color} />
      <circle cx={7} cy={5} r={4} fill="none" stroke={color} strokeWidth={0.6} opacity={0.4} />
    </svg>
  );
}
