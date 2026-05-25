/**
 * Studio research primitives.
 *
 * Bottom-of-page research surface — the place where ongoing design
 * discussion, codebase references, and engineering docs accrete.
 * Replaces the repetitive floating "About" asides that previously sat
 * next to study panels.
 *
 * Three primitives:
 *
 *  - `<ResearchHeader />` — eyebrow + label pair that opens the
 *    section. Bordered top so the surface separates from the panel
 *    above without competing with it.
 *  - `<ResearchBlock eyebrow>` — single subsection. Mono eyebrow on
 *    the left at 140px gutter; content on the right.
 *  - `<SourceLinks paths>` — list of cursor:// URLs pointing at repo
 *    files. Underline-on-hover with accent decoration.
 */

import type { ReactNode } from "react";

export function ResearchHeader({
  surface,
}: {
  /** e.g. "hud · macos · interactive" or "hud · macos · compact" */
  surface: string;
}) {
  return (
    <div className="mb-10 flex items-baseline gap-3 border-t border-studio-edge pt-6">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · research
      </span>
      <span className="font-mono text-[10px] text-studio-ink-faint">
        / {surface}
      </span>
    </div>
  );
}

export function ResearchBlock({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-9 grid gap-3 lg:grid-cols-[140px_1fr] lg:gap-7">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {eyebrow}
      </div>
      <div className="text-studio-ink-muted">{children}</div>
    </div>
  );
}

export function SourceLinks({ paths }: { paths: string[] }) {
  return (
    <ul className="flex flex-col gap-1 font-mono text-[11px] leading-relaxed text-studio-ink-faint">
      {paths.map((p) => (
        <li key={p}>
          <a
            href={`cursor:///Users/arach/dev/openscout/${p}`}
            className="underline decoration-studio-edge underline-offset-2 transition-colors hover:text-studio-ink hover:decoration-scout-accent"
          >
            {p}
          </a>
        </li>
      ))}
    </ul>
  );
}
