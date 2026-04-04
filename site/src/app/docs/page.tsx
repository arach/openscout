import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { getAllDocs, type DocEntry } from "@/lib/docs";

const CATEGORY_LABELS: Record<DocEntry["category"], string> = {
  core: "Core Concepts",
  tracks: "OpenAgents Tracks",
  implementation: "Implementation",
};

export default function DocsIndex() {
  const docs = getAllDocs();
  const categories = Object.keys(CATEGORY_LABELS) as DocEntry["category"][];

  return (
    <div className="min-h-screen bg-background font-sans">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <div className="flex items-center justify-between pb-4">
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:text-foreground transition-colors"
          >
            OpenScout
          </Link>
        </div>
        <div className="border-t border-border" />

        <div className="pt-16 pb-12">
          <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-[-0.02em]">
            Documentation
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-secondary max-w-md">
            Architecture, protocol specs, and implementation guides for the OpenScout platform.
          </p>
        </div>

        <div className="space-y-10">
          {categories.map((cat) => {
            const catDocs = docs.filter((d) => d.category === cat);
            if (catDocs.length === 0) return null;
            return (
              <section key={cat}>
                <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                  {CATEGORY_LABELS[cat]}
                </h2>
                <div className="grid gap-3">
                  {catDocs.map((doc) => (
                    <Link
                      key={doc.slug}
                      href={`/docs/${doc.slug}`}
                      className="group flex items-start justify-between rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent/40 hover:bg-surface-elevated"
                    >
                      <div>
                        <h3 className="font-mono text-sm font-medium text-foreground">
                          {doc.title}
                        </h3>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                          {doc.description}
                        </p>
                      </div>
                      <ArrowUpRight className="mt-0.5 ml-4 h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-accent" />
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
