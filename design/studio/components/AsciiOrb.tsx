import { cn } from "@/lib/utils";

/**
 * AsciiOrb — a terminal-native identity ornament.
 *
 * Concentric rings of monospaced density characters form a soft orb.
 * Rings breathe on a staggered loop so the surface reads as a slow
 * shimmer rather than a spinner. Pure decoration; aria-hidden.
 *
 * Density ladder (core → rim): █ ▓ ▒ ░ ·
 * Stays token-colored so dark/light themes both keep the mark quiet.
 */

const ROWS = [
  "·······.·······",
  "·····.░▒░.·····",
  "···.░▒▓▓▓▒░.···",
  "··.░▒▓████▓▒░.··",
  "·.░▒▓██████▓▒░.·",
  "·░▒▓████████▓▒░·",
  "·.░▒▓██████▓▒░.·",
  "··.░▒▓████▓▒░.··",
  "···.░▒▓▓▓▒░.···",
  "·····.░▒░.·····",
  "·······.·······",
] as const;

function densRing(ch: string): number {
  switch (ch) {
    case "█":
      return 0;
    case "▓":
      return 1;
    case "▒":
      return 2;
    case "░":
      return 3;
    default:
      return 4;
  }
}

export function AsciiOrb({ className }: { className?: string }) {
  return (
    <pre aria-hidden className={cn("ascii-orb", className)}>
      {ROWS.map((row, y) => (
        <span key={y} className="ascii-orb__row">
          {[...row].map((raw, x) => {
            const ch = raw === "." ? "·" : raw;
            return (
              <span
                key={`${y}-${x}`}
                className={`ascii-orb__cell ascii-orb__cell--r${densRing(raw)}`}
              >
                {ch}
              </span>
            );
          })}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
