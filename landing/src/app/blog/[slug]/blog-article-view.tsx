"use client";

import Link from "next/link";
import { MarkdownContent } from "@arach/dewey";
import { SiteThemeToggle } from "@/components/site-theme-toggle";
import type { BlogPost } from "@/lib/blog";

export function BlogArticleView({
  post,
  formattedDate,
}: {
  post: BlogPost;
  formattedDate: string;
}) {
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
            <Link href="/blog" className="operator-link hidden sm:inline-flex">
              <span className="operator-link__sigil">:</span>blog
            </Link>
            <Link href="/docs" className="operator-link hidden sm:inline-flex">
              <span className="operator-link__sigil">:</span>docs
            </Link>
            <SiteThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-16">
        <Link href="/blog" className="operator-link">
          <span className="operator-link__sigil">:</span>all-posts
        </Link>

        <article className="pt-10">
          <div className="rfc-section-eyebrow">
            <span className="rfc-section-eyebrow__num">§</span>
            <span>{formattedDate}</span>
            <span>{post.author}</span>
          </div>
          <h1 className="mt-5 font-[family-name:var(--font-spectral)] text-4xl font-semibold leading-[1.08] text-[var(--site-ink)] sm:text-5xl">
            {post.title}
          </h1>
          <p className="mt-5 max-w-2xl font-[family-name:var(--font-mono-display)] text-[14px] leading-relaxed text-[var(--site-copy)]">
            {post.subtitle}
          </p>

          <div className="blog-article-markdown docs-markdown mt-12">
            <MarkdownContent content={post.content} />
          </div>
        </article>
      </main>
    </div>
  );
}
