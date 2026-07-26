import Link from "next/link";
import { Ember } from "@/components/Ember";
import { shortAge, type BenchEntry } from "@/lib/heat";

/**
 * The Bench — what you last had out.
 *
 * The studio is visited across weeks, and the landing page below this is a
 * wall of 250+ entries with no sense of time in it. The first question on
 * return is not "what exists here" but "where was I" — so that gets answered
 * first, in one glance, from real file mtimes.
 *
 * Deliberately not cards. The page below is already a card wall; the bench is
 * flat dot-led rows on a hairline, which is the studio's instrument register
 * and reads as a different kind of thing rather than as more of the same. The
 * freshest entry leads at display size because that is almost always the one
 * you want; the rest stay tight.
 */
export function Bench({ entries, now }: { entries: BenchEntry[]; now: number }) {
  if (entries.length === 0) return null;

  const [lead, ...rest] = entries;

  return (
    <section className="mb-10" aria-labelledby="bench-heading">
      <div className="mb-3 flex items-baseline gap-3">
        <h2
          id="bench-heading"
          className="font-mono text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint"
        >
          · Where you left off
        </h2>
        <div className="ml-3 h-px flex-1 bg-studio-edge" />
      </div>

      <div className="border-t border-studio-edge">
        <Link
          href={lead.href}
          className="focus-ring group flex items-baseline gap-3 border-b border-studio-edge py-3.5"
        >
          <Ember mtimeMs={lead.mtimeMs} now={now} sole className="self-center" />
          <span className="font-display text-3xl font-medium leading-none tracking-tight text-studio-ink">
            {lead.label}
          </span>
          <span className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-muted">
            {lead.kind}
          </span>
          <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-studio-ink-muted">
            {shortAge(lead.mtimeMs, now)}
          </span>
        </Link>

        {lead.blurb ? (
          <p className="border-b border-studio-edge py-2.5 pl-[18px] font-sans text-lg leading-relaxed text-studio-ink-faint">
            {lead.blurb}
          </p>
        ) : null}

        <ul>
          {rest.map((entry) => (
            <li key={entry.href}>
              <Link
                href={entry.href}
                className="focus-ring group flex items-center gap-3 border-b border-studio-edge py-2 transition-colors hover:bg-studio-canvas-alt"
              >
                <Ember mtimeMs={entry.mtimeMs} now={now} />
                <span className="truncate font-sans text-lg text-studio-ink-muted transition-colors group-hover:text-studio-ink">
                  {entry.label}
                </span>
                <span className="shrink-0 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-muted">
                  {entry.kind}
                </span>
                <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-studio-ink-muted">
                  {shortAge(entry.mtimeMs, now)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
