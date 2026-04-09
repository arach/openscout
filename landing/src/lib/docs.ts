import { readFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";
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

type GroupDef = { group: string; order: number; title: string; description: string };

const CATALOG: Record<string, GroupDef> = {
  "architecture":                           { group: "Core Concepts",       order: 0,  title: "Architecture",                description: "Core philosophy: local-first runtime substrate for agent tools." },
  "agent-identity":                        { group: "Core Concepts",       order: 1,  title: "Agent Identity",              description: "Address grammar for targeting agents across harnesses and machines." },
  "collaboration-workflows-v1":            { group: "Core Concepts",       order: 2,  title: "Collaboration Workflows",     description: "Two canonical workflows — question and work_item — and their state machines." },
  "01-harness-catalog-and-onboarding":     { group: "OpenAgents Tracks",   order: 10, title: "Track 01: Harness Catalog",   description: "Declarative catalog with readiness, install, and configure states." },
  "02-collaboration-contract":             { group: "OpenAgents Tracks",   order: 11, title: "Track 02: Collaboration Contract", description: "Stable broker-owned contract every harness must obey." },
  "03-shared-resources":                   { group: "OpenAgents Tracks",   order: 12, title: "Track 03: Shared Resources",  description: "Broker-owned resources that agents and humans share safely." },
  "04-capability-aware-shell-and-surfaces":{ group: "OpenAgents Tracks",   order: 13, title: "Track 04: Capability-Aware Surfaces", description: "Surfaces that explain what the system can do." },
  "activity-indexing":                     { group: "Implementation",      order: 20, title: "Activity Indexing",           description: "Fast broker-native activity projection backed by SQLite." },
  "codex-app-server-harness":              { group: "Implementation",      order: 21, title: "Codex App Server Harness",    description: "Persistent session plane for Codex via app-server JSON-RPC." },
  "telegram-bridge-ownership":             { group: "Implementation",      order: 22, title: "Telegram Bridge Ownership",   description: "Singleton polling fix using mesh-elected bridge owner." },
  "native-runtime":                        { group: "Implementation",      order: 23, title: "Native Runtime",              description: "Historical context on the native shell scaffold." },
};

function loadDoc(filePath: string, slug: string): DocEntry | null {
  const def = CATALOG[slug];
  if (!def) return null;
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  return {
    slug,
    title: (data.title as string) || def.title,
    description: (data.description as string) || def.description,
    group: def.group,
    order: def.order,
    content,
  };
}

export function getAllDocs(): DocEntry[] {
  const entries: DocEntry[] = [];
  const dirs = [DOCS_DIR];
  const tracksDir = join(DOCS_DIR, "openagents-tracks");
  if (existsSync(tracksDir)) dirs.push(tracksDir);

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
