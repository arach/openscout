import Link from "next/link";
import { notFound } from "next/navigation";
import { EngDocHeader } from "@/components/EngDocHeader";
import { EngMarkdown } from "@/components/EngMarkdown";
import { getEngDoc, listEngDocs } from "@/lib/eng-docs";
import "../eng-doc.css";

export function generateStaticParams() {
  return listEngDocs().map((d) => ({ slug: d.slug }));
}

export const dynamicParams = true;

export default async function EngDocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = getEngDoc(slug);
  if (!doc) notFound();

  return (
    <main className="mx-auto max-w-[820px] px-7 pt-4 pb-20">
      <nav className="mb-2 font-mono text-[10px] text-studio-ink-faint">
        <Link
          href="/eng"
          className="hover:text-studio-ink transition-colors"
        >
          ← Engineering docs
        </Link>
      </nav>

      <EngDocHeader doc={doc} />

      <div className="mt-8">
        <EngMarkdown body={doc.body} fromSlug={doc.slug} />
      </div>
    </main>
  );
}
