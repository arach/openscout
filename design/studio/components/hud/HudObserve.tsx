/**
 * Observe tab content. Structured, time-bucketed activity view — the
 * pattern previously named "tail" in the studio. Same spine grid
 * pattern across sizes; the time gutter is relative-only at compact,
 * stacked relative + absolute at medium/large; dispatch column widens
 * accordingly. Square 3px tick on the spine for normal rows, 5px lime
 * for emphasized.
 *
 * Universal row affordances:
 *   · Preview-engage  — click anywhere on the row to expand inline
 *   · Scout link       — trailing ↗ chip linking to scout.local/event/<id>
 */

"use client";

import { useState } from "react";
import { HudScoutLink } from "./HudScoutLink";
import { HudSectionHeader } from "./HudSectionHeader";
import { OBSERVE, OBSERVE_KIND_LABEL } from "./mock";
import { OBSERVE_GRID } from "./tokens";
import type {
  EngageState,
  HudSize,
  ObserveBucket,
  ObserveEvent,
} from "./types";

export function HudObserve({ size }: { size: HudSize }) {
  // One engaged row id, scoped to this tab's rows across all buckets.
  const [engaged, setEngaged] = useState<EngageState>(null);

  return (
    <section>
      {OBSERVE.map((bucket) => (
        <ObserveBucketView
          key={bucket.headline}
          bucket={bucket}
          size={size}
          engaged={engaged}
          onEngage={setEngaged}
        />
      ))}
    </section>
  );
}

function ObserveBucketView({
  bucket,
  size,
  engaged,
  onEngage,
}: {
  bucket: ObserveBucket;
  size: HudSize;
  engaged: EngageState;
  onEngage: (id: EngageState) => void;
}) {
  return (
    <div>
      <HudSectionHeader
        eyebrow={bucket.eyebrow}
        headline={bucket.headline}
        size={size}
      />
      <ul className="relative flex flex-col">
        {bucket.events.map((event) => (
          <ObserveRow
            key={event.id}
            event={event}
            size={size}
            engaged={engaged === event.id}
            onToggle={() =>
              onEngage(engaged === event.id ? null : event.id)
            }
          />
        ))}
      </ul>
    </div>
  );
}

function ObserveRow({
  event,
  size,
  engaged,
  onToggle,
}: {
  event: ObserveEvent;
  size: HudSize;
  engaged: boolean;
  onToggle: () => void;
}) {
  const compact = size === "compact";
  const padY = compact ? "py-2" : "py-2.5";
  const padR = compact ? "pr-3.5" : size === "medium" ? "pr-4" : "pr-5";

  return (
    <li
      className={`relative border-b border-studio-edge ${
        engaged ? "bg-studio-canvas-alt" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`grid w-full text-left transition-colors hover:bg-studio-canvas-alt ${padY} ${padR}`}
        style={{ gridTemplateColumns: OBSERVE_GRID[size] }}
      >
        {/* Time gutter — relative-only at compact; stacked relative +
            absolute at medium + large. */}
        {compact ? (
          <span className="self-start pt-[1px] text-right font-mono text-[10px] font-medium tabular-nums text-studio-ink-faint">
            {event.ago}
          </span>
        ) : (
          <span className="flex flex-col items-end self-start pt-[1px]">
            <span className="font-mono text-[10.5px] font-medium tabular-nums text-studio-ink-muted">
              {event.ago}
            </span>
            <span className="font-mono text-[9px] tabular-nums text-studio-ink-faint">
              {event.at}
            </span>
          </span>
        )}

        <span aria-hidden />

        {/* Spine + tick — 3px square centered on the 1px spine, 5px lime
            for emphasized. */}
        <span aria-hidden className="relative bg-studio-edge">
          <span
            className="absolute block"
            style={{
              top: 8,
              left: event.emphasized ? -2 : -1,
              width: event.emphasized ? 5 : 3,
              height: event.emphasized ? 5 : 3,
              background: event.emphasized
                ? "var(--scout-accent)"
                : "var(--studio-ink-faint)",
            }}
          />
        </span>

        <span aria-hidden />

        {/* Dispatch */}
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span
              className={
                compact
                  ? "font-sans text-[12px] font-semibold leading-none text-studio-ink"
                  : "font-sans text-[12.5px] font-semibold leading-none text-studio-ink"
              }
            >
              {event.agent}
            </span>
            {compact ? null : (
              <span className="font-mono text-[10px] text-studio-ink-faint">
                {event.handle}
              </span>
            )}
            <span
              className="font-mono text-[9px] font-bold uppercase tracking-eyebrow"
              style={{
                color: event.emphasized
                  ? "var(--scout-accent)"
                  : "var(--studio-ink-faint)",
              }}
            >
              {OBSERVE_KIND_LABEL[event.kind]}
            </span>
            <span className="ml-auto inline-flex items-baseline">
              <HudScoutLink
                kind="event"
                id={event.id}
                size={size}
                rowHoverGated
              />
            </span>
          </div>
          <div
            className={
              event.emphasized
                ? compact
                  ? "mt-[3px] font-sans text-[11px] leading-snug text-studio-ink"
                  : "mt-1 font-sans text-[12px] leading-snug text-studio-ink"
                : compact
                  ? "mt-[3px] font-sans text-[11px] leading-snug text-studio-ink-muted"
                  : "mt-1 font-sans text-[12px] leading-snug text-studio-ink-muted"
            }
          >
            {event.line}
          </div>
          {compact ? null : (
            <div className="mt-1.5 font-mono text-[10px] leading-snug text-studio-ink-faint">
              {event.meta}
            </div>
          )}
        </div>
      </button>

      {engaged ? (
        <ObserveDetail event={event} size={size} />
      ) : null}
    </li>
  );
}

function ObserveDetail({
  event,
  size,
}: {
  event: ObserveEvent;
  size: HudSize;
}) {
  const compact = size === "compact";
  const padX = compact ? "px-4" : size === "medium" ? "px-4" : "px-5";

  return (
    <div
      className={`border-t border-studio-edge bg-studio-canvas-alt ${padX} py-2.5`}
    >
      <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · event detail
      </div>
      <div className="mt-1.5 font-sans text-[12.5px] font-semibold leading-tight text-studio-ink">
        {event.line}
      </div>
      {event.summary ? (
        <div className="mt-1 font-sans text-[11.5px] leading-snug text-studio-ink-muted">
          {event.summary}
        </div>
      ) : null}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px] font-mono text-[10px] leading-snug">
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">kind</dt>
        <dd
          className="font-bold uppercase tracking-eyebrow"
          style={{
            color: event.emphasized
              ? "var(--scout-accent)"
              : "var(--studio-ink-muted)",
          }}
        >
          {OBSERVE_KIND_LABEL[event.kind]}
        </dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">source</dt>
        <dd className="text-studio-ink-muted">
          {event.agent} {event.handle}
        </dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">at</dt>
        <dd className="tabular-nums text-studio-ink-muted">
          {event.at} · {event.ago} ago
        </dd>
        {event.flightId ? (
          <>
            <dt className="uppercase tracking-eyebrow text-studio-ink-faint">flight</dt>
            <dd className="tabular-nums text-studio-ink-muted">
              {event.flightId}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
