import { notFound } from "next/navigation";
import { marked } from "marked";
import Link from "next/link";
import { getPlan, listPlans } from "@/lib/plans";

export function generateStaticParams() {
  return listPlans().map((plan) => ({ slug: plan.slug }));
}

export const dynamicParams = true;

export default async function PlanPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const plan = getPlan(slug);
  if (!plan) notFound();

  const html = marked.parse(plan.body, { async: false });
  const updated = new Date(plan.updatedAt);

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <div className="mb-6 flex items-baseline gap-3 font-mono text-[10px] text-studio-ink-faint">
        <Link
          href="/plans"
          className="uppercase tracking-eyebrow text-studio-ink-faint hover:text-studio-ink"
        >
          ← Plans
        </Link>
        <span className="text-studio-ink-faint">·</span>
        <span>
          touched{" "}
          {updated.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
        <span className="text-studio-ink-faint">·</span>
        <code className="font-mono text-[9.5px] text-studio-ink-faint">
          plans/{plan.slug}.md
        </code>
      </div>

      <article
        className="studio-prose max-w-prose"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {plan.source && plan.source.length > 0 ? (
        <div className="mt-12 max-w-prose border-t border-studio-edge pt-5">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            · related source
          </div>
          <ul className="space-y-1">
            {plan.source.map((src) => (
              <li
                key={src}
                className="font-mono text-[11px] text-studio-ink-faint"
              >
                <code className="rounded-[2px] bg-studio-canvas-alt px-1.5 py-0.5 text-studio-ink">
                  {src}
                </code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </main>
  );
}
