import type { ReactNode } from "react";
import { EyebrowLabel } from "@/components/EyebrowLabel";
import { cn } from "@/lib/utils";

/**
 * Study page header — eyebrow · title · lede.
 *
 * Sixteen routes hand-rolled this block inline, and they drifted: four
 * different h1 sizes (28 / 30 / 22 / 20px), all as arbitrary `text-[Npx]`
 * values, half of them bypassing `EyebrowLabel` for a raw div with the
 * classes copied out.
 *
 * The 28px default was the visible symptom. A study page's content sits
 * between 9 and 13px, so the title jumped 2.15x off the next-largest text
 * with nothing in between — it read as a spike rather than a heading. The
 * ladder from `tailwind.config.ts` has five rungs in that gap. This lands
 * on `text-4xl` (20px), 1.54x the 13px lede, which still carries as a
 * masthead in the display face at `leading-none` without shouting.
 *
 * Sizes are named rungs, not pixels, so the next scale change moves this
 * with it instead of leaving it behind — which is exactly how these
 * headers got stranded the first time.
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
    <header className={cn("mb-8 max-w-prose", className)}>
      <EyebrowLabel size="sm">{eyebrow}</EyebrowLabel>
      <h1 className="mt-1 font-display text-4xl font-medium leading-none tracking-tight text-studio-ink">
        {title}
      </h1>
      {children ? (
        <p className="mt-3 font-sans text-lg leading-relaxed text-studio-ink-faint">
          {children}
        </p>
      ) : null}
    </header>
  );
}
