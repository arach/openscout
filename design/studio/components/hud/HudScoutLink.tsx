/**
 * Scout link — small trailing `↗` chip that links to the corresponding
 * entity in the web app at `https://scout.local/<kind>/<id>`.
 *
 * Universal row affordance. Sits at the right margin of every row in
 * every tab.
 *
 * Behavior:
 *   · Mono `↗` glyph. ink-faint default → ink-muted on hover.
 *   · Click stops propagation so it never toggles the row's engage.
 *   · `target="_blank"` + `rel="noreferrer"`.
 *   · `rowHoverGated` hides the chip until the row is hovered. Used
 *     at compact to save horizontal real estate; at medium/large the
 *     chip is always visible at ink-faint.
 */

"use client";

import type { MouseEvent } from "react";
import type { HudSize, ScoutLinkKind } from "./types";

export function HudScoutLink({
  kind,
  id,
  size,
  rowHoverGated = false,
}: {
  kind: ScoutLinkKind;
  id: string;
  size: HudSize;
  /** Hide unless the row is hovered. Compact opts in. */
  rowHoverGated?: boolean;
}) {
  // Gate by parent hover only at compact. Medium/large always show.
  const gate = rowHoverGated && size === "compact";

  const href = `https://scout.local/${kind}/${id}`;

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Don't propagate — the chip opens the link, doesn't toggle engage.
    e.stopPropagation();
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
      aria-label={`Open ${kind} ${id} in Scout`}
      className={[
        "inline-flex h-[14px] items-center justify-center px-[3px]",
        "font-mono text-[11px] leading-none text-studio-ink-faint",
        "transition-opacity hover:text-studio-ink-muted",
        gate ? "opacity-0 group-hover:opacity-100" : "opacity-100",
      ].join(" ")}
    >
      ↗
    </a>
  );
}
