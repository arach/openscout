import type { Metadata } from "next";
import Link from "next/link";
import { SiteThemeToggle } from "@/components/site-theme-toggle";
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
      <header className="operator-console">
        <div className="operator-row mx-auto flex max-w-4xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="flex shrink-0 items-center justify-center text-[var(--site-ink)]"
              style={{ width: 26, height: 26 }}
              aria-hidden
            >
              <svg viewBox="0 0 32 32" width={26} height={26} fill="none" stroke="currentColor">
                <line x1="16" y1="16" x2="16" y2="6" strokeWidth="1" opacity="0.45" />
                <line x1="16" y1="16" x2="6" y2="22" strokeWidth="1" opacity="0.45" />
                <line x1="16" y1="16" x2="26" y2="22" strokeWidth="1" opacity="0.45" />
                <circle cx="16" cy="6" r="2" fill="currentColor" stroke="none" />
                <circle cx="6" cy="22" r="2" fill="currentColor" stroke="none" />
                <circle cx="26" cy="22" r="2" fill="currentColor" stroke="none" />
                <circle cx="16" cy="16" r="3.4" fill="currentColor" stroke="none" />
                <circle cx="16" cy="16" r="3.4" fill="none" stroke="var(--site-page-bg)" strokeWidth="1.2" opacity="0.9" />
                <circle cx="16" cy="16" r="2" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="font-[family-name:var(--font-spectral)] text-lg font-semibold tracking-tight text-[var(--site-ink)]">
              Scout
            </span>
          </Link>
          <nav className="flex items-center gap-5">
            <Link href="/docs" className="operator-link hidden sm:inline-flex">
              <span className="operator-link__sigil">:</span>docs
            </Link>
            <span className="operator-link text-[var(--site-ink)]">
              <span className="operator-link__sigil">:</span>blog
            </span>
            <SiteThemeToggle />
          </nav>
        </div>
      </header>

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
