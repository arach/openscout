import { getAllDocs, getDocBySlug, getNavigation } from "@/lib/docs";
import { DocView } from "./doc-view";
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

  const navigation = getNavigation();
  const allDocs = getAllDocs();
  const idx = allDocs.findIndex((d) => d.slug === params.slug);
  const prevPage = idx > 0 ? { id: allDocs[idx - 1].slug, title: allDocs[idx - 1].title } : undefined;
  const nextPage = idx < allDocs.length - 1 ? { id: allDocs[idx + 1].slug, title: allDocs[idx + 1].title } : undefined;

  return (
    <DocView
      title={doc.title}
      description={doc.description}
      content={doc.content}
      navigation={navigation}
      slug={doc.slug}
      prevPage={prevPage}
      nextPage={nextPage}
    />
  );
}
