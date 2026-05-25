/**
 * Size toggle — `compact (420) / medium (680) / large (900)`. Mono,
 * ink-faint inactive, lime active. Used only by the interactive
 * playground; the locked study pages omit it.
 */

"use client";

import { PANEL_DIMS } from "./tokens";
import type { HudSize } from "./types";

const ITEMS: ReadonlyArray<{ key: HudSize; label: string }> = [
  { key: "compact", label: "compact" },
  { key: "medium", label: "medium" },
  { key: "large", label: "large" },
];

export function HudSizeToggle({
  size,
  onChange,
}: {
  size: HudSize;
  onChange: (s: HudSize) => void;
}) {
  return (
    <div className="flex items-baseline gap-3 font-mono text-[10px] font-bold uppercase tracking-eyebrow">
      <span className="text-studio-ink-faint">· size</span>
      {ITEMS.map((it, i) => {
        const active = it.key === size;
        return (
          <span key={it.key} className="flex items-baseline gap-3">
            {i > 0 ? (
              <span aria-hidden className="text-studio-ink-faint">
                /
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onChange(it.key)}
              className="group inline-flex items-baseline gap-1 transition-colors"
              style={{
                color: active
                  ? "var(--scout-accent)"
                  : "var(--studio-ink-faint)",
              }}
            >
              <span className="group-hover:text-studio-ink">{it.label}</span>
              <span
                className="font-mono text-[9px] font-medium tabular-nums"
                style={{
                  color: active
                    ? "var(--scout-accent)"
                    : "var(--studio-ink-faint)",
                  opacity: active ? 0.85 : 0.55,
                }}
              >
                ({PANEL_DIMS[it.key].w})
              </span>
            </button>
          </span>
        );
      })}
    </div>
  );
}
