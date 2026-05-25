/**
 * Filesystem-backed plan registry.
 *
 * Plans live at `<repo>/plans/*.md`. Each file is its own page at
 * `/plans/<slug>` with frontmatter driving the page strip + sidebar
 * status dot:
 *
 * ```
 * ---
 * title: Inspector atom rollout
 * status: in-flight      # draft | in-flight | shipped | shelved
 * blurb: Two-PR plan to extract shared inspector atoms.
 * source:
 *   - docs/inspector-bar-audit.md
 * order: 10              # optional sidebar ordering (asc)
 * ---
 * ```
 *
 * Files starting with `_` or `.` are ignored. `README.md` is treated as
 * the bucket-level intro and exposed at `/plans` rather than as its own
 * entry.
 */

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { StudioPage, StudioStatus } from "./studio-pages";

export interface PlanFrontmatter {
  title?: string;
  status?: StudioStatus;
  blurb?: string;
  source?: string[];
  order?: number;
}

export interface Plan {
  slug: string;
  title: string;
  status: StudioStatus;
  blurb?: string;
  source?: string[];
  order: number;
  /** ISO mtime — used for "last touched" displays. */
  updatedAt: string;
  /** Raw markdown body (frontmatter stripped). */
  body: string;
  /** Absolute path on disk. */
  filePath: string;
}

const PLANS_DIR = path.resolve(process.cwd(), "..", "..", "plans");

function isMarkdown(name: string): boolean {
  if (name.startsWith("_") || name.startsWith(".")) return false;
  return name.endsWith(".md");
}

function slugFromFilename(name: string): string {
  return name.replace(/\.md$/, "");
}

function readPlan(filename: string): Plan | null {
  const filePath = path.join(PLANS_DIR, filename);
  let raw: string;
  let stat: fs.Stats;
  try {
    raw = fs.readFileSync(filePath, "utf8");
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const parsed = matter(raw);
  const fm = (parsed.data ?? {}) as PlanFrontmatter;
  const slug = slugFromFilename(filename);
  return {
    slug,
    title: fm.title ?? humanize(slug),
    status: fm.status ?? "draft",
    blurb: fm.blurb,
    source: fm.source,
    order: typeof fm.order === "number" ? fm.order : 1000,
    updatedAt: stat.mtime.toISOString(),
    body: parsed.content,
    filePath,
  };
}

function humanize(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Whether the plans/ directory exists on disk. */
export function plansDirExists(): boolean {
  try {
    return fs.statSync(PLANS_DIR).isDirectory();
  } catch {
    return false;
  }
}

/** All plans, sorted by `order` then title. README.md excluded. */
export function listPlans(): Plan[] {
  if (!plansDirExists()) return [];
  const files = fs.readdirSync(PLANS_DIR).filter(isMarkdown);
  const plans: Plan[] = [];
  for (const f of files) {
    if (f.toLowerCase() === "readme.md") continue;
    const p = readPlan(f);
    if (p) plans.push(p);
  }
  return plans.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });
}

/** Lookup a single plan by slug. */
export function getPlan(slug: string): Plan | null {
  if (!plansDirExists()) return null;
  return readPlan(`${slug}.md`);
}

/** The README.md body (bucket intro), if present. */
export function getPlansReadme(): string | null {
  if (!plansDirExists()) return null;
  const filePath = path.join(PLANS_DIR, "README.md");
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return matter(raw).content;
  } catch {
    return null;
  }
}

/** Convert plans → StudioPage entries the sidebar can render. */
export function plansToStudioPages(plans: Plan[]): StudioPage[] {
  return plans.map((p) => ({
    href: `/plans/${p.slug}`,
    label: p.title,
    bucket: "plans" as const,
    family: "plan",
    status: p.status,
    source: p.source,
    blurb: p.blurb,
  }));
}
