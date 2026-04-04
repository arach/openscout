import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getAllDocs, getDocBySlug } from "@/lib/docs";
import { MarkdownProse } from "@/components/markdown-prose";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return getAllDocs().map((doc) => ({ slug: doc.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const doc = getDocBySlug(params.slug);
  if (!doc) return {};
  return {
    title: `${doc.title} — OpenScout Docs`,
    description: doc.description,
  };
}

export default function DocPage({ params }: { params: { slug: string } }) {
  const doc = getDocBySlug(params.slug);
  if (!doc) notFound();

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

        <div className="pt-8 pb-2">
          <Link
            href="/docs"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Docs
          </Link>
        </div>

        <article className="pt-8 pb-20">
          <MarkdownProse content={doc.content} />
        </article>
      </div>
    </div>
  );
}
