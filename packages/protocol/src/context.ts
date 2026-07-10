import type { MetadataMap, ScoutId } from "./common.js";

export const CONTEXT_BLOCK_KINDS = [
  "instruction",
  "memory",
  "reference",
  "skill",
] as const;

export type ContextBlockKind = (typeof CONTEXT_BLOCK_KINDS)[number];

export const MEMORY_KINDS = [
  "fact",
  "decision",
  "constraint",
  "preference",
  "procedure",
  "artifact",
  "open_loop",
  "working_state",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type ContextScopeKind =
  | "global"
  | "workspace"
  | "agent"
  | "conversation"
  | "work_item"
  | "session";

export type ContextScope =
  | { kind: "global" }
  | {
      kind: Exclude<ContextScopeKind, "global">;
      id: ScoutId;
    };

export type ContextProjectionMode = "inline" | "summary" | "loadable" | "searchable";
export type ContextMutability = "readonly" | "broker_writable" | "append_only";
export type ContextBlockState = "proposed" | "active" | "superseded" | "archived";

/**
 * A provenance pointer, not copied source content. Harness transcripts remain
 * observed material; context blocks cite them without becoming Scout messages.
 */
export interface ContextSourceRef {
  kind:
    | "operator"
    | "message"
    | "session_observation"
    | "resource"
    | "artifact"
    | "invocation"
    | "flight"
    | "work_item"
    | "context_block";
  ref: string;
  label?: string;
  digest?: string;
  observedAt?: number;
  metadata?: MetadataMap;
}

export interface ContextFreshness {
  verifiedAt?: number;
  expiresAt?: number;
  policy?: "manual" | "session" | "ttl" | "source_revision";
}

/** Durable prompt-facing context owned by the Scout broker. */
export interface ContextBlock {
  schemaVersion: "openscout.context-block.v1";
  id: ScoutId;
  kind: ContextBlockKind;
  memoryKind?: MemoryKind;
  title: string;
  body: string;
  summary?: string;
  scope: ContextScope;
  projectionMode: ContextProjectionMode;
  mutability: ContextMutability;
  state: ContextBlockState;
  createdById: ScoutId;
  ownerId?: ScoutId;
  sourceRefs: ContextSourceRef[];
  confidence?: number;
  tokenBudget?: number;
  freshness?: ContextFreshness;
  version: number;
  supersedesId?: ScoutId;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
  metadata?: MetadataMap;
}

/** Reviewable output of a distiller. It is not durable until the broker records it. */
export interface MemoryCandidate {
  id: ScoutId;
  memoryKind: MemoryKind;
  title: string;
  body: string;
  summary?: string;
  scope: ContextScope;
  sourceRefs: ContextSourceRef[];
  confidence?: number;
  freshness?: ContextFreshness;
  metadata?: MetadataMap;
}

export type ContextPackSectionKind =
  | "source"
  | "task_frame"
  | "memory"
  | "recent_evidence"
  | "workspace_state"
  | "next_move"
  | "limitations";

export interface ContextPackSection {
  id: string;
  kind: ContextPackSectionKind;
  title: string;
  body: string;
  estimatedTokens: number;
  contextBlockIds?: ScoutId[];
  sourceRefs?: ContextSourceRef[];
  metadata?: MetadataMap;
}

export interface ContextPackTarget {
  projectPath?: string;
  agentId?: ScoutId;
  conversationId?: ScoutId;
  workItemId?: ScoutId;
  sessionId?: ScoutId;
  harness?: string;
  model?: string;
  sessionPolicy?: "new" | "fork";
}

/**
 * A bounded, inspectable payload used to seed work. It is constructive context,
 * not a hidden clone of a provider transcript.
 */
export interface ContextPack {
  schemaVersion: "openscout.context-pack.v1";
  id: ScoutId;
  title: string;
  purpose: string;
  target: ContextPackTarget;
  sections: ContextPackSection[];
  contextBlockIds: ScoutId[];
  sourceRefs: ContextSourceRef[];
  budget: {
    maxTokens: number;
    estimatedTokens: number;
    truncated: boolean;
  };
  limitations: string[];
  contentHash: string;
  createdById: ScoutId;
  createdAt: number;
  metadata?: MetadataMap;
}

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validateScope(scope: ContextScope): string[] {
  if (!scope || typeof scope !== "object") return ["context scope is required"];
  if (scope.kind === "global") return [];
  if (!["workspace", "agent", "conversation", "work_item", "session"].includes(scope.kind)) {
    return [`unsupported context scope kind: ${String(scope.kind)}`];
  }
  return isNonEmpty(scope.id) ? [] : [`context scope ${scope.kind} requires id`];
}

function validateSourceRefs(sourceRefs: ContextSourceRef[]): string[] {
  const errors: string[] = [];
  for (const [index, sourceRef] of sourceRefs.entries()) {
    if (!isNonEmpty(sourceRef.ref)) errors.push(`sourceRefs[${index}].ref is required`);
    if (sourceRef.digest !== undefined && !isNonEmpty(sourceRef.digest)) {
      errors.push(`sourceRefs[${index}].digest cannot be empty`);
    }
  }
  return errors;
}

export function validateContextBlock(block: ContextBlock): string[] {
  const errors = [
    ...validateScope(block.scope),
    ...validateSourceRefs(block.sourceRefs),
  ];
  if (block.schemaVersion !== "openscout.context-block.v1") {
    errors.push("unsupported context block schemaVersion");
  }
  if (!CONTEXT_BLOCK_KINDS.includes(block.kind)) errors.push("unsupported context block kind");
  if (block.memoryKind && !MEMORY_KINDS.includes(block.memoryKind)) {
    errors.push("unsupported memoryKind");
  }
  if (!["inline", "summary", "loadable", "searchable"].includes(block.projectionMode)) {
    errors.push("unsupported context projectionMode");
  }
  if (!["readonly", "broker_writable", "append_only"].includes(block.mutability)) {
    errors.push("unsupported context mutability");
  }
  if (!["proposed", "active", "superseded", "archived"].includes(block.state)) {
    errors.push("unsupported context block state");
  }
  if (!isNonEmpty(block.id)) errors.push("context block id is required");
  if (!isNonEmpty(block.title)) errors.push("context block title is required");
  if (!isNonEmpty(block.body)) errors.push("context block body is required");
  if (!isNonEmpty(block.createdById)) errors.push("context block createdById is required");
  if (!isNonEmpty(block.contentHash)) errors.push("context block contentHash is required");
  if (block.kind === "memory" && !block.memoryKind) {
    errors.push("memory context blocks require memoryKind");
  }
  if (block.kind !== "memory" && block.memoryKind) {
    errors.push("memoryKind is only valid for memory context blocks");
  }
  if (block.kind === "memory" && block.sourceRefs.length === 0) {
    errors.push("memory context blocks require provenance sourceRefs");
  }
  if (block.confidence !== undefined && (block.confidence < 0 || block.confidence > 1)) {
    errors.push("context block confidence must be between 0 and 1");
  }
  if (!Number.isInteger(block.version) || block.version < 1) {
    errors.push("context block version must be a positive integer");
  }
  if (block.supersedesId === block.id) {
    errors.push("context block cannot supersede itself");
  }
  if (block.tokenBudget !== undefined && (!Number.isInteger(block.tokenBudget) || block.tokenBudget < 1)) {
    errors.push("context block tokenBudget must be a positive integer");
  }
  if (block.updatedAt < block.createdAt) {
    errors.push("context block updatedAt cannot precede createdAt");
  }
  if (!Number.isFinite(block.createdAt) || !Number.isFinite(block.updatedAt)) {
    errors.push("context block timestamps must be finite numbers");
  }
  if (
    block.freshness?.verifiedAt !== undefined
    && block.freshness.expiresAt !== undefined
    && block.freshness.expiresAt < block.freshness.verifiedAt
  ) {
    errors.push("context block freshness expiresAt cannot precede verifiedAt");
  }
  return errors;
}

export function assertValidContextBlock(block: ContextBlock): void {
  const errors = validateContextBlock(block);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export function validateContextPack(pack: ContextPack): string[] {
  const errors = validateSourceRefs(pack.sourceRefs);
  if (pack.schemaVersion !== "openscout.context-pack.v1") {
    errors.push("unsupported context pack schemaVersion");
  }
  if (!isNonEmpty(pack.id)) errors.push("context pack id is required");
  if (!isNonEmpty(pack.title)) errors.push("context pack title is required");
  if (!isNonEmpty(pack.purpose)) errors.push("context pack purpose is required");
  if (!isNonEmpty(pack.createdById)) errors.push("context pack createdById is required");
  if (!isNonEmpty(pack.contentHash)) errors.push("context pack contentHash is required");
  if (!Number.isFinite(pack.createdAt)) errors.push("context pack createdAt must be a finite number");
  if (pack.sections.length === 0) errors.push("context pack requires at least one section");
  if (!Number.isInteger(pack.budget.maxTokens) || pack.budget.maxTokens < 1) {
    errors.push("context pack maxTokens must be a positive integer");
  }
  if (!Number.isInteger(pack.budget.estimatedTokens) || pack.budget.estimatedTokens < 0) {
    errors.push("context pack estimatedTokens must be a non-negative integer");
  }
  const estimatedTokens = pack.sections.reduce((sum, section, index) => {
    if (!isNonEmpty(section.id)) errors.push(`sections[${index}].id is required`);
    if (!isNonEmpty(section.title)) errors.push(`sections[${index}].title is required`);
    if (!isNonEmpty(section.body)) errors.push(`sections[${index}].body is required`);
    if (!Number.isInteger(section.estimatedTokens) || section.estimatedTokens < 0) {
      errors.push(`sections[${index}].estimatedTokens must be a non-negative integer`);
    }
    errors.push(...validateSourceRefs(section.sourceRefs ?? []).map((error) => `sections[${index}].${error}`));
    return sum + Math.max(0, section.estimatedTokens);
  }, 0);
  if (estimatedTokens !== pack.budget.estimatedTokens) {
    errors.push("context pack estimatedTokens must equal the sum of section estimates");
  }
  if (!pack.budget.truncated && estimatedTokens > pack.budget.maxTokens) {
    errors.push("untruncated context pack cannot exceed maxTokens");
  }
  return errors;
}

export function assertValidContextPack(pack: ContextPack): void {
  const errors = validateContextPack(pack);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export function contextScopeKey(scope: ContextScope): string {
  return scope.kind === "global" ? "global" : `${scope.kind}:${scope.id}`;
}
