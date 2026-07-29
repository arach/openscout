/**
 * Eyebrow label atom — the `· LABEL` markup used as page kicker /
 * section title / breadcrumb segment across the studio. Centralises
 * font / tracking / weight / bullet so a single tweak ripples
 * everywhere.
 *
 * Three sizes on the studio type ladder (`--text-*`):
 *   xs  → 3xs (8px)  sidebar surface sub-labels
 *   sm  → 2xs (9px)  default — page kickers, section titles, study eyebrows
 *   md  → xs  (10px) page-strip breadcrumb segments
 *
 * Tones:
 *   default → studio-ink-faint
 *   muted   → studio-ink-faint
 *   ink     → studio-ink (when used as the final/active segment)
 */

import type { ReactNode } from "react";

export type EyebrowSize = "xs" | "sm" | "md";
export type EyebrowTone = "default" | "muted" | "ink";

const SIZE_CLASS: Record<EyebrowSize, string> = {
  xs: "text-3xs tracking-eyebrow",
  sm: "text-2xs tracking-eyebrow",
  md: "text-xs tracking-eyebrow",
};

const TONE_CLASS: Record<EyebrowTone, string> = {
  default: "text-studio-ink-faint",
  muted: "text-studio-ink-faint",
  ink: "text-studio-ink",
};

export interface EyebrowLabelProps {
  children: ReactNode;
  /** Adds a leading `·` bullet. Default true. */
  bullet?: boolean;
  size?: EyebrowSize;
  tone?: EyebrowTone;
  /** Semantic element. Defaults to a `<div>` since most usage is
   *  page-kicker text, not a heading. Pass "h2" / "h3" when the
   *  eyebrow serves as the section title. */
  as?: "div" | "span" | "h2" | "h3";
  className?: string;
}

export function EyebrowLabel({
  children,
  bullet = true,
  size = "sm",
  tone = "default",
  as = "div",
  className,
}: EyebrowLabelProps) {
  const Tag = as;
  return (
    <Tag
      className={[
        "font-mono font-semibold uppercase",
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {bullet ? (
        <span className="text-scout-accent" aria-hidden>
          ·{" "}
        </span>
      ) : null}
      {children}
    </Tag>
  );
}
