import Link from "next/link";
import { StatusPill, statusToLabel } from "@/components/StatusPill";
import { listEngDocs } from "@/lib/eng-docs";

export default function EngIndex() {
  const docs = listEngDocs();

  // Family grouping — collapse implementation-plan + review siblings
  // under the proposal so the index reads at family granularity.
  const seenFamily = new Set<string>();
  const primaries = docs.filter((d) => {
    if (seenFamily.has(d.family)) return false;
    seenFamily.add(d.family);
    return true;
  });
  const scoPrimaries = primaries.filter((d) => d.scoId !== null);
  const notes = primaries.filter((d) => d.scoId === null);

  const counts = {
    draft: docs.filter((d) => d.status === "draft").length,
    "in-flight": docs.filter((d) => d.status === "in-flight").length,
    shipped: docs.filter((d) => d.status === "shipped").length,
    concept: docs.filter((d) => d.status === "concept").length,
    shelved: docs.filter((d) => d.status === "shelved").length,
  };

  return (
    <main className="mx-auto max-w-page px-7 py-6 pb-16">
      <header className="mb-6 flex flex-wrap items-baseline gap-4 border-b border-studio-edge pb-4 pt-1.5">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            Engineering · SCO series
          </div>
          <h1 className="m-0 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
            Engineering Docs
          </h1>
        </div>
        <div className="ml-auto flex flex-wrap items-baseline gap-3 font-mono text-[10px] text-studio-ink-faint">
          <span>{docs.length} docs</span>
          <Sep />
          <span>{primaries.length} families</span>
          {counts.draft > 0 ? (
            <>
              <Sep />
              <span>{counts.draft} draft</span>
            </>
          ) : null}
          {counts["in-flight"] > 0 ? (
            <span>{counts["in-flight"]} in-flight</span>
          ) : null}
          {counts.shipped > 0 ? <span>{counts.shipped} shipped</span> : null}
          {counts.concept > 0 ? <span>{counts.concept} concept</span> : null}
          {counts.shelved > 0 ? <span>{counts.shelved} shelved</span> : null}
        </div>
      </header>

      <p className="mb-8 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
        Decision docs for the OpenScout codebase. Source of truth lives at{" "}
        <code className="font-mono text-[11px] text-studio-ink">docs/eng/</code>
        . Edits to the markdown files appear here on next request — no copy
        step. Sibling implementation plans and reviews collapse under their
        proposal.
      </p>

      <Section
        title="SCO proposals"
        count={scoPrimaries.length}
        emptyCopy="No SCO proposals yet."
      >
        <DocList docs={scoPrimaries} />
      </Section>

      {notes.length > 0 ? (
        <Section title="Notes" count={notes.length}>
          <DocList docs={notes} />
        </Section>
      ) : null}

    </main>
  );
}

function Section({
  title,
  count,
  emptyCopy,
  children,
}: {
  title: string;
  count: number;
  emptyCopy?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-3">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · {title}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.20em] text-studio-ink-faint">
          {count} {count === 1 ? "entry" : "entries"}
        </div>
        <div className="ml-3 h-px flex-1 bg-studio-edge" />
      </div>
      {count === 0 && emptyCopy ? (
        <p className="font-sans text-[12px] italic text-studio-ink-faint">
          {emptyCopy}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

/**
 * Single-line manifest row. Columns left → right:
 *   SCO-ID (mono, 80px) · Title (display, flex 2) · Synopsis (sans, flex 3
 *   — hidden < lg) · sibling chip · Status (mono, 80px right-aligned).
 * No second line. Hairline bottom rule, scout-accent on hover. Density
 * tight so a wide monitor shows ~30 rows above the fold.
 */
function DocList({
  docs,
}: {
  docs: ReturnType<typeof listEngDocs>;
}) {
  return (
    <div className="border-t border-studio-edge">
      {docs.map((d) => (
        <DocRow key={d.slug} doc={d} />
      ))}
    </div>
  );
}

function DocRow({
  doc,
}: {
  doc: ReturnType<typeof listEngDocs>[number];
}) {
  return (
    <Link
      href={`/eng/${doc.slug}`}
      className="focus-ring group flex items-baseline gap-4 border-b border-studio-edge px-3 py-1.5 transition-colors hover:bg-studio-canvas-alt"
    >
      <span className="w-[80px] shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-studio-ink-faint tabular-nums group-hover:text-scout-accent">
        {doc.scoId ? doc.scoId.toUpperCase() : "note"}
      </span>

      <span className="min-w-0 flex-[2] truncate font-sans text-[13.5px] font-medium tracking-tight text-studio-ink">
        {doc.title}
      </span>

      <span className="hidden min-w-0 flex-[3] truncate font-sans text-[12.5px] text-studio-ink-faint lg:block">
        {doc.blurb ?? ""}
      </span>

      <span className="hidden w-[44px] shrink-0 text-right font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint md:inline">
        {doc.siblings.length > 0 ? `+${doc.siblings.length}` : ""}
      </span>

      <span className="w-[78px] shrink-0 text-right">
        <StatusPill status={doc.status} variant="text" label={statusToLabel(doc.status)} />
      </span>
    </Link>
  );
}

function Sep() {
  return <span aria-hidden className="h-3 w-px shrink-0 bg-studio-edge" />;
}
