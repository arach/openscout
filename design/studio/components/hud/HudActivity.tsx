/**
 * Activity tab content. Structured, time-bucketed event ledger —
 * translates the webapp's ActivityScreen treatment into the HUD vocab.
 *
 * Visual signature (distinct from tail):
 *   · Time gutter with relative + absolute timestamps stacked.
 *   · 1px spine with a 3px square tick (5px lime for emphasized).
 *   · Each row has: CATEGORY · KIND eyebrow row, then a sans 13 title,
 *     then a sans 12 muted summary, then a byline strip with an initial
 *     avatar + agent name + scope.
 *   · Time-bucket headers ("Just now", "Last hour") use the standard
 *     HudSectionHeader.
 *
 * At large, switches to a two-pane treatment:
 *   A · Event ledger (list)    ~480
 *   B · Event detail (sticky)  fills remainder
 *
 * Universal row affordances:
 *   · Engage     — click anywhere on the row to expand inline (compact/medium)
 *                  or swap the detail pane (large). Esc closes.
 *   · Scout link — trailing ↗ chip linking to scout.local/event/<id>.
 */

"use client";

import { HudScoutLink } from "./HudScoutLink";
import { HudSectionHeader } from "./HudSectionHeader";
import {
  ACTIVITY,
  ACTIVITY_CATEGORY_LABEL,
  ACTIVITY_KIND_LABEL,
} from "./mock";
import { ACTIVITY_GRID } from "./tokens";
import type { ActivityBucket, ActivityEvent, HudSize } from "./types";
import { useHudEngage } from "./useHudEngage";

const LIST_COL_W_LARGE = 480;

export function HudActivity({ size }: { size: HudSize }) {
  const engage = useHudEngage();

  if (size === "large") {
    const allEvents = ACTIVITY.flatMap((b) => b.events);
    const selectedId =
      (engage.engaged && allEvents.find((e) => e.id === engage.engaged)?.id) ??
      allEvents[0]?.id ??
      null;
    const selected = allEvents.find((e) => e.id === selectedId) ?? allEvents[0];

    return (
      <section className="flex h-full flex-col">
        <HudSectionHeader
          eyebrow={`LEDGER · ${allEvents.length} EVENTS`}
          headline="Activity"
          size="large"
        />
        <div className="flex min-h-0 flex-1">
          <div
            className="shrink-0 overflow-y-auto"
            style={{ width: LIST_COL_W_LARGE }}
          >
            {ACTIVITY.map((bucket) => (
              <ActivityBucketView
                key={bucket.headline}
                bucket={bucket}
                size="large"
                engagedId={selected?.id ?? null}
                onSelect={(id) => engage.select(id)}
                forceSelectMode
              />
            ))}
          </div>
          <div
            aria-hidden
            className="shrink-0 self-stretch border-l border-studio-edge"
            style={{ width: 1 }}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {selected ? <ActivityDetailLarge event={selected} /> : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      {ACTIVITY.map((bucket) => (
        <ActivityBucketView
          key={bucket.headline}
          bucket={bucket}
          size={size}
          engagedId={engage.engaged}
          onSelect={(id) => engage.toggle(id)}
        />
      ))}
    </section>
  );
}

function ActivityBucketView({
  bucket,
  size,
  engagedId,
  onSelect,
  forceSelectMode,
}: {
  bucket: ActivityBucket;
  size: HudSize;
  engagedId: string | null;
  onSelect: (id: string) => void;
  /** At large, click selects (no toggle to close). */
  forceSelectMode?: boolean;
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
          <ActivityRow
            key={event.id}
            event={event}
            size={size}
            engaged={engagedId === event.id}
            onClick={() => onSelect(event.id)}
            showInlineDetail={!forceSelectMode}
          />
        ))}
      </ul>
    </div>
  );
}

function categoryColor(category: ActivityEvent["category"]): string {
  // Categories share the single lime accent — no rainbow. Coordination
  // and presence sit a notch dimmer than work; system is the dimmest.
  return category === "work" || category === "coordination"
    ? "var(--scout-accent)"
    : "var(--studio-ink-muted)";
}

function ActivityRow({
  event,
  size,
  engaged,
  onClick,
  showInlineDetail,
}: {
  event: ActivityEvent;
  size: HudSize;
  engaged: boolean;
  onClick: () => void;
  showInlineDetail: boolean;
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
      {engaged ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[1.5px]"
          style={{ background: "var(--scout-accent)" }}
        />
      ) : null}
      <button
        type="button"
        onClick={onClick}
        className={`grid w-full text-left transition-colors hover:bg-studio-canvas-alt ${padY} ${padR}`}
        style={{ gridTemplateColumns: ACTIVITY_GRID[size] }}
      >
        {/* Time gutter */}
        {compact ? (
          <span className="self-start pt-[1px] text-right font-mono text-[10px] font-medium tabular-nums text-studio-ink-faint">
            {event.ago}
          </span>
        ) : (
          <span className="flex flex-col items-end self-start pt-[1px]">
            <span className="font-mono text-[11px] font-medium tabular-nums text-studio-ink-muted">
              {event.ago}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-studio-ink-faint">
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
          {/* Category · kind eyebrow row */}
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-mono text-[10px] font-bold uppercase tracking-eyebrow"
              style={{ color: categoryColor(event.category) }}
            >
              {ACTIVITY_CATEGORY_LABEL[event.category]}
            </span>
            <span className="font-mono text-[10px] text-studio-ink-faint">
              ·
            </span>
            <span
              className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow"
              style={{
                color: event.emphasized
                  ? "var(--scout-accent)"
                  : "var(--studio-ink-faint)",
              }}
            >
              {ACTIVITY_KIND_LABEL[event.kind]}
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
          {/* Title */}
          <div
            className={
              compact
                ? "mt-[3px] font-sans text-[12px] font-semibold leading-snug text-studio-ink"
                : "mt-1 font-sans text-[13px] font-semibold leading-snug text-studio-ink"
            }
          >
            {event.title}
          </div>
          {/* Summary */}
          <div
            className={
              compact
                ? "mt-[2px] font-sans text-[11px] leading-snug text-studio-ink-muted"
                : "mt-[3px] font-sans text-[12px] leading-snug text-studio-ink-muted"
            }
          >
            {event.summary}
          </div>
          {/* Byline strip */}
          <div className="mt-1.5 flex items-baseline gap-1.5 font-mono text-[10px] text-studio-ink-faint">
            <ByLineAvatar name={event.agent} />
            <span className="font-sans text-[11px] text-studio-ink-muted">
              {event.agent}
            </span>
            <span className="text-studio-ink-faint">{event.handle}</span>
            {event.flightId ? (
              <>
                <span className="text-studio-ink-faint">·</span>
                <span className="tabular-nums text-studio-ink-faint">
                  flight {event.flightId}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </button>

      {engaged && showInlineDetail ? (
        <ActivityDetail event={event} size={size} />
      ) : null}
    </li>
  );
}

function ByLineAvatar({ name }: { name: string }) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex h-[13px] w-[13px] translate-y-[2px] items-center justify-center rounded-full border border-studio-edge bg-studio-canvas font-mono text-[10px] font-semibold text-studio-ink-muted"
    >
      {initial}
    </span>
  );
}

function ActivityDetail({
  event,
  size,
}: {
  event: ActivityEvent;
  size: HudSize;
}) {
  const compact = size === "compact";
  const padX = compact ? "px-4" : "px-4";

  return (
    <div
      className={`border-t border-studio-edge bg-studio-canvas-alt ${padX} py-2.5`}
    >
      <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · event detail
      </div>
      <div className="mt-1.5 font-sans text-[12px] font-semibold leading-tight text-studio-ink">
        {event.title}
      </div>
      {event.detail ? (
        <div className="mt-1 font-sans text-[11px] leading-snug text-studio-ink-muted">
          {event.detail}
        </div>
      ) : null}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px] font-mono text-[10px] leading-snug">
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
          category
        </dt>
        <dd
          className="font-bold uppercase tracking-eyebrow"
          style={{ color: categoryColor(event.category) }}
        >
          {ACTIVITY_CATEGORY_LABEL[event.category]}
        </dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
          kind
        </dt>
        <dd
          className="font-bold uppercase tracking-eyebrow"
          style={{
            color: event.emphasized
              ? "var(--scout-accent)"
              : "var(--studio-ink-muted)",
          }}
        >
          {ACTIVITY_KIND_LABEL[event.kind]}
        </dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
          source
        </dt>
        <dd className="text-studio-ink-muted">
          {event.agent} {event.handle}
        </dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">at</dt>
        <dd className="tabular-nums text-studio-ink-muted">
          {event.at} · {event.ago} ago
        </dd>
        {event.flightId ? (
          <>
            <dt className="uppercase tracking-eyebrow text-studio-ink-faint">
              flight
            </dt>
            <dd className="tabular-nums text-studio-ink-muted">
              {event.flightId}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

/** Right-pane detail at large — more breathing room, fuller treatment. */
function ActivityDetailLarge({ event }: { event: ActivityEvent }) {
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4">
      {/* Category eyebrow */}
      <div className="flex items-baseline gap-1.5">
        <span
          className="font-mono text-[10px] font-bold uppercase tracking-eyebrow"
          style={{ color: categoryColor(event.category) }}
        >
          · {ACTIVITY_CATEGORY_LABEL[event.category]}
        </span>
        <span className="font-mono text-[10px] text-studio-ink-faint">·</span>
        <span
          className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow"
          style={{
            color: event.emphasized
              ? "var(--scout-accent)"
              : "var(--studio-ink-faint)",
          }}
        >
          {ACTIVITY_KIND_LABEL[event.kind]}
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-studio-ink-faint">
          {event.at} · {event.ago} ago
        </span>
      </div>

      {/* Title */}
      <h3 className="font-sans text-[15px] font-semibold leading-tight tracking-tight text-studio-ink">
        {event.title}
      </h3>

      {/* Summary */}
      <p className="font-sans text-[13px] leading-snug text-studio-ink-muted">
        {event.summary}
      </p>

      {/* Detail (full body) */}
      {event.detail ? (
        <p className="font-sans text-[12px] leading-relaxed text-studio-ink">
          {event.detail}
        </p>
      ) : null}

      {/* Byline strip */}
      <div className="flex items-baseline gap-2 border-t border-studio-edge pt-2.5">
        <ByLineAvatar name={event.agent} />
        <span className="font-sans text-[12px] text-studio-ink">
          {event.agent}
        </span>
        <span className="font-mono text-[11px] text-studio-ink-faint">
          {event.handle}
        </span>
        {event.flightId ? (
          <span className="ml-auto rounded-[2px] border border-studio-edge bg-studio-canvas px-1.5 py-px font-mono text-[10px] tabular-nums text-studio-ink-muted">
            flight {event.flightId}
          </span>
        ) : null}
      </div>

      {/* Drill list */}
      <div className="mt-auto flex flex-col gap-[3px]">
        <DrillLink label="open thread" />
        <DrillLink label="follow execution" />
        <DrillLink label="agent profile" />
      </div>
    </div>
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
