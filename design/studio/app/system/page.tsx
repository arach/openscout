import Link from "next/link";
import { StudyHeader } from "@/components/StudyHeader";
import { auditManifest, allComponents, registryHealth } from "@/lib/design-system/registry";
import type { ComponentStatus } from "@/lib/design-system/manifest";

/**
 * The design system index.
 *
 * The studio's job has always been to design a surface before it is built. This
 * page is the other half: which of those designs are finished enough that the
 * main project can adopt them, what their contract is, and whether the copy
 * already in production still matches.
 *
 * Everything here is projected from the registry. There is no hand-written list
 * of components on this page, deliberately — an index that can disagree with
 * the thing it indexes is worse than no index.
 */

export const metadata = {
  title: "Design System · OpenScout Studio",
};

const STATUS_COPY: Record<ComponentStatus, string> = {
  draft: "A sketch. Expect it to move under you.",
  candidate: "Complete and interactive, contract still settling.",
  graduated: "Contract is stable and documented. Safe to adopt.",
};

const STATUS_ORDER: ComponentStatus[] = ["graduated", "candidate", "draft"];

export default function DesignSystemPage() {
  const components = allComponents();
  const health = new Map(registryHealth().map((entry) => [entry.id, entry]));

  return (
    <main className="mx-auto max-w-page px-7 py-9 sm:px-9">
      <StudyHeader eyebrow="· design system" title="Design System">
        Components that have graduated out of being a study. Each one carries a
        manifest describing its contract, its states, its keyboard, where its
        data comes from, and whether the copy already in <code>packages/web</code>{" "}
        still agrees with it — enough that an agent can adopt it without opening
        the source.
      </StudyHeader>

      {/* ── The standard ───────────────────────────────────────────────── */}
      <section className="mb-11 grid gap-6 md:grid-cols-3">
        {STATUS_ORDER.map((status) => {
          const count = components.filter((manifest) => manifest.status === status).length;
          return (
            <div key={status} className="border-t border-studio-edge pt-3">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-4xl font-medium tabular-nums text-studio-ink">
                  {count}
                </span>
                <span className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                  {status}
                </span>
              </div>
              <p className="mt-1.5 text-md leading-relaxed text-studio-ink-muted">
                {STATUS_COPY[status]}
              </p>
            </div>
          );
        })}
      </section>

      {/* ── Registry ───────────────────────────────────────────────────── */}
      <section className="mb-11">
        <SectionHead
          title="Registry"
          hint="Entering the registry is a claim that a component is adoptable, so it is a decision somebody makes rather than a glob over the folder."
        />

        <ul className="mt-4 grid gap-2.5">
          {components.map((manifest) => {
            const entry = health.get(manifest.id);
            const issues = auditManifest(manifest);
            return (
              <li key={manifest.id}>
                <div className="studio-card px-5 py-4">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <Link
                      href={manifest.atom ?? "#"}
                      className="focus-ring font-display text-3xl font-medium tracking-tight text-studio-ink hover:text-scout-accent"
                    >
                      {manifest.name}
                    </Link>
                    <span className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
                      {manifest.status}
                    </span>
                    {entry && !entry.honest ? (
                      <span className="rounded-full bg-status-error-bg px-2 py-0.5 text-2xs font-semibold uppercase tracking-caps text-status-error-fg">
                        fails its own bar
                      </span>
                    ) : null}
                    {manifest.port ? (
                      <span className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
                        port · {manifest.port.status}
                        {manifest.port.drift?.length
                          ? ` (${manifest.port.drift.length})`
                          : ""}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1.5 max-w-prose font-sans text-lg leading-relaxed text-studio-ink-faint">
                    {manifest.summary}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-sm text-studio-ink-faint">
                    <span className="text-studio-ink-muted">
                      {`import { ${manifest.import.symbols[0]} } from "${manifest.import.from}"`}
                    </span>
                    <span>bun run ds show {manifest.id}</span>
                    {issues.length ? (
                      <span>
                        {issues.filter((i) => i.level === "error").length} errors ·{" "}
                        {issues.filter((i) => i.level === "warning").length} warnings
                      </span>
                    ) : (
                      <span>clean</span>
                    )}
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {manifest.keywords.slice(0, 10).map((keyword) => (
                      <span
                        key={keyword}
                        className="rounded-full border border-studio-edge px-2 py-0.5 text-2xs text-studio-ink-faint"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── How an agent uses this ────────────────────────────────────── */}
      <section className="mb-11">
        <SectionHead
          title="Querying it as an agent"
          hint="The CLI is the primary path because it needs no server. The endpoint is for when the studio is already running."
        />
        <div className="mt-3.5 grid gap-2 font-mono text-md">
          {[
            ["bun run ds find model picker", "ranked search across every manifest"],
            ["bun run ds show runtime-picker", "the full contract — props, states, keyboard, port"],
            ["bun run ds list --status graduated", "what is safe to adopt right now"],
            ["bun run ds audit", "non-zero exit when a component fails the bar it claims"],
            ["GET /api/design-system?q=model+picker", "same search, as JSON, over HTTP"],
          ].map(([command, note]) => (
            <div
              key={command}
              className="flex flex-wrap items-baseline gap-x-4 border-b border-studio-edge py-1.5"
            >
              <code className="text-studio-ink">{command}</code>
              <span className="font-sans text-md text-studio-ink-faint">{note}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Graduating something ──────────────────────────────────────── */}
      <section className="mb-11">
        <SectionHead
          title="Graduating a component"
          hint="Status is earned, not declared — the audit refuses a graduated claim it cannot back up."
        />
        <ol className="mt-3.5 flex max-w-prose list-none flex-col gap-2.5">
          {[
            <>
              Get the data out of the component. Anything hard-coded inside it is
              a fork waiting to happen; a catalog passed in is a component.
            </>,
            <>
              Handle the states a real surface will hit — loading, error, empty,
              disabled, and content longer than the design assumed.
            </>,
            <>
              Write <code className="font-mono text-sm text-studio-ink">Name.manifest.ts</code>{" "}
              beside it, using{" "}
              <code className="font-mono text-sm text-studio-ink">RuntimePicker.manifest.ts</code>{" "}
              as the specimen.
            </>,
            <>
              Add it to{" "}
              <code className="font-mono text-sm text-studio-ink">
                lib/design-system/registry.ts
              </code>{" "}
              and run{" "}
              <code className="font-mono text-sm text-studio-ink">bun run ds audit</code>.
            </>,
            <>
              Record the port honestly. If production already has a copy that has
              drifted, name every divergence — a port field that says{" "}
              <code className="font-mono text-sm text-studio-ink">synced</code> when
              it is not is the one failure that makes the whole registry useless.
            </>,
          ].map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="mt-0.5 w-4 shrink-0 font-mono text-sm tabular-nums text-scout-accent">
                {index + 1}
              </span>
              <span className="font-sans text-lg leading-relaxed text-studio-ink-muted">
                {step}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <>
      <h2 className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {title}
      </h2>
      {hint ? (
        <p className="mt-1 max-w-prose font-sans text-lg leading-relaxed text-studio-ink-faint">
          {hint}
        </p>
      ) : null}
    </>
  );
}
