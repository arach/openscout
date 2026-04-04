import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";

export type DocEntry = {
  slug: string;
  title: string;
  description: string;
  category: "core" | "implementation" | "tracks";
  content: string;
};

const DOCS_DIR = join(process.cwd(), "..", "docs");

const DOC_META: Record<string, { title: string; description: string; category: DocEntry["category"] }> = {
  "ARCHITECTURE": {
    title: "Architecture",
    description: "Core philosophy: local-first runtime substrate for agent tools.",
    category: "core",
  },
  "agent-identity": {
    title: "Agent Identity",
    description: "Address grammar for targeting agents across harnesses and machines.",
    category: "core",
  },
  "collaboration-workflows-v1": {
    title: "Collaboration Workflows",
    description: "Two canonical workflows — question and work_item — and their state machines.",
    category: "core",
  },
  "activity-indexing": {
    title: "Activity Indexing",
    description: "Fast broker-native activity projection backed by SQLite.",
    category: "implementation",
  },
  "codex-app-server-harness": {
    title: "Codex App Server Harness",
    description: "Persistent session plane for Codex via app-server JSON-RPC.",
    category: "implementation",
  },
  "telegram-bridge-ownership": {
    title: "Telegram Bridge Ownership",
    description: "Singleton polling fix using mesh-elected bridge owner.",
    category: "implementation",
  },
  "native-runtime": {
    title: "Native Runtime",
    description: "Historical context on the native shell scaffold that informed the current split.",
    category: "implementation",
  },
  "01-harness-catalog-and-onboarding": {
    title: "Track 01: Harness Catalog",
    description: "Declarative catalog with readiness, install, and configure states.",
    category: "tracks",
  },
  "02-collaboration-contract": {
    title: "Track 02: Collaboration Contract",
    description: "Stable broker-owned contract every harness must obey.",
    category: "tracks",
  },
  "03-shared-resources": {
    title: "Track 03: Shared Resources",
    description: "Broker-owned resources that agents and humans share safely.",
    category: "tracks",
  },
  "04-capability-aware-shell-and-surfaces": {
    title: "Track 04: Capability-Aware Surfaces",
    description: "Surfaces that explain what the system can do and what needs setup.",
    category: "tracks",
  },
};

function loadMarkdownFiles(dir: string, prefix = ""): DocEntry[] {
  const entries: DocEntry[] = [];
  for (const file of readdirSync(dir)) {
    const full = join(dir, file);
    if (file === "README.md") continue;
    if (file.endsWith(".md")) {
      const slug = prefix + basename(file, ".md");
      const meta = DOC_META[basename(file, ".md")];
      if (!meta) continue;
      entries.push({
        slug,
        ...meta,
        content: readFileSync(full, "utf-8"),
      });
    }
  }
  return entries;
}

export function getAllDocs(): DocEntry[] {
  const docs = [
    ...loadMarkdownFiles(DOCS_DIR),
    ...loadMarkdownFiles(join(DOCS_DIR, "openagents-tracks")),
  ];
  const order: DocEntry["category"][] = ["core", "tracks", "implementation"];
  return docs.sort((a, b) => {
    const ci = order.indexOf(a.category) - order.indexOf(b.category);
    if (ci !== 0) return ci;
    return a.slug.localeCompare(b.slug);
  });
}

export function getDocBySlug(slug: string): DocEntry | undefined {
  return getAllDocs().find((d) => d.slug === slug);
}
