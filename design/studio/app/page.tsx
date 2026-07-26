import Link from "next/link";
import { listPlans } from "@/lib/plans";
import { engDocsToStudioPages, listEngDocs } from "@/lib/eng-docs";
import {
  STUDIO_INSERTION_POINTS,
  STUDIO_PAGES,
  studiesForInsertionPoint,
} from "@/lib/studio-pages";
import { studyMtimes } from "@/lib/study-mtimes";
import {
  bench,
  heatOf,
  isRecent,
  msFromIso,
  shortAge,
  type BenchEntry,
} from "@/lib/heat";
import { Bench } from "@/components/Bench";
import { Ember, EmberLegend } from "@/components/Ember";

export default function Landing() {
  // One instant stamped across the whole render, so every age on the page is
  // measured from the same clock rather than drifting entry to entry.
  const now = Date.now();

  const plans = listPlans();
  const engDocs = listEngDocs();
  const engPages = engDocsToStudioPages(engDocs);
  const mtimes = studyMtimes();

  const scoCount = engDocs.filter((d) => d.scoId !== null).length;
  const studies = STUDIO_PAGES.filter(
    (p) => p.bucket === "studies" && p.href !== "/studies",
  );
  const atoms = STUDIO_PAGES.filter(
    (p) => p.bucket === "atoms" && p.href !== "/atoms",
  );
  const insertionPoints = STUDIO_INSERTION_POINTS;

  // The bench pools all three registers — a plan, an SCO doc, and a study are
  // the same kind of thing here: something you had open recently.
  const benchEntries: BenchEntry[] = bench([
    ...plans.map((p) => ({
      href: `/plans/${p.slug}`,
      label: p.title,
      kind: "plan",
      mtimeMs: msFromIso(p.updatedAt) ?? 0,
      blurb: p.blurb,
    })),
    ...engPages.map((p) => ({
      href: p.href,
      label: p.label,
      kind: "eng",
      mtimeMs: msFromIso(p.updatedAt) ?? 0,
      blurb: p.blurb,
    })),
    ...studies.map((s) => ({
      href: s.href,
      label: s.label,
      kind: "study",
      mtimeMs: mtimes[s.href] ?? 0,
      blurb: s.blurb,
    })),
  ]);

  // The single freshest thing in the studio is the only ember allowed to move.
  const freshestHref = benchEntries[0]?.href ?? null;

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <div className="mb-8 border-b border-studio-edge pb-5">
        <div className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · openscout · studio
        </div>
        <h1 className="mt-1 font-display text-6xl font-medium leading-none tracking-tight text-studio-ink">
          Overview
        </h1>
        <p className="mt-3 max-w-prose font-sans text-lg leading-relaxed text-studio-ink-faint">
          A planning + design surface that sits next to the codebase.
          Markdown plans render here; design studies live as routes; the
          atoms gallery shows shared web primitives in isolation.
        </p>
      </div>

      <Bench entries={benchEntries} now={now} />

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
                mtimeMs={msFromIso(plan.updatedAt)}
                now={now}
                sole={`/plans/${plan.slug}` === freshestHref}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Engineering" count={engDocs.length}>
        <Link
          href="/eng"
          className="focus-ring group block rounded-md border border-studio-edge px-5 py-4 transition-colors hover:border-studio-ink"
        >
          <div className="flex items-baseline gap-3">
            <Ember
              mtimeMs={freshestEngMtime(engPages)}
              now={now}
              className="self-center"
            />
            <div className="font-display text-3xl font-medium tracking-tight text-studio-ink">
              Engineering Index
            </div>
            <div className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
              {scoCount} SCO · {engDocs.length - scoCount} NOTES
            </div>
          </div>
          <p className="ml-5 mt-1.5 font-sans text-lg leading-relaxed text-studio-ink-faint">
            Numbered proposals and supporting notes from{" "}
            <code className="font-mono text-sm text-studio-ink">
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
                mtimeMs={mtimes[s.href]}
                now={now}
                sole={s.href === freshestHref}
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
                now={now}
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

      <div className="mt-12 border-t border-studio-edge pt-5">
        <EmberLegend />
        <p className="mt-4 max-w-prose font-sans text-sm leading-relaxed text-studio-ink-faint">
          Plans are markdown files in{" "}
          <code className="font-mono text-xs text-studio-ink">plans/</code>;
          edit one and refresh to see it here. Studies and atoms are Next
          routes — add a folder under{" "}
          <code className="font-mono text-xs text-studio-ink">app/</code>{" "}
          and register it in{" "}
          <code className="font-mono text-xs text-studio-ink">
            lib/studio-pages.ts
          </code>
          . Studio-mode host anchors are registered in the same file via{" "}
          <code className="font-mono text-xs text-studio-ink">
            STUDIO_INSERTION_POINTS
          </code>
          . Any page can be shown full-bleed with{" "}
          <code className="font-mono text-xs text-studio-ink">?focus=1</code>{" "}
          or the{" "}
          <kbd className="rounded-[2px] border border-studio-edge bg-studio-canvas-alt px-1 font-mono text-xs text-studio-ink">
            F
          </kbd>{" "}
          key.
        </p>
      </div>
    </main>
  );
}

/** Freshest mtime across the eng corpus — the index card reads for all of it. */
function freshestEngMtime(pages: Array<{ updatedAt?: string }>): number | undefined {
  let max = 0;
  for (const p of pages) max = Math.max(max, msFromIso(p.updatedAt) ?? 0);
  return max || undefined;
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
        <div className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · {title}
        </div>
        <div className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
          {count} {count === 1 ? "entry" : "entries"}
        </div>
        <div className="ml-3 h-px flex-1 bg-studio-edge" />
      </div>
      {count === 0 && empty ? (
        <p className="font-sans text-md italic text-studio-ink-faint">
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
  mtimeMs,
  now,
  sole = false,
}: {
  href: string;
  title: string;
  kind: string;
  blurb?: string;
  mtimeMs?: number;
  now: number;
  sole?: boolean;
}) {
  // Only entries still warm get a spelled-out age. Putting a timestamp on all
  // 250+ cards would bury the handful that are actually current.
  const heat = heatOf(mtimeMs, now);
  const age = isRecent(heat) ? shortAge(mtimeMs, now) : null;

  return (
    <Link
      href={href}
      className="focus-ring group block rounded-md border border-studio-edge px-5 py-4 transition-colors hover:border-studio-ink"
    >
      <div className="flex items-baseline gap-3">
        <Ember mtimeMs={mtimeMs} now={now} sole={sole} className="self-center" />
        <div className="font-display text-3xl font-medium tracking-tight text-studio-ink">
          {title}
        </div>
        <div className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
          {kind}
        </div>
        {age ? (
          <div
            className="ml-auto shrink-0 font-mono text-xs tabular-nums text-studio-ink-muted"
            title={`last edited ${age} ago`}
          >
            {age}
          </div>
        ) : null}
      </div>
      {blurb ? (
        <p className="ml-5 mt-1.5 font-sans text-lg leading-relaxed text-studio-ink-faint">
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
        <div className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          ·
        </div>
        <div className="font-display text-3xl font-medium tracking-tight text-studio-ink">
          {title}
        </div>
        <div className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
          {kind}
        </div>
      </div>
      <p className="ml-5 mt-1.5 font-mono text-sm text-studio-ink-faint">
        {id}
      </p>
      {blurb ? (
        <p className="ml-5 mt-1.5 font-sans text-lg leading-relaxed text-studio-ink-faint">
          {blurb}
        </p>
      ) : null}
      {studies.length > 0 ? (
        <div className="ml-5 mt-3 flex flex-wrap gap-2">
          {studies.map((study) => (
            <Link
              key={study.href}
              href={study.href}
              className="focus-ring rounded-sm border border-studio-edge px-2 py-1 font-mono text-xs uppercase tracking-ch text-studio-ink-faint transition-colors hover:border-studio-ink hover:text-studio-ink"
            >
              {study.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
