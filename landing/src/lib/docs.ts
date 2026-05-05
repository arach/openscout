import { readFileSync, readdirSync, existsSync } from "fs";
import { join, basename, dirname, relative, resolve, sep } from "path";
import matter from "gray-matter";

export type DocMeta = {
  slug: string;
  title: string;
  description: string;
  group: string;
  order: number;
};

export type DocEntry = DocMeta & {
  content: string;
};

const DOCS_DIR = join(process.cwd(), "..", "docs");
const TRACKS_DIR = join(DOCS_DIR, "openagents-tracks");
const REPO_ROOT = join(DOCS_DIR, "..");
const GITHUB_BLOB_BASE_URL = "https://github.com/arach/openscout/blob/main";

type GroupDef = { group: string; order: number; title: string; description: string };

const CATALOG: Record<string, GroupDef> = {
  "quickstart":                            { group: "Core Concepts",       order: 0,  title: "Quickstart",                  description: "The shortest path from install to a first healthy local Scout handoff." },
  "current-posture":                       { group: "Core Concepts",       order: 1,  title: "Status & Scope",              description: "Maturity, trust, install footprint, mesh, and license-status boundaries." },
  "architecture":                          { group: "Core Concepts",       order: 2,  title: "Architecture",                description: "Local-first protocol and runtime for orchestrating agents across harnesses and machines." },
  "data-ownership":                        { group: "Core Concepts",       order: 3,  title: "Data Ownership",              description: "What Scout owns, observes, and intentionally does not import." },
  "agent-identity":                        { group: "Core Concepts",       order: 4,  title: "Agent Identity",              description: "How agents are named, addressed, and resolved across machines and harnesses." },
  "agent-integration-contract":            { group: "Core Concepts",       order: 5,  title: "Integrating Agents",          description: "The minimum v0 contract expected from agents, runtimes, and adapters." },
  "collaboration-workflows-v1":            { group: "Core Concepts",       order: 6,  title: "Collaboration Workflows",     description: "Questions and work items — two kinds of collaboration with distinct lifecycles." },
  "operator-attention-and-unblock":        { group: "Core Concepts",       order: 7,  title: "Operator Attention",          description: "Human input, approvals, permissions, and unblock notifications across surfaces." },
  "01-harness-catalog-and-onboarding":     { group: "OpenAgents Tracks",   order: 20, title: "Track 01: Harness Catalog",   description: "Declarative catalog with readiness, install, and configure states." },
  "02-collaboration-contract":             { group: "OpenAgents Tracks",   order: 21, title: "Track 02: Collaboration Contract", description: "Stable broker-owned contract every harness must obey." },
  "03-shared-resources":                   { group: "OpenAgents Tracks",   order: 22, title: "Track 03: Shared Resources",  description: "Broker-owned resources that agents and humans share safely." },
  "04-capability-aware-shell-and-surfaces":{ group: "OpenAgents Tracks",   order: 23, title: "Track 04: Capability-Aware Surfaces", description: "Surfaces that explain what the system can do." },
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
  if (existsSync(TRACKS_DIR)) dirs.push(TRACKS_DIR);

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
  return {
    slug,
    title: (data.title as string) || def.title,
    description: (data.description as string) || def.description,
    group: def.group,
    order: def.order,
    content: normalizedContent,
  };
}

export function getAllDocs(): DocEntry[] {
  const entries: DocEntry[] = [];
  const dirs = [DOCS_DIR];
  if (existsSync(TRACKS_DIR)) dirs.push(TRACKS_DIR);

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
