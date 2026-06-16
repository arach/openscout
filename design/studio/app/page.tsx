import Link from "next/link";
import { listPlans } from "@/lib/plans";
import { listEngDocs } from "@/lib/eng-docs";
import {
  STUDIO_INSERTION_POINTS,
  STUDIO_PAGES,
  studiesForInsertionPoint,
} from "@/lib/studio-pages";

export default function Landing() {
  const plans = listPlans();
  const engDocs = listEngDocs();
  const scoCount = engDocs.filter((d) => d.scoId !== null).length;
  const studies = STUDIO_PAGES.filter(
    (p) => p.bucket === "studies" && p.href !== "/studies",
  );
  const atoms = STUDIO_PAGES.filter(
    (p) => p.bucket === "atoms" && p.href !== "/atoms",
  );
  const insertionPoints = STUDIO_INSERTION_POINTS;

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <div className="mb-8 border-b border-studio-edge pb-5">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · openscout · studio
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Overview
        </h1>
        <p className="mt-3 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          A planning + design surface that sits next to the codebase.
          Markdown plans render here; design studies live as routes; the
          atoms gallery shows shared web primitives in isolation.
        </p>
      </div>

      <Section
        title="Plans"
        count={plans.length}
        empty="No plans yet. Add a markdown file to plans/ at the repo root."
      >
        <ul className="grid gap-3">
          {plans.map((plan) => (
            <li key={plan.slug}>
              <Card
                href={`/plans/${plan.slug}`}
                title={plan.title}
                kind={plan.status.toUpperCase()}
                blurb={plan.blurb}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Engineering" count={engDocs.length}>
        <Link
          href="/eng"
          className="group block rounded-md border border-studio-edge px-5 py-4 transition-colors hover:border-studio-ink"
        >
          <div className="flex items-baseline gap-3">
            <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors group-hover:text-studio-ink">
              ·
            </div>
            <div className="font-display text-[19px] font-medium tracking-tight text-studio-ink">
              Engineering Index
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.20em] text-studio-ink-faint">
              {scoCount} SCO · {engDocs.length - scoCount} NOTES
            </div>
          </div>
          <p className="ml-5 mt-1.5 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            Numbered proposals and supporting notes from{" "}
            <code className="font-mono text-[11px] text-studio-ink">
              docs/eng/
            </code>
            , read live (never copied).
          </p>
        </Link>
      </Section>

      <Section title="Studies" count={studies.length}>
        <ul className="grid gap-3">
          {studies.map((s) => (
            <li key={s.href}>
              <Card
                href={s.href}
                title={s.label}
                kind={s.surface ? s.surface.toUpperCase() : "STUDY"}
                blurb={s.blurb}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Atoms" count={atoms.length}>
        <ul className="grid gap-3">
          {atoms.map((a) => (
            <li key={a.href}>
              <Card
                href={a.href}
                title={a.label}
                kind={a.status ? a.status.toUpperCase() : "ATOM"}
                blurb={a.blurb}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Insertion Points" count={insertionPoints.length}>
        <ul className="grid gap-3">
          {insertionPoints.map((point) => {
            const studies = studiesForInsertionPoint(point.id);

            return (
              <li key={point.id}>
                <InsertionPointCard
                  id={point.id}
                  title={point.label}
                  kind={`${point.scope.toUpperCase()} · ${point.surface?.toUpperCase() ?? "ANY"}`}
                  blurb={point.blurb}
                  studies={studies.map((study) => ({
                    href: study.href,
                    label: study.label,
                  }))}
                />
              </li>
            );
          })}
        </ul>
      </Section>

      <p className="mt-12 max-w-prose font-sans text-[11px] leading-relaxed text-studio-ink-faint">
        Plans are markdown files in{" "}
        <code className="font-mono text-[10px] text-studio-ink">plans/</code>;
        edit one and refresh to see it here. Studies and atoms are Next
        routes — add a folder under{" "}
        <code className="font-mono text-[10px] text-studio-ink">app/</code>{" "}
        and register it in{" "}
        <code className="font-mono text-[10px] text-studio-ink">
          lib/studio-pages.ts
        </code>
        . Studio-mode host anchors are registered in the same file via{" "}
        <code className="font-mono text-[10px] text-studio-ink">
          STUDIO_INSERTION_POINTS
        </code>
        .
      </p>
    </main>
  );
}

function Section({
  title,
  count,
  children,
  empty,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  empty?: string;
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
      {count === 0 && empty ? (
        <p className="font-sans text-[12px] italic text-studio-ink-faint">
          {empty}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

function Card({
  href,
  title,
  kind,
  blurb,
}: {
  href: string;
  title: string;
  kind: string;
  blurb?: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-md border border-studio-edge px-5 py-4 transition-colors hover:border-studio-ink"
    >
      <div className="flex items-baseline gap-3">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors group-hover:text-studio-ink">
          ·
        </div>
        <div className="font-display text-[19px] font-medium tracking-tight text-studio-ink">
          {title}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.20em] text-studio-ink-faint">
          {kind}
        </div>
      </div>
      {blurb ? (
        <p className="ml-5 mt-1.5 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          {blurb}
        </p>
      ) : null}
    </Link>
  );
}

function InsertionPointCard({
  id,
  title,
  kind,
  blurb,
  studies,
}: {
  id: string;
  title: string;
  kind: string;
  blurb?: string;
  studies: Array<{ href: string; label: string }>;
}) {
  return (
    <div className="rounded-md border border-studio-edge px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          ·
        </div>
        <div className="font-display text-[19px] font-medium tracking-tight text-studio-ink">
          {title}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.20em] text-studio-ink-faint">
          {kind}
        </div>
      </div>
      <p className="ml-5 mt-1.5 font-mono text-[11px] text-studio-ink-faint">
        {id}
      </p>
      {blurb ? (
        <p className="ml-5 mt-1.5 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          {blurb}
        </p>
      ) : null}
      {studies.length > 0 ? (
        <div className="ml-5 mt-3 flex flex-wrap gap-2">
          {studies.map((study) => (
            <Link
              key={study.href}
              href={study.href}
              className="rounded-sm border border-studio-edge px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-studio-ink-faint transition-colors hover:border-studio-ink hover:text-studio-ink"
            >
              {study.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
