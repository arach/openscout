import { readFileSync, readdirSync } from "fs";
import { join, basename, dirname, relative, resolve, sep } from "path";
import matter from "gray-matter";
import { githubRawBaseUrl, githubRepoUrl } from "./site-links";

export type DocMeta = {
  slug: string;
  title: string;
  description: string;
  group: string;
  order: number;
  sourcePath: string;
  sourceUrl: string;
  rawUrl: string;
};

export type DocEntry = DocMeta & {
  content: string;
};

const DOCS_DIR = join(process.cwd(), "../..", "docs");
const REPO_ROOT = join(DOCS_DIR, "..");
const GITHUB_BLOB_BASE_URL = `${githubRepoUrl}/blob/main`;
const GITHUB_RAW_BASE_URL = githubRawBaseUrl;

type GroupDef = { group: string; order: number; title: string; description: string };

const CATALOG: Record<string, GroupDef> = {
  "quickstart":                            { group: "Core Concepts",       order: 0,  title: "Quickstart",                  description: "The shortest path from install to a first healthy local Scout handoff." },
  "current-posture":                       { group: "Core Concepts",       order: 1,  title: "Status & Scope",              description: "Maturity, trust, install footprint, mesh, and license-status boundaries." },
  "architecture":                          { group: "Core Concepts",       order: 2,  title: "Architecture",                description: "The system shape and its data: what Scout owns vs observes, agent identity and addressing, and the integration boundary." },
  "agents-and-collaboration":              { group: "Core Concepts",       order: 3,  title: "Agents & Collaboration",      description: "How agents reach each other and move owned work: questions, work items, delegation, waking." },
  "concepts":                              { group: "Core Concepts",       order: 4,  title: "Concepts",                    description: "What every core noun means — the concepts Scout brings, and where it maps to open protocols." },
  "agent-integration-contract":            { group: "Core Concepts",       order: 5,  title: "Integrating Agents",          description: "The minimum v0 contract expected from agents, runtimes, and adapters." },
  "operator-attention-and-unblock":        { group: "Core Concepts",       order: 6,  title: "Operator Attention",          description: "Human input, approvals, permissions, and unblock notifications across surfaces." },
  "activity-indexing":                     { group: "Implementation",      order: 40, title: "Activity Indexing",           description: "Fast broker-native activity projection backed by SQLite." },
  "codex-app-server-harness":              { group: "Implementation",      order: 41, title: "Codex App Server Harness",    description: "Persistent session plane for Codex via app-server JSON-RPC." },
  "telegram-bridge-ownership":             { group: "Implementation",      order: 42, title: "Telegram Bridge Ownership",   description: "Singleton polling fix using mesh-elected bridge owner." },
  "native-runtime":                        { group: "Implementation",      order: 43, title: "Native Runtime",              description: "Historical context on the native shell scaffold." },
};

let docPathIndex: Map<string, string> | undefined;

function getDocPathIndex() {
  if (docPathIndex) return docPathIndex;

  const index = new Map<string, string>();
  const dirs = [DOCS_DIR];

  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md") || file === "README.md") continue;
      const slug = basename(file, ".md");
      if (!CATALOG[slug]) continue;
      index.set(resolve(join(dir, file)).toLowerCase(), slug);
    }
  }

  docPathIndex = index;
  return index;
}

function normalizeMarkdownTarget(target: string, sourcePath: string) {
  const cleanedTarget = target.trim().replace(/^<|>$/g, "");
  if (cleanedTarget.startsWith("http://") || cleanedTarget.startsWith("https://")) return null;
  if (!/\.md(?:#.*)?$/i.test(cleanedTarget)) return null;

  const hashIndex = cleanedTarget.indexOf("#");
  const rawPath = hashIndex === -1 ? cleanedTarget : cleanedTarget.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : cleanedTarget.slice(hashIndex);
  const resolvedPath = rawPath.startsWith("/")
    ? resolve(rawPath)
    : resolve(dirname(sourcePath), rawPath);

  const internalDocSlug = getDocPathIndex().get(resolvedPath.toLowerCase());
  if (internalDocSlug) return `/docs/${internalDocSlug}${hash}`;

  const repoRelativePath = relative(REPO_ROOT, resolvedPath);
  if (!repoRelativePath.startsWith("..")) {
    return `${GITHUB_BLOB_BASE_URL}/${repoRelativePath.split(sep).join("/")}${hash}`;
  }

  return null;
}

function normalizeMarkdownLinks(content: string, sourcePath: string) {
  return content.replace(/\[([^\]]+)\]\((<[^>]+>|[^)]+)\)/g, (match, label, target) => {
    const normalizedTarget = normalizeMarkdownTarget(target, sourcePath);
    if (!normalizedTarget) return match;
    return `[${label}](${normalizedTarget})`;
  });
}

function loadDoc(filePath: string, slug: string): DocEntry | null {
  const def = CATALOG[slug];
  if (!def) return null;
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const normalizedContent = normalizeMarkdownLinks(content, filePath);
  const repoRelativePath = relative(REPO_ROOT, resolve(filePath)).split(sep).join("/");
  return {
    slug,
    title: (data.title as string) || def.title,
    description: (data.description as string) || def.description,
    group: def.group,
    order: def.order,
    sourcePath: repoRelativePath,
    sourceUrl: `${GITHUB_BLOB_BASE_URL}/${repoRelativePath}`,
    rawUrl: `${GITHUB_RAW_BASE_URL}/${repoRelativePath}`,
    content: normalizedContent,
  };
}

export function getAllDocs(): DocEntry[] {
  const entries: DocEntry[] = [];
  const dirs = [DOCS_DIR];

  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md") || file === "README.md") continue;
      const slug = basename(file, ".md");
      const doc = loadDoc(join(dir, file), slug);
      if (doc) entries.push(doc);
    }
  }

  return entries.sort((a, b) => a.order - b.order);
}

export function getDocBySlug(slug: string): DocEntry | undefined {
  return getAllDocs().find((d) => d.slug === slug);
}

export type NavGroup = { title: string; items: { id: string; title: string; description?: string }[] };

export function getNavigation(): NavGroup[] {
  const docs = getAllDocs();
  const groups = new Map<string, NavGroup>();
  for (const doc of docs) {
    let group = groups.get(doc.group);
    if (!group) {
      group = { title: doc.group, items: [] };
      groups.set(doc.group, group);
    }
    group.items.push({ id: doc.slug, title: doc.title, description: doc.description });
  }
  return Array.from(groups.values());
}
