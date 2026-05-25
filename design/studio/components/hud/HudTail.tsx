/**
 * Tail tab content — firehose pattern.
 *
 * Dense mono rows, one event per line. No buckets, no time-stacking,
 * no spine. Mirrors the oxtail surface in the web app. Newest at top.
 *
 * Row format:
 *   [HH:MM:SS] [KND] [source-agent] · <dispatch line>
 *
 * Sizing:
 *   compact → 11px mono
 *   medium  → 11.5px mono
 *   large   → 12px mono
 *
 * Emphasized rows lift to ink + lime kind marker. All others are
 * ink-faint by default. Each row is preview-engage-able and has a
 * trailing scout-link.
 */

"use client";

import { useState } from "react";
import { HudScoutLink } from "./HudScoutLink";
import { HudSectionHeader } from "./HudSectionHeader";
import { FIREHOSE } from "./mock";
import type { EngageState, FirehoseEvent, HudSize } from "./types";

const ROW_FONT_PX: Record<HudSize, number> = {
  compact: 11,
  medium: 11.5,
  large: 12,
};

export function HudTail({ size }: { size: HudSize }) {
  const [engaged, setEngaged] = useState<EngageState>(null);

  return (
    <section>
      <HudSectionHeader
        eyebrow={`FIREHOSE · ${FIREHOSE.length} EVENTS`}
        headline="Tail"
        size={size}
      />
      <ul className="flex flex-col">
        {FIREHOSE.map((event, idx) => (
          <TailRow
            key={event.id}
            event={event}
            prev={FIREHOSE[idx - 1]}
            next={FIREHOSE[idx + 1]}
            size={size}
            engaged={engaged === event.id}
            onToggle={() =>
              setEngaged(engaged === event.id ? null : event.id)
            }
          />
        ))}
      </ul>
    </section>
  );
}

function TailRow({
  event,
  prev,
  next,
  size,
  engaged,
  onToggle,
}: {
  event: FirehoseEvent;
  prev: FirehoseEvent | undefined;
  next: FirehoseEvent | undefined;
  size: HudSize;
  engaged: boolean;
  onToggle: () => void;
}) {
  const compact = size === "compact";
  const padX = compact ? "pl-3 pr-3" : size === "medium" ? "pl-4 pr-4" : "pl-5 pr-5";
  const padY = compact ? "py-[3px]" : "py-1";
  const fontPx = ROW_FONT_PX[size];

  const inkBody = event.emphasized
    ? "var(--studio-ink)"
    : "var(--studio-ink-faint)";
  const kindColor = event.emphasized
    ? "var(--scout-accent)"
    : "var(--studio-ink-muted)";

  return (
    <li
      className={`border-b border-studio-edge ${
        engaged ? "bg-studio-canvas-alt" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`group flex w-full items-baseline gap-2 text-left transition-colors hover:bg-studio-canvas-alt ${padX} ${padY}`}
        style={{ fontSize: fontPx }}
      >
        <span
          className="font-mono tabular-nums"
          style={{ color: "var(--studio-ink-faint)" }}
        >
          {event.at}
        </span>
        <span
          className="font-mono font-bold uppercase tracking-[0.04em]"
          style={{ color: kindColor }}
        >
          {event.kind}
        </span>
        <span
          className="font-mono"
          style={{ color: inkBody, opacity: 0.85 }}
        >
          @{event.source}
        </span>
        <span
          className="font-mono"
          style={{ color: "var(--studio-ink-faint)" }}
        >
          ·
        </span>
        <span
          className="min-w-0 flex-1 truncate font-mono"
          style={{ color: inkBody }}
        >
          {event.line}
        </span>
        <span className="ml-2 shrink-0">
          <HudScoutLink
            kind="firehose"
            id={event.id}
            size={size}
            rowHoverGated
          />
        </span>
      </button>

      {engaged ? (
        <TailDetail event={event} prev={prev} next={next} size={size} />
      ) : null}
    </li>
  );
}

function TailDetail({
  event,
  prev,
  next,
  size,
}: {
  event: FirehoseEvent;
  prev: FirehoseEvent | undefined;
  next: FirehoseEvent | undefined;
  size: HudSize;
}) {
  const compact = size === "compact";
  const padX = compact ? "px-3" : size === "medium" ? "px-4" : "px-5";

  const line = (e: FirehoseEvent | undefined, label: string) =>
    e ? (
      <div className="truncate font-mono text-[10px] leading-snug text-studio-ink-faint">
        <span className="mr-1.5 uppercase tracking-eyebrow">{label}</span>
        {e.at} {e.kind} @{e.source} · {e.line}
      </div>
    ) : null;

  return (
    <div className={`border-t border-studio-edge bg-studio-canvas-alt ${padX} py-2`}>
      <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · raw
      </div>
      <div className="mt-1 break-all font-mono text-[11px] leading-snug text-studio-ink">
        [{event.at}] [{event.kind}] @{event.source} · {event.line}
      </div>
      <div className="mt-2 flex flex-col gap-[2px]">
        {line(prev, "PRV")}
        {line(next, "NXT")}
      </div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
        source · <span className="normal-case text-studio-ink-muted">@{event.source}</span>
      </div>
    </div>
  );
}
