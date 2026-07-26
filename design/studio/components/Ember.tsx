import { cn } from "@/lib/utils";
import { heatOf, longAge, type Heat } from "@/lib/heat";

/**
 * Ember — the studio's recency mark.
 *
 * Every card and section head in the studio already carried a `·` glyph that
 * did nothing but sit there. This replaces it with the same silhouette doing
 * real work: a dot whose intensity encodes how recently the underlying file
 * was touched.
 *
 *   live     today        filled accent + a soft halo
 *   warm     this week    filled accent, no halo
 *   cooling  this month   filled muted ink
 *   cold     older        a hollow ring — the resting state
 *
 * Cold is deliberately the quietest thing on screen and the most common. The
 * page should look calm and let the handful of lit marks carry the eye; if
 * everything glowed, nothing would.
 *
 * Only one ember on a page may `breathe` (see `sole`), and that animation is
 * gated on `prefers-reduced-motion` in globals.css. A wall of pulsing dots is
 * the failure mode this component exists to avoid.
 */

const TIER: Record<Heat, string> = {
  live: "ember--live",
  warm: "ember--warm",
  cooling: "ember--cooling",
  cold: "ember--cold",
};

export function Ember({
  mtimeMs,
  now,
  sole = false,
  className,
}: {
  mtimeMs?: number | null;
  now: number;
  /** Marks the single freshest entry on the page — the one authored moment. */
  sole?: boolean;
  className?: string;
}) {
  const heat = heatOf(mtimeMs, now);
  const breathes = sole && heat === "live";

  return (
    <span
      className={cn("ember", TIER[heat], breathes && "ember--breathe", className)}
      title={longAge(mtimeMs, now)}
      aria-hidden
    />
  );
}

/**
 * The legend, shown once at the foot of the landing page. Without it the
 * ember is a pretty dot; with it, it is a reading. Four swatches and four
 * words is the whole explanation.
 */
export function EmberLegend({ className }: { className?: string }) {
  const tiers: Array<{ heat: Heat; label: string }> = [
    { heat: "live", label: "today" },
    { heat: "warm", label: "this week" },
    { heat: "cooling", label: "this month" },
    { heat: "cold", label: "older" },
  ];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-muted",
        className,
      )}
    >
      <span>· last edited</span>
      {tiers.map(({ heat, label }) => (
        <span key={heat} className="flex items-center gap-1.5">
          <span className={cn("ember", TIER[heat])} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}
