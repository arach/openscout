/**
 * Section header — eyebrow + headline strip that opens each tab and
 * each tail bucket. Shared across fleet, tail, sessions.
 */

import { PANEL_PAD_X } from "./tokens";
import type { HudSize } from "./types";

export function HudSectionHeader({
  eyebrow,
  headline,
  size,
}: {
  eyebrow: string;
  headline: string;
  size: HudSize;
}) {
  return (
    <div
      className={`border-b border-studio-edge bg-studio-canvas ${PANEL_PAD_X[size]} pt-3 pb-1.5`}
    >
      <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {eyebrow}
      </div>
      <div className="mt-0.5 font-sans text-[15px] font-semibold leading-tight text-studio-ink">
        {headline}
      </div>
    </div>
  );
}
