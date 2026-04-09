"use client";

import { DocsLayout, MarkdownContent } from "@arach/dewey";
import type { NavGroup } from "@/lib/docs";

// Import Dewey CSS
import "@arach/dewey/css";
import "@arach/dewey/css/colors/ocean.css";

export function DocView({
  title,
  description,
  content,
  navigation,
  slug,
  prevPage,
  nextPage,
}: {
  title: string;
  description: string;
  content: string;
  navigation: NavGroup[];
  slug: string;
  prevPage?: { id: string; title: string };
  nextPage?: { id: string; title: string };
}) {
  return (
    <DocsLayout
      title={title}
      description={description}
      navigation={navigation}
      projectName="OpenScout"
      basePath="/docs"
      homeUrl="/"
      markdown={content}
      prevPage={prevPage}
      nextPage={nextPage}
    >
      <MarkdownContent content={content} isDark />
    </DocsLayout>
  );
}
