import { existsSync, readFileSync, readdirSync } from "fs";
import { basename, join } from "path";
import matter from "gray-matter";

export type BlogMeta = {
  slug: string;
  title: string;
  subtitle: string;
  date: string;
  author: string;
  excerpt: string;
};

export type BlogPost = BlogMeta & {
  content: string;
};

const BLOG_DIR = join(process.cwd(), "content", "blog");

function asString(value: unknown, fallback = "") {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" ? value : fallback;
}

function loadPost(fileName: string): BlogPost | null {
  const filePath = join(BLOG_DIR, fileName);
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const slug = basename(fileName, ".md");
  const title = asString(data.title, slug);

  return {
    slug,
    title,
    subtitle: asString(data.subtitle),
    date: asString(data.date),
    author: asString(data.author, "OpenScout"),
    excerpt: asString(data.excerpt, asString(data.subtitle, title)),
    content,
  };
}

export function getAllBlogPosts(): BlogPost[] {
  if (!existsSync(BLOG_DIR)) return [];

  return readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith(".md"))
    .map(loadPost)
    .filter((post): post is BlogPost => Boolean(post))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getBlogPostBySlug(slug: string): BlogPost | undefined {
  return getAllBlogPosts().find((post) => post.slug === slug);
}

export function formatBlogDate(date: string) {
  if (!date) return "";

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;

  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}
