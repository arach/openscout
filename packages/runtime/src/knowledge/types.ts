export type KnowledgeCollectionKind =
  | "sessions"
  | "git_worktree"
  | "skills"
  | "mcp"
  | "codebase"
  | "context_pack"
  | "mixed";

export type KnowledgeCollectionStatus = "building" | "ready" | "failed";
export type KnowledgeDocumentOrigin = "mechanical" | "enrichment";
export type KnowledgeOwnership = "scout_owned" | "derived" | "observed_source";
export type KnowledgeFreshness = "fresh" | "stale" | "source_missing" | "unknown";
export type KnowledgeScoreSource = "fts" | "vector" | "hybrid";

export type KnowledgeFacets = Record<string, string | string[]>;

export interface KnowledgeSourceAnchor {
  sizeBytes?: number;
  mtimeMs?: number;
  contentHash?: string;
}

export interface KnowledgePortablePath {
  root:
    | "HOME"
    | "OPENSCOUT_CONTROL_HOME"
    | "OPENSCOUT_SUPPORT_DIRECTORY"
    | "PROJECT_ROOT"
    | "ABSOLUTE";
  relPath: string;
}

export type KnowledgeSourceRef =
  | {
    kind: "harness_transcript";
    harness: string;
    path: KnowledgePortablePath;
    sessionId?: string;
    recordRange?: [number, number];
    byteRange?: [number, number];
    anchor?: KnowledgeSourceAnchor;
  }
  | { kind: "scout_record"; recordKind: string; id: string }
  | {
    kind: "skill";
    path: KnowledgePortablePath;
    skillName?: string;
    anchor?: KnowledgeSourceAnchor;
  }
  | { kind: "mcp_tool"; serverId: string; toolName: string; schemaPath?: string }
  | {
    kind: "file";
    path: KnowledgePortablePath;
    lineRange?: [number, number];
    anchor?: KnowledgeSourceAnchor;
  }
  | {
    kind: "context_pack";
    path: KnowledgePortablePath;
    packId?: string;
    schemaVersion?: string;
    anchor?: KnowledgeSourceAnchor;
  };

export interface KnowledgeCollection {
  id: string;
  kind: KnowledgeCollectionKind;
  title: string;
  sourceRefs: KnowledgeSourceRef[];
  qmdPath: string;
  status: KnowledgeCollectionStatus;
  contentHash: string;
  extractorVersion: string;
  chunkPolicyVersion: string;
  createdAt: number;
  updatedAt: number;
  facets: KnowledgeFacets;
}

export interface KnowledgeDocument {
  id: string;
  collectionId: string;
  path: string;
  kind: string;
  origin: KnowledgeDocumentOrigin;
  contentHash: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeChunk {
  id: string;
  collectionId: string;
  documentId: string;
  documentPath: string;
  ordinal: number;
  text: string;
  textHash: string;
  origin: KnowledgeDocumentOrigin;
  ownership: KnowledgeOwnership;
  sourceRefs: KnowledgeSourceRef[];
  facets: KnowledgeFacets;
}

export interface KnowledgeSearchQuery {
  q: string;
  collections?: string[];
  sourceKinds?: KnowledgeCollectionKind[];
  facets?: KnowledgeFacets;
  limit?: number;
  mode?: "lexical" | "semantic" | "hybrid";
}

export type KnowledgeDrilldown =
  | { kind: "qmd"; collectionId: string; documentPath: string; chunkId?: string }
  | { kind: "harness_transcript"; sourceRef: Extract<KnowledgeSourceRef, { kind: "harness_transcript" }> }
  | { kind: "file"; sourceRef: Extract<KnowledgeSourceRef, { kind: "file" | "skill" | "context_pack" }> }
  | { kind: "scout_record"; sourceRef: Extract<KnowledgeSourceRef, { kind: "scout_record" }> }
  | { kind: "mcp_tool"; sourceRef: Extract<KnowledgeSourceRef, { kind: "mcp_tool" }> };

export interface KnowledgeSearchHit {
  id: string;
  collectionId: string;
  documentId: string;
  chunkId: string;
  title: string;
  snippet: string;
  score: number;
  scoreSource: KnowledgeScoreSource;
  origin: KnowledgeDocumentOrigin;
  ownership: KnowledgeOwnership;
  freshness: KnowledgeFreshness;
  sourceRefs: KnowledgeSourceRef[];
  drilldown: KnowledgeDrilldown[];
  facets: KnowledgeFacets;
}

export interface KnowledgeIndexRequest {
  source: Exclude<KnowledgeCollectionKind, "mixed">;
  days?: number;
  collections?: string[];
  force?: boolean;
  mode?: "foreground" | "background";
}

export type KnowledgeIndexJobState =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface KnowledgeIndexJob {
  id: string;
  source: KnowledgeIndexRequest["source"];
  state: KnowledgeIndexJobState;
  leaseOwner?: string;
  leaseGeneration: number;
  progress: {
    discovered?: number;
    extracted?: number;
    indexed?: number;
    failed?: number;
  };
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
}

export interface KnowledgeStatus {
  generatedAt: number;
  paths: {
    knowledgeRoot: string;
    qmdRoot: string;
    sqlitePath: string;
  };
  collections: number;
  readyCollections: number;
  chunks: number;
  activeJobs: KnowledgeIndexJob[];
  sqliteBytes: number;
}
