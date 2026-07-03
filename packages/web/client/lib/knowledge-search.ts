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

export type WorktreeIndexResponse = {
  result: {
    repoRoot: string;
    branch: string;
    files: number;
    chunks: number;
    skipped: number;
    clean: boolean;
    collectionId: string;
    qmdPath: string;
    indexedFiles: Array<{
      path: string;
      state: "staged" | "unstaged" | "untracked";
      chunks: number;
      bytes: number;
      skipped?: boolean;
      reason?: string;
    }>;
  };
  status: KnowledgeStatus;
};

export type GuidedKnowledgeWindow = 2 | 3 | 7 | 21;
export type GuidedKnowledgeHarness = "all" | "claude" | "codex";

export type GuidedKnowledgeFilters = {
  harness: GuidedKnowledgeHarness;
  days: GuidedKnowledgeWindow;
};

export type GuidedKnowledgeSearch = {
  q: string;
  hits: KnowledgeHit[];
};

export type GuidedKnowledgeSessionSummary = {
  collectionId: string;
  title: string;
  project: string;
  harness: string;
  sessionId: string | null;
  hitCount: number;
  matchedQueries: string[];
  recordRanges: string[];
  topSnippet: string;
  confidence: "strong" | "possible" | "weak";
  judgment: string;
};

export const GUIDED_KNOWLEDGE_WINDOWS: Array<{
  days: GuidedKnowledgeWindow;
  label: string;
  limit: number;
}> = [
  { days: 2, label: "2d", limit: 200 },
  { days: 3, label: "3d", limit: 260 },
  { days: 7, label: "1w", limit: 520 },
  { days: 21, label: "3w", limit: 1000 },
];

export const GUIDED_KNOWLEDGE_HARNESSES: Array<{
  value: GuidedKnowledgeHarness;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
];

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

export function normalizeSessionRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[\\/]+$/, "");
  const leaf = normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? normalized;
  return leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
}

export function firstTranscriptRef(hit: KnowledgeHit): Extract<KnowledgeSourceRef, { kind: "harness_transcript" }> | null {
  return hit.sourceRefs.find((ref): ref is Extract<KnowledgeSourceRef, { kind: "harness_transcript" }> =>
    ref.kind === "harness_transcript"
  ) ?? null;
}

export function firstFileRef(hit: KnowledgeHit): Extract<KnowledgeSourceRef, { kind: "file" }> | null {
  return hit.sourceRefs.find((ref): ref is Extract<KnowledgeSourceRef, { kind: "file" }> =>
    ref.kind === "file"
  ) ?? null;
}

export function transcriptSessionId(
  ref: Extract<KnowledgeSourceRef, { kind: "harness_transcript" }> | null | undefined,
): string | null {
  if (!ref) return null;
  return normalizeSessionRef(ref.sessionId) ?? normalizeSessionRef(pathLabel(ref.path));
}

export function transcriptTailQuery(
  ref: Extract<KnowledgeSourceRef, { kind: "harness_transcript" }> | null | undefined,
): string | null {
  const sessionId = transcriptSessionId(ref);
  if (!sessionId) return null;
  const range = ref?.recordRange;
  if (!range) return sessionId;
  return `${sessionId}|records ${range[0]}..${range[1]}`;
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

function guidedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function pushUnique(values: string[], value: string) {
  const compact = guidedText(value);
  if (!compact) return;
  if (values.some((existing) => existing.toLowerCase() === compact.toLowerCase())) return;
  values.push(compact);
}

function guidedWindow(days: GuidedKnowledgeWindow) {
  return GUIDED_KNOWLEDGE_WINDOWS.find((window) => window.days === days) ?? GUIDED_KNOWLEDGE_WINDOWS[0]!;
}

export function guidedKnowledgeLimit(days: GuidedKnowledgeWindow): number {
  return guidedWindow(days).limit;
}

export function guidedKnowledgeUpdatedAfterMs(days: GuidedKnowledgeWindow, now = Date.now()): number {
  return now - days * 24 * 60 * 60 * 1000;
}

export function buildGuidedKnowledgeQueries(theme: string, objective: string): string[] {
  const queries: string[] = [];
  const cleanTheme = guidedText(theme);
  const cleanObjective = guidedText(objective);
  const objectiveTerms = queryTerms(cleanObjective).slice(0, 6);
  const allTerms = queryTerms(`${cleanTheme} ${cleanObjective}`)
    .filter((term) => !["about", "find", "into", "that", "this", "with"].includes(term.toLowerCase()));

  pushUnique(queries, cleanTheme);
  pushUnique(queries, objectiveTerms.join(" "));

  for (let index = 0; index < allTerms.length - 1 && queries.length < 9; index += 1) {
    pushUnique(queries, `${allTerms[index]} ${allTerms[index + 1]}`);
  }
  for (const term of allTerms) {
    if (queries.length >= 10) break;
    if (term.length >= 4 || term.includes("/") || term.includes("-")) {
      pushUnique(queries, term);
    }
  }

  return queries.slice(0, 10);
}

export function aggregateGuidedKnowledgeHits(
  searches: GuidedKnowledgeSearch[],
  limit = 30,
): KnowledgeHit[] {
  const scored = new Map<string, { hit: KnowledgeHit; score: number }>();
  searches.forEach((search, searchIndex) => {
    search.hits.forEach((hit, hitIndex) => {
      const key = hit.chunkId;
      const existing = scored.get(key) ?? { hit, score: 0 };
      existing.score += Math.max(1, 32 - hitIndex) + (searchIndex === 0 ? 8 : 0);
      scored.set(key, existing);
    });
  });
  return [...scored.values()]
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.hit)
    .slice(0, limit);
}

export function summarizeGuidedKnowledgeSessions(
  searches: GuidedKnowledgeSearch[],
  limit = 6,
): GuidedKnowledgeSessionSummary[] {
  const groups = new Map<string, {
    hit: KnowledgeHit;
    score: number;
    queries: Set<string>;
    ranges: Set<string>;
    hitCount: number;
  }>();

  searches.forEach((search) => {
    search.hits.forEach((hit, index) => {
      const transcript = firstTranscriptRef(hit);
      const key = hit.collectionId;
      const group = groups.get(key) ?? {
        hit,
        score: 0,
        queries: new Set<string>(),
        ranges: new Set<string>(),
        hitCount: 0,
      };
      group.score += Math.max(1, 24 - index);
      group.hitCount += 1;
      group.queries.add(search.q);
      if (transcript?.recordRange) group.ranges.add(transcript.recordRange.join(".."));
      groups.set(key, group);
    });
  });

  return [...groups.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((group) => {
      const transcript = firstTranscriptRef(group.hit);
      const queryCount = group.queries.size;
      const confidence = queryCount >= 3 || group.hitCount >= 8
        ? "strong"
        : queryCount >= 2 || group.hitCount >= 3
          ? "possible"
          : "weak";
      const judgment = confidence === "strong"
        ? `Strong candidate: matched ${queryCount} query angles across ${group.hitCount} chunks.`
        : confidence === "possible"
          ? `Possible match: enough overlap to inspect before discarding.`
          : `Weak match: one narrow overlap; treat as a near miss unless the preview confirms it.`;
      return {
        collectionId: group.hit.collectionId,
        title: group.hit.title,
        project: facetText(group.hit, "project"),
        harness: facetText(group.hit, "harness"),
        sessionId: transcriptSessionId(transcript),
        hitCount: group.hitCount,
        matchedQueries: [...group.queries].slice(0, 4),
        recordRanges: [...group.ranges].slice(0, 4),
        topSnippet: group.hit.snippet,
        confidence,
        judgment,
      };
    });
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
