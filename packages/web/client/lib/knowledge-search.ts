export type KnowledgeStatus = {
  generatedAt: number;
  paths: {
    knowledgeRoot: string;
    qmdRoot: string;
    sqlitePath: string;
  };
  collections: number;
  readyCollections: number;
  chunks: number;
  activeJobs: Array<{
    id: string;
    source: string;
    state: string;
    progress: {
      discovered?: number;
      extracted?: number;
      indexed?: number;
      failed?: number;
    };
    updatedAt: number;
    error?: string;
  }>;
  sqliteBytes: number;
};

export type PortablePath = {
  root: string;
  relPath: string;
};

export type KnowledgeSourceRef =
  | {
    kind: "harness_transcript";
    harness: string;
    path: PortablePath;
    sessionId?: string;
    recordRange?: [number, number];
  }
  | { kind: "file"; path: PortablePath; lineRange?: [number, number] }
  | { kind: "skill"; path: PortablePath; skillName?: string }
  | { kind: "context_pack"; path: PortablePath; packId?: string }
  | { kind: "scout_record"; recordKind: string; id: string }
  | { kind: "mcp_tool"; serverId: string; toolName: string; schemaPath?: string };

export type KnowledgeHit = {
  id: string;
  collectionId: string;
  documentId: string;
  chunkId: string;
  title: string;
  snippet: string;
  score: number;
  scoreSource: string;
  origin: string;
  ownership: string;
  freshness: string;
  sourceRefs: KnowledgeSourceRef[];
  facets: Record<string, string | string[]>;
};

export type SearchResponse = {
  q: string;
  hits: KnowledgeHit[];
  status: KnowledgeStatus;
};

export type IndexedSession = {
  collectionId: string;
  title: string;
  harness: string;
  project: string;
  transcriptPath: string;
  qmdPath: string;
  records: number;
  documents: number;
  chunks: number;
  bytes: number;
  mtimeMs: number;
  skipped?: boolean;
  error?: string;
};

export type IndexResponse = {
  result: {
    days: number;
    discovered: number;
    indexed: number;
    failed: number;
    sessions: IndexedSession[];
  };
  status: KnowledgeStatus;
};

export type KnowledgeSourcePreviewRecord = {
  index: number;
  raw: string;
  type?: string;
  role?: string;
  kind?: string;
  summary: string;
  renderedText: string;
  parsed: boolean;
  matched?: boolean;
  matchCount?: number;
  matchTerms?: string[];
};

export type KnowledgeSourcePreview = {
  path: string;
  sourcePath: PortablePath;
  harness: string;
  sessionId?: string;
  requestedRange?: [number, number];
  previewRange: [number, number];
  records: KnowledgeSourcePreviewRecord[];
  recordsRead: number;
  truncatedBefore: boolean;
  truncatedAfter: boolean;
  query?: string;
  queryTerms?: string[];
};

export type HighlightPart = {
  text: string;
  match: boolean;
};

export function pathLabel(path: PortablePath): string {
  if (path.root === "HOME") return `~/${path.relPath}`;
  if (path.root === "ABSOLUTE") return path.relPath;
  return `$${path.root}/${path.relPath}`;
}

export function firstTranscriptRef(hit: KnowledgeHit): Extract<KnowledgeSourceRef, { kind: "harness_transcript" }> | null {
  return hit.sourceRefs.find((ref): ref is Extract<KnowledgeSourceRef, { kind: "harness_transcript" }> =>
    ref.kind === "harness_transcript"
  ) ?? null;
}

export function facetText(hit: KnowledgeHit, key: string): string {
  const value = hit.facets[key];
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return typeof value === "string" ? value : "";
}

export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  return query
    .split(/[^A-Za-z0-9_./-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
    .filter((term) => {
      const key = term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightParts(text: string, query: string): HighlightPart[] {
  const terms = queryTerms(query);
  if (terms.length === 0 || text.length === 0) return [{ text, match: false }];
  const regex = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "giu");
  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ text: text.slice(cursor, index), match: false });
    }
    parts.push({ text: match[0], match: true });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), match: false });
  }
  return parts.length > 0 ? parts : [{ text, match: false }];
}
