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
    <main className="mx-auto max-w-page px-7 py-8">
      <div className="mb-8 border-b border-studio-edge pb-5">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · plans
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Plans Index
        </h1>
        <p className="mt-3 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Every markdown file under{" "}
          <code className="font-mono text-[11px] text-studio-ink">plans/</code>,
          sorted by frontmatter <code className="font-mono text-[11px] text-studio-ink">order</code>{" "}
          then title.
        </p>
      </div>

      {plans.length === 0 ? (
        <p className="font-sans text-[13px] italic text-studio-ink-faint">
          No plans on disk yet. Add a markdown file to{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            plans/
          </code>{" "}
          to see it appear here.
        </p>
      ) : (
        <ul className="grid gap-3">
          {plans.map((plan) => (
            <li key={plan.slug}>
              <Link
                href={`/plans/${plan.slug}`}
                className="group block rounded-md border border-studio-edge px-5 py-4 transition-colors hover:border-studio-ink"
              >
                <div className="flex items-baseline gap-3">
                  <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors group-hover:text-studio-ink">
                    ·
                  </div>
                  <div className="font-display text-[19px] font-medium tracking-tight text-studio-ink">
                    {plan.title}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.20em] text-studio-ink-faint">
                    {STATUS_COPY[plan.status] ?? plan.status}
                  </div>
                  <div className="ml-auto font-mono text-[9.5px] text-studio-ink-faint">
                    {plan.slug}.md
                  </div>
                </div>
                {plan.blurb ? (
                  <p className="ml-5 mt-1.5 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
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
          <div className="mb-4 text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · plans/README.md
          </div>
          <div
            className="studio-prose max-w-prose"
            dangerouslySetInnerHTML={{ __html: readmeHtml }}
          />
        </div>
      ) : null}
    </main>
  );
}
