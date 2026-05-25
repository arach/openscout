"use client";

/**
 * HudCapsule — top-center floating breadcrumb / status / blurb capsule.
 *
 * Replaces the full-width PageStrip with a single pill that floats
 * over content. The capsule is unmistakably "floating": glass back,
 * real drop shadow, hairline edge. Content rides on `[data-theme]`
 * tokens so the same component reads on either palette.
 *
 * Width auto, max ~720px. Content is breadcrumbs (mono eyebrow,
 * chevron-separated) · optional status pill · italic sans blurb.
 *
 * Pure presentational — accepts an explicit `crumbs` array; no
 * pathname coupling.
 */

import type { ReactElement } from "react";
import { StatusPill } from "@/components/StatusPill";
import type { StudioStatus } from "@/lib/studio-pages";

export function HudCapsule({
  crumbs,
  status,
  blurb,
}: {
  crumbs: string[];
  status?: StudioStatus;
  blurb?: string;
}): ReactElement {
  return (
    <div
      role="navigation"
      aria-label="Page breadcrumbs"
      className="absolute left-1/2 top-3 z-30 -translate-x-1/2"
      style={{ maxWidth: "calc(100% - 5rem)" }}
    >
      <div
        className="flex items-baseline gap-3 rounded-full border border-studio-edge px-4 py-1.5"
        style={{
          background:
            "color-mix(in oklab, var(--studio-canvas) 72%, transparent)",
          backdropFilter: "blur(14px) saturate(140%)",
          WebkitBackdropFilter: "blur(14px) saturate(140%)",
          boxShadow:
            "0 8px 32px -8px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.04) inset",
          maxWidth: "720px",
        }}
      >
        <Crumbs items={crumbs} />

        {status ? (
          <>
            <Divider />
            <StatusPill status={status} />
          </>
        ) : null}

        {blurb ? (
          <>
            <Divider />
            <span className="truncate font-sans text-[11.5px] italic text-studio-ink-faint">
              {blurb}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── Breadcrumbs ──────────────────────────────────────────────────────

function Crumbs({ items }: { items: string[] }) {
  return (
    <div className="flex items-baseline gap-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span
            key={`${item}-${i}`}
            className="flex items-baseline gap-1.5"
          >
            <span className={isLast ? "text-studio-ink" : undefined}>
              {item}
            </span>
            {isLast ? null : (
              <span aria-hidden className="text-studio-ink-faint">
                ›
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      className="h-3 w-px shrink-0 self-center bg-studio-edge"
    />
  );
}
