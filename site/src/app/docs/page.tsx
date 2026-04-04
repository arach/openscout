import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

const sections = [
  {
    title: "Relay",
    href: "/docs/relay",
    description: "Communication for project-scoped agents across your local machine and your other machines.",
    status: "stable",
  },
];

export default function DocsIndex() {
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
            Guides, references, and architecture docs for the OpenScout platform.
          </p>
        </div>

        <div className="grid gap-4">
          {sections.map((s) => (
            <Link
              key={s.title}
              href={s.href}
              className="group flex items-start justify-between rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent/40 hover:bg-surface-elevated"
            >
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-mono text-sm font-medium text-foreground">
                    {s.title}
                  </h2>
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
                    {s.status}
                  </span>
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-secondary">
                  {s.description}
                </p>
              </div>
              <ArrowUpRight className="mt-1 h-4 w-4 text-muted transition-colors group-hover:text-accent" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
