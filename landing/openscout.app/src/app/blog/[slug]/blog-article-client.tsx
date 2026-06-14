"use client";

import dynamic from "next/dynamic";
import type { BlogPost } from "@/lib/blog";

const BlogArticleView = dynamic(
  () => import("./blog-article-view").then((m) => ({ default: m.BlogArticleView })),
  { ssr: false },
);

export function BlogArticleClient({ post, formattedDate }: { post: BlogPost; formattedDate: string }) {
  return <BlogArticleView post={post} formattedDate={formattedDate} />;
}
