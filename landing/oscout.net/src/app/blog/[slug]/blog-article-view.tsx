"use client";

import Link from "next/link";
import { MarkdownContent } from "@arach/dewey";
import { SiteHeader } from "@/components/site-header";
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
      <SiteHeader active="blog" context={post.title} />

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
