import Link from "next/link";
import { marked } from "marked";
import { getPlansReadme, listPlans } from "@/lib/plans";

const STATUS_COPY: Record<string, string> = {
  draft: "Draft",
  "in-flight": "In-flight",
  shipped: "Shipped",
  shelved: "Shelved",
  concept: "Concept",
};

export default function PlansIndex() {
  const plans = listPlans();
  const readme = getPlansReadme();
  const readmeHtml = readme ? marked.parse(readme, { async: false }) : null;

  return (
    <main className="mx-auto max-w-page px-7 py-9 sm:px-9">
      <div className="mb-10 pb-2">
        <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          <span className="text-scout-accent" aria-hidden>
            ·
          </span>
          plans
        </div>
        <h1 className="mt-2 font-display text-6xl font-medium leading-none tracking-tight text-studio-ink">
          Plans Index
        </h1>
        <p className="mt-3.5 max-w-prose font-sans text-lg leading-relaxed text-studio-ink-faint">
          Every markdown file under{" "}
          <code className="font-mono text-sm text-studio-ink">plans/</code>,
          sorted by frontmatter <code className="font-mono text-sm text-studio-ink">order</code>{" "}
          then title.
        </p>
        <div className="studio-rule mt-6 max-w-prose" />
      </div>

      {plans.length === 0 ? (
        <p className="font-sans text-lg italic text-studio-ink-faint">
          No plans on disk yet. Add a markdown file to{" "}
          <code className="font-mono text-sm text-studio-ink">
            plans/
          </code>{" "}
          to see it appear here.
        </p>
      ) : (
        <ul className="grid gap-2.5">
          {plans.map((plan) => (
            <li key={plan.slug}>
              <Link
                href={`/plans/${plan.slug}`}
                className="studio-card focus-ring group block px-5 py-4"
              >
                <div className="relative flex items-baseline gap-3">
                  <div className="text-2xs font-semibold text-scout-accent" aria-hidden>
                    ·
                  </div>
                  <div className="font-display text-3xl font-medium tracking-tight text-studio-ink">
                    {plan.title}
                  </div>
                  <div className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
                    {STATUS_COPY[plan.status] ?? plan.status}
                  </div>
                  <div className="ml-auto font-mono text-2xs text-studio-ink-faint">
                    {plan.slug}.md
                  </div>
                </div>
                {plan.blurb ? (
                  <p className="relative ml-5 mt-1.5 font-sans text-lg leading-relaxed text-studio-ink-faint">
                    {plan.blurb}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {readmeHtml ? (
        <div className="mt-12 border-t border-studio-edge pt-8">
          <div className="mb-4 flex items-center gap-2 text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            <span className="text-scout-accent" aria-hidden>
              ·
            </span>
            plans/README.md
          </div>
          <div
            className="studio-prose max-w-[66ch]"
            dangerouslySetInnerHTML={{ __html: readmeHtml }}
          />
        </div>
      ) : null}
    </main>
  );
}
