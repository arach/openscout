import type { ReactNode } from "react";
import { EyebrowLabel } from "@/components/EyebrowLabel";
import { cn } from "@/lib/utils";

/**
 * Study page header — eyebrow · title · lede.
 *
 * Lands on named type-ladder rungs (`--text-*` / Tailwind `text-*`):
 *   eyebrow → EyebrowLabel sm (2xs / 9px)
 *   title   → text-4xl (19px) display face
 *   lede    → text-lg  (13px) sans
 *
 * One step quieter than the old 28px study titles; scale changes move
 * this header with them rather than stranding pixel literals.
 */

export interface StudyHeaderProps {
  /** Kicker text. The `·` bullet comes from `EyebrowLabel`; don't include it. */
  eyebrow: ReactNode;
  title: ReactNode;
  /** Lede paragraph. Takes nodes — several ledes carry links and inline code. */
  children?: ReactNode;
  /** Escape hatch for the bottom margin, which varies (mb-6 / mb-8 / mb-10). */
  className?: string;
}

export function StudyHeader({
  eyebrow,
  title,
  children,
  className,
}: StudyHeaderProps) {
  return (
    <header className={cn("mb-9 max-w-prose", className)}>
      <EyebrowLabel size="sm">{eyebrow}</EyebrowLabel>
      <h1 className="mt-1.5 font-display text-4xl font-medium leading-none tracking-tight text-studio-ink">
        {title}
      </h1>
      {children ? (
        <p className="mt-3.5 font-sans text-lg leading-relaxed text-studio-ink-faint">
          {children}
        </p>
      ) : null}
    </header>
  );
}
