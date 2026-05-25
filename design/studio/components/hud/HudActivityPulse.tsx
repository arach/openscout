/**
 * 8-step pulse strip — thin vertical bars. Geometry scales with size
 * via `PULSE_CFG`. Active bars are scout-accent; zero values render as
 * a 1px ink-faint dash so an idle agent reads as a flat line, not a
 * void. Offline agents drop opacity to ~45%.
 */

import { PULSE_CFG } from "./tokens";
import type { HudSize } from "./types";

export function HudActivityPulse({
  values,
  size,
  dim,
}: {
  values: number[];
  size: HudSize;
  dim?: boolean;
}) {
  const cfg = PULSE_CFG[size];

  return (
    <span
      aria-label="recent activity"
      className="inline-flex items-end"
      style={{ gap: cfg.gap, height: cfg.maxH }}
    >
      {values.map((v, i) => {
        const isFlat = v <= 0;
        const h = isFlat ? 1 : Math.max(2, Math.round((v / 8) * cfg.maxH));
        return (
          <span
            key={i}
            className="inline-block"
            style={{
              width: cfg.bar,
              height: h,
              background: isFlat
                ? "var(--studio-ink-faint)"
                : "var(--scout-accent)",
              opacity: dim ? 0.45 : isFlat ? 0.6 : 1,
            }}
          />
        );
      })}
    </span>
  );
}
