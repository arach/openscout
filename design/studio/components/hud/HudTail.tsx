/**
 * Tail tab content — firehose pattern.
 *
 * Visual signature (distinct from activity):
 *   · No section header. The whole panel is the stream.
 *   · Dense mono rows, one event per line. No buckets, no time stacking,
 *     no spine, no byline avatar, no titled "category".
 *   · Monospaced single-line row: HH:MM:SS · KND · @source · <line>.
 *   · 10/11px mono — tighter than activity's 11/12/13 sans.
 *   · Row gap is 0; rows pack with a 1px border. ssh-tail-into-a-server.
 *
 * Layout:
 *   compact/medium → single column stream. Click reveals inline-below.
 *   large          → two pane: stream left, raw-detail right (sticky).
 *
 * Universal row affordances:
 *   · Engage     — click row → reveal raw + ±1 neighbors (compact/medium)
 *                  or swap detail (large). Esc closes.
 *   · Scout link — trailing ↗ chip linking to scout.local/firehose/<id>.
 */

"use client";

import { HudScoutLink } from "./HudScoutLink";
import { FIREHOSE } from "./mock";
import { PANEL_PAD_X, TAIL_ROW_FONT_PX } from "./tokens";
import type { FirehoseEvent, HudSize } from "./types";
import { useHudEngage } from "./useHudEngage";

const STREAM_COL_W_LARGE = 540;

export function HudTail({ size }: { size: HudSize }) {
  const engage = useHudEngage();

  if (size === "large") {
    const selectedId =
      (engage.engaged && FIREHOSE.find((e) => e.id === engage.engaged)?.id) ??
      FIREHOSE[0]?.id ??
      null;
    const selectedIdx = FIREHOSE.findIndex((e) => e.id === selectedId);
    const selected = FIREHOSE[selectedIdx];
    const prev = FIREHOSE[selectedIdx - 1];
    const next = FIREHOSE[selectedIdx + 1];

    return (
      <section className="flex h-full flex-col">
        <TailMeter count={FIREHOSE.length} size={size} />
        <div className="flex min-h-0 flex-1">
          <ul
            className="flex shrink-0 flex-col overflow-y-auto"
            style={{ width: STREAM_COL_W_LARGE }}
          >
            {FIREHOSE.map((event) => (
              <TailRow
                key={event.id}
                event={event}
                size="large"
                engaged={selectedId === event.id}
                onClick={() => engage.select(event.id)}
                showInlineDetail={false}
              />
            ))}
          </ul>
          <div
            aria-hidden
            className="shrink-0 self-stretch border-l border-studio-edge"
            style={{ width: 1 }}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-5 py-3">
            {selected ? (
              <TailDetailLarge event={selected} prev={prev} next={next} />
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <TailMeter count={FIREHOSE.length} size={size} />
      <ul className="flex flex-col">
        {FIREHOSE.map((event, idx) => (
          <TailRow
            key={event.id}
            event={event}
            size={size}
            engaged={engage.isEngaged(event.id)}
            onClick={() => engage.toggle(event.id)}
            prev={FIREHOSE[idx - 1]}
            next={FIREHOSE[idx + 1]}
            showInlineDetail
          />
        ))}
      </ul>
    </section>
  );
}

/** Thin "live N evt" meter strip in place of a section header — keeps
 *  the tail surface from looking like activity. Single line, mono. */
function TailMeter({ count, size }: { count: number; size: HudSize }) {
  return (
    <div
      className={`flex items-baseline justify-between border-b border-studio-edge ${PANEL_PAD_X[size]} py-[5px]`}
    >
      <span className="inline-flex items-baseline gap-2">
        <span
          aria-hidden
          className="inline-block h-[5px] w-[5px] translate-y-[-1px] rounded-full"
          style={{ background: "var(--scout-accent)" }}
        />
        <span className="font-mono text-[10px] font-bold uppercase tracking-eyebrow text-studio-ink">
          live
        </span>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
          · firehose
        </span>
      </span>
      <span className="font-mono text-[10px] tabular-nums text-studio-ink-muted">
        {count} evt
      </span>
    </div>
  );
}

function TailRow({
  event,
  prev,
  next,
  size,
  engaged,
  onClick,
  showInlineDetail,
}: {
  event: FirehoseEvent;
  prev?: FirehoseEvent;
  next?: FirehoseEvent;
  size: HudSize;
  engaged: boolean;
  onClick: () => void;
  showInlineDetail: boolean;
}) {
  const compact = size === "compact";
  const padX =
    compact ? "pl-3 pr-3" : size === "medium" ? "pl-4 pr-4" : "pl-4 pr-4";
  const fontPx = TAIL_ROW_FONT_PX[size];

  const inkBody = event.emphasized
    ? "var(--studio-ink)"
    : "var(--studio-ink-muted)";
  const kindColor = event.emphasized
    ? "var(--scout-accent)"
    : "var(--studio-ink-faint)";

  return (
    <li
      className={`border-b border-studio-edge ${
        engaged ? "bg-studio-canvas-alt" : ""
      }`}
    >
      {engaged ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-[1.5px]"
          style={{ background: "var(--scout-accent)" }}
        />
      ) : null}
      <button
        type="button"
        onClick={onClick}
        className={`group flex w-full items-baseline gap-[6px] text-left transition-colors hover:bg-studio-canvas-alt ${padX} py-[2px]`}
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
        <span className="ml-1 shrink-0">
          <HudScoutLink
            kind="firehose"
            id={event.id}
            size={size}
            rowHoverGated
          />
        </span>
      </button>

      {engaged && showInlineDetail ? (
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
  const padX = compact ? "px-3" : "px-4";

  const line = (e: FirehoseEvent | undefined, label: string) =>
    e ? (
      <div className="truncate font-mono text-[10px] leading-snug text-studio-ink-faint">
        <span className="mr-1.5 uppercase tracking-eyebrow">{label}</span>
        {e.at} {e.kind} @{e.source} · {e.line}
      </div>
    ) : null;

  return (
    <div
      className={`border-t border-studio-edge bg-studio-canvas-alt ${padX} py-2`}
    >
      <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · raw
      </div>
      <div className="mt-1 break-all font-mono text-[11px] leading-snug text-studio-ink">
        [{event.at}] [{event.kind}] @{event.source} · {event.line}
      </div>
      <div className="mt-2 flex flex-col gap-[2px]">
        {line(prev, "PRV")}
        {line(next, "NXT")}
      </div>
    </div>
  );
}

function TailDetailLarge({
  event,
  prev,
  next,
}: {
  event: FirehoseEvent;
  prev: FirehoseEvent | undefined;
  next: FirehoseEvent | undefined;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · raw line
      </div>
      <div className="break-all font-mono text-[12px] leading-relaxed text-studio-ink">
        [{event.at}] [{event.kind}] @{event.source} · {event.line}
      </div>

      <div className="border-t border-studio-edge pt-2.5">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · window
        </div>
        <div className="mt-1 flex flex-col gap-[2px]">
          {prev ? (
            <div className="truncate font-mono text-[11px] leading-snug text-studio-ink-faint">
              <span className="mr-1.5 uppercase tracking-eyebrow">PRV</span>
              {prev.at} {prev.kind} @{prev.source} · {prev.line}
            </div>
          ) : null}
          <div className="truncate font-mono text-[11px] leading-snug text-studio-ink">
            <span className="mr-1.5 uppercase tracking-eyebrow text-scout-accent" style={{ color: "var(--scout-accent)" }}>
              CUR
            </span>
            {event.at} {event.kind} @{event.source} · {event.line}
          </div>
          {next ? (
            <div className="truncate font-mono text-[11px] leading-snug text-studio-ink-faint">
              <span className="mr-1.5 uppercase tracking-eyebrow">NXT</span>
              {next.at} {next.kind} @{next.source} · {next.line}
            </div>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px] font-mono text-[10px] leading-snug">
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">kind</dt>
        <dd className="font-bold uppercase tracking-eyebrow text-studio-ink-muted">
          {event.kind}
        </dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">source</dt>
        <dd className="text-studio-ink-muted">@{event.source}</dd>
        <dt className="uppercase tracking-eyebrow text-studio-ink-faint">at</dt>
        <dd className="tabular-nums text-studio-ink-muted">{event.at}</dd>
      </dl>
    </div>
  );
}
