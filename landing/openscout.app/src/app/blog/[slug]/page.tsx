import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogArticleView } from "./blog-article-view";
import { formatBlogDate, getAllBlogPosts, getBlogPostBySlug } from "@/lib/blog";

export function generateStaticParams() {
  return getAllBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);
  if (!post) return {};

  return {
    title: `${post.title} - Scout Blog`,
    description: post.excerpt,
    openGraph: {
      title: `${post.title} - Scout Blog`,
      description: post.excerpt,
      url: `https://openscout.app/blog/${post.slug}`,
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      images: ["/og.png"],
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);
  if (!post) notFound();

  return <BlogArticleView post={post} formattedDate={formatBlogDate(post.date)} />;
}
