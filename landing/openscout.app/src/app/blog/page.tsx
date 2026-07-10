import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { formatBlogDate, getAllBlogPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog - Scout",
  description: "Notes on OpenScout product design, agent collaboration, and local-first operations.",
  openGraph: {
    title: "Blog - Scout",
    description: "Notes on OpenScout product design, agent collaboration, and local-first operations.",
    url: "https://openscout.app/blog",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export default function BlogIndex() {
  const posts = getAllBlogPosts();

  return (
    <div className="site-blog min-h-screen bg-[var(--site-page-bg)] text-[var(--site-ink)]">
      <SiteHeader active="blog" />

      <main className="mx-auto max-w-4xl px-6">
        <div className="border-b border-[var(--site-border-soft)] pb-10 pt-16">
          <div className="rfc-section-eyebrow">
            <span className="rfc-section-eyebrow__num">§</span>
            <span>OpenScout notes</span>
          </div>
          <h1 className="mt-4 font-[family-name:var(--font-spectral)] text-4xl font-semibold text-[var(--site-ink)] sm:text-5xl">
            Blog
          </h1>
          <p className="mt-4 max-w-2xl font-[family-name:var(--font-mono-display)] text-[13.5px] leading-relaxed text-[var(--site-copy)]">
            Product notes from the local agent broker: shell surfaces, live operations, and the collaboration patterns that shape them.
          </p>
        </div>

        <div className="grid gap-0 pb-24 pt-8">
          {posts.map((post, index) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="blog-index-post group border-b border-[var(--site-border-soft)] py-7"
            >
              <div className="rfc-section-eyebrow">
                <span className="rfc-section-eyebrow__num">§{index + 1}</span>
                <span>{formatBlogDate(post.date)}</span>
              </div>
              <h2 className="mt-3 font-[family-name:var(--font-spectral)] text-2xl font-semibold leading-tight text-[var(--site-ink)] transition-colors group-hover:text-[var(--site-accent)]">
                {post.title}
              </h2>
              <p className="mt-3 max-w-2xl font-[family-name:var(--font-mono-display)] text-[13px] leading-relaxed text-[var(--site-copy)]">
                {post.excerpt}
              </p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
