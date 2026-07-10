import type {
  ContextBlock,
  ContextPack,
  ContextPackSection,
  ContextPackTarget,
  ContextScope,
  ContextSourceRef,
  MemoryCandidate,
  MemoryKind,
} from "@openscout/protocol";

import type { ActionBlock, Block, QuestionBlock, TextBlock } from "./protocol/primitives.js";
import type { SessionState } from "./state.js";

export interface SessionEvidence {
  schemaVersion: "openscout.session-evidence.v1";
  sessionId: string;
  adapterType: string;
  cwd?: string;
  capturedAt: number;
  sourceRef: ContextSourceRef;
  snapshot: SessionState;
  limitations: string[];
}

export interface CreateSessionEvidenceInput {
  capturedAt?: number;
  sourceRef?: ContextSourceRef;
  digest?: string;
  limitations?: string[];
}

export interface DistillMemoryOptions {
  scope?: ContextScope;
  includeWorkingState?: boolean;
  maxWorkingStateCharacters?: number;
}

export interface MaterializeMemoryCandidateInput {
  createdById: string;
  state?: ContextBlock["state"];
  projectionMode?: ContextBlock["projectionMode"];
  mutability?: ContextBlock["mutability"];
  now?: number;
}

export interface AssembleContextPackInput {
  id?: string;
  title?: string;
  purpose: string;
  task: string;
  target: ContextPackTarget;
  memories: ContextBlock[];
  evidence?: SessionEvidence;
  createdById: string;
  maxTokens?: number;
  recentEvidenceMaxTokens?: number;
  now?: number;
  limitations?: string[];
}

const MEMORY_LABELS: Record<MemoryKind, string> = {
  fact: "Fact",
  decision: "Decision",
  constraint: "Constraint",
  preference: "Preference",
  procedure: "Procedure",
  artifact: "Artifact",
  open_loop: "Open loop",
  working_state: "Working state",
};

const MEMORY_PRIORITY: Record<MemoryKind, number> = {
  constraint: 0,
  decision: 1,
  open_loop: 2,
  working_state: 3,
  procedure: 4,
  fact: 5,
  preference: 6,
  artifact: 7,
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

/** Small deterministic content fingerprint; integrity remains owned by source adapters. */
export function contextContentHash(value: unknown): string {
  const text = JSON.stringify(stableValue(value));
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

export function estimateContextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function materializeMemoryCandidate(
  candidate: MemoryCandidate,
  input: MaterializeMemoryCandidateInput,
): ContextBlock {
  const now = input.now ?? Date.now();
  const contentHash = contextContentHash({
    kind: "memory",
    memoryKind: candidate.memoryKind,
    title: candidate.title,
    body: candidate.body,
    summary: candidate.summary,
    scope: candidate.scope,
    sourceRefs: candidate.sourceRefs,
  });
  return {
    schemaVersion: "openscout.context-block.v1",
    id: `memory.${contentHash.slice(-16)}`,
    kind: "memory",
    memoryKind: candidate.memoryKind,
    title: candidate.title,
    body: candidate.body,
    summary: candidate.summary,
    scope: candidate.scope,
    projectionMode: input.projectionMode ?? "inline",
    mutability: input.mutability ?? "broker_writable",
    state: input.state ?? "proposed",
    createdById: input.createdById,
    sourceRefs: candidate.sourceRefs,
    confidence: candidate.confidence,
    freshness: candidate.freshness,
    version: 1,
    contentHash,
    createdAt: now,
    updatedAt: now,
    metadata: candidate.metadata,
  };
}

export function createSessionEvidence(
  snapshot: SessionState,
  input: CreateSessionEvidenceInput = {},
): SessionEvidence {
  const capturedAt = input.capturedAt ?? Date.now();
  const digest = input.digest ?? contextContentHash({
    session: snapshot.session,
    turns: snapshot.turns,
  });
  const sourceRef = input.sourceRef ?? {
    kind: "session_observation",
    ref: `session:${snapshot.session.adapterType}:${snapshot.session.id}`,
    digest,
    observedAt: capturedAt,
  };
  return {
    schemaVersion: "openscout.session-evidence.v1",
    sessionId: snapshot.session.id,
    adapterType: snapshot.session.adapterType,
    cwd: snapshot.session.cwd,
    capturedAt,
    sourceRef,
    snapshot,
    limitations: [...(input.limitations ?? [])],
  };
}

function defaultEvidenceScope(evidence: SessionEvidence): ContextScope {
  return evidence.cwd
    ? { kind: "workspace", id: evidence.cwd }
    : { kind: "session", id: evidence.sessionId };
}

function completedTextBlocks(evidence: SessionEvidence): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const turn of evidence.snapshot.turns) {
    for (const blockState of turn.blocks) {
      if (blockState.block.type === "text" && blockState.block.text.trim()) {
        blocks.push(blockState.block);
      }
    }
  }
  return blocks;
}

function candidateId(evidence: SessionEvidence, kind: MemoryKind, body: string): string {
  return `memcand.${contextContentHash({ source: evidence.sourceRef.ref, kind, body }).slice(-16)}`;
}

function memoryCandidate(
  evidence: SessionEvidence,
  scope: ContextScope,
  kind: MemoryKind,
  body: string,
  title?: string,
  confidence = 0.8,
  metadata?: Record<string, unknown>,
): MemoryCandidate {
  const normalizedBody = body.trim();
  return {
    id: candidateId(evidence, kind, normalizedBody),
    memoryKind: kind,
    title: title?.trim() || `${MEMORY_LABELS[kind]} from ${evidence.adapterType}`,
    body: normalizedBody,
    scope,
    sourceRefs: [{ ...evidence.sourceRef }],
    confidence,
    freshness: {
      verifiedAt: evidence.capturedAt,
      policy: kind === "working_state" || kind === "open_loop" ? "session" : "source_revision",
    },
    metadata: {
      sourceSessionId: evidence.sessionId,
      sourceAdapterType: evidence.adapterType,
      ...metadata,
    },
  };
}

function prefixedMemoryLine(line: string): { kind: MemoryKind; body: string } | null {
  const match = line.match(
    /^\s*(fact|decision|constraint|preference|procedure|artifact|open[ _-]?loop|todo|next(?: move)?|working[ _-]?state)\s*[:\-]\s*(.+?)\s*$/iu,
  );
  if (!match) return null;
  const label = match[1]?.toLowerCase().replace(/[ _-]/gu, "") ?? "";
  const kind: MemoryKind = label === "openloop" || label === "todo" || label === "next" || label === "nextmove"
    ? "open_loop"
    : label === "workingstate"
      ? "working_state"
      : label as MemoryKind;
  const body = match[2]?.trim() ?? "";
  return body ? { kind, body } : null;
}

function actionCandidates(
  evidence: SessionEvidence,
  scope: ContextScope,
  block: ActionBlock,
): MemoryCandidate[] {
  if (block.action.kind === "file_change") {
    const body = block.action.diff?.trim()
      ? `${block.action.path}\n${block.action.diff.trim()}`
      : block.action.path;
    return [memoryCandidate(evidence, scope, "artifact", body, `Changed ${block.action.path}`, 0.95, {
      actionKind: block.action.kind,
      path: block.action.path,
    })];
  }
  if (block.action.status === "failed") {
    const label = block.action.kind === "command"
      ? block.action.command
      : block.action.kind === "tool_call"
        ? block.action.toolName
        : block.action.kind;
    return [memoryCandidate(
      evidence,
      scope,
      "open_loop",
      `${label} failed${block.action.output.trim() ? `: ${block.action.output.trim()}` : ""}`,
      `Unresolved ${block.action.kind}`,
      0.9,
      { actionKind: block.action.kind },
    )];
  }
  return [];
}

function questionCandidate(
  evidence: SessionEvidence,
  scope: ContextScope,
  block: QuestionBlock,
): MemoryCandidate[] {
  if (block.questionStatus !== "awaiting_answer") return [];
  return [memoryCandidate(
    evidence,
    scope,
    "open_loop",
    block.question,
    block.header || "Unanswered question",
    0.95,
    { options: block.options },
  )];
}

export function distillMemoryCandidates(
  evidence: SessionEvidence,
  options: DistillMemoryOptions = {},
): MemoryCandidate[] {
  const scope = options.scope ?? defaultEvidenceScope(evidence);
  const candidates = new Map<string, MemoryCandidate>();
  const add = (candidate: MemoryCandidate) => {
    const key = `${candidate.memoryKind}\u0000${candidate.body.toLowerCase()}`;
    if (!candidates.has(key)) candidates.set(key, candidate);
  };

  for (const turn of evidence.snapshot.turns) {
    for (const blockState of turn.blocks) {
      const block: Block = blockState.block;
      if (block.type === "text") {
        for (const line of block.text.split(/\r?\n/gu)) {
          const parsed = prefixedMemoryLine(line);
          if (parsed) add(memoryCandidate(evidence, scope, parsed.kind, parsed.body));
        }
      } else if (block.type === "action") {
        for (const candidate of actionCandidates(evidence, scope, block)) add(candidate);
      } else if (block.type === "question") {
        for (const candidate of questionCandidate(evidence, scope, block)) add(candidate);
      }
    }
  }

  if (options.includeWorkingState !== false) {
    const latest = completedTextBlocks(evidence).at(-1)?.text.trim();
    if (latest) {
      const maxCharacters = options.maxWorkingStateCharacters ?? 1_200;
      const body = latest.length <= maxCharacters
        ? latest
        : `${latest.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
      add(memoryCandidate(
        evidence,
        scope,
        "working_state",
        body,
        `Latest working state from ${evidence.adapterType}`,
        0.65,
      ));
    }
  }

  return [...candidates.values()];
}

function memoryIsApplicable(block: ContextBlock, input: AssembleContextPackInput, now: number): boolean {
  if (block.kind !== "memory" || block.state !== "active" || !block.memoryKind) return false;
  if (block.freshness?.expiresAt !== undefined && block.freshness.expiresAt <= now) return false;
  if (block.scope.kind === "global") return true;
  if (block.scope.kind === "workspace") return block.scope.id === input.target.projectPath;
  if (block.scope.kind === "agent") return block.scope.id === input.target.agentId;
  if (block.scope.kind === "conversation") return block.scope.id === input.target.conversationId;
  if (block.scope.kind === "work_item") return block.scope.id === input.target.workItemId;
  if (block.scope.kind === "session") {
    return block.scope.id === input.target.sessionId || block.scope.id === input.evidence?.sessionId;
  }
  return false;
}

function memoryBody(block: ContextBlock): string {
  const rendered = block.projectionMode === "summary" && block.summary?.trim()
    ? block.summary.trim()
    : block.body.trim();
  return `- **${MEMORY_LABELS[block.memoryKind!]} — ${block.title}:** ${rendered}`;
}

function recentEvidenceText(evidence: SessionEvidence, maxTokens: number): { body: string; truncated: boolean } | null {
  const blocks = completedTextBlocks(evidence);
  if (blocks.length === 0 || maxTokens <= 0) return null;
  const selected: string[] = [];
  let tokens = 0;
  let truncated = false;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const text = blocks[index]!.text.trim();
    const estimate = estimateContextTokens(text);
    if (tokens + estimate > maxTokens) {
      truncated = true;
      continue;
    }
    selected.unshift(text);
    tokens += estimate;
  }
  return selected.length > 0 ? { body: selected.join("\n\n---\n\n"), truncated } : null;
}

function fitSection(
  sections: ContextPackSection[],
  section: Omit<ContextPackSection, "estimatedTokens">,
  maxTokens: number,
): boolean {
  const estimatedTokens = estimateContextTokens(section.body);
  const used = sections.reduce((sum, current) => sum + current.estimatedTokens, 0);
  if (used + estimatedTokens > maxTokens) return false;
  sections.push({ ...section, estimatedTokens });
  return true;
}

export function assembleContextPack(input: AssembleContextPackInput): ContextPack {
  const now = input.now ?? Date.now();
  const maxTokens = input.maxTokens ?? 4_000;
  const sections: ContextPackSection[] = [];
  let truncated = false;

  if (!fitSection(sections, {
    id: "task-frame",
    kind: "task_frame",
    title: "Current task",
    body: input.task.trim(),
    sourceRefs: [{ kind: "operator", ref: input.createdById }],
  }, maxTokens)) {
    throw new Error("context pack budget is too small for the task frame");
  }

  const applicableMemories = input.memories
    .filter((block) => memoryIsApplicable(block, input, now))
    .sort((left, right) => {
      const priority = MEMORY_PRIORITY[left.memoryKind!] - MEMORY_PRIORITY[right.memoryKind!];
      return priority || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
    });
  const includedMemories: ContextBlock[] = [];
  for (const memory of applicableMemories) {
    const body = memoryBody(memory);
    const existing = sections.find((section) => section.kind === "memory");
    if (existing) {
      const nextBody = `${existing.body}\n${body}`;
      const nextEstimate = estimateContextTokens(nextBody);
      const otherTokens = sections.reduce((sum, section) => sum + (section === existing ? 0 : section.estimatedTokens), 0);
      if (otherTokens + nextEstimate <= maxTokens) {
        existing.body = nextBody;
        existing.estimatedTokens = nextEstimate;
        existing.contextBlockIds = [...(existing.contextBlockIds ?? []), memory.id];
        existing.sourceRefs = [...(existing.sourceRefs ?? []), ...memory.sourceRefs];
        includedMemories.push(memory);
      } else {
        truncated = true;
      }
      continue;
    }
    if (fitSection(sections, {
      id: "memory",
      kind: "memory",
      title: "Relevant memory",
      body,
      contextBlockIds: [memory.id],
      sourceRefs: memory.sourceRefs,
    }, maxTokens)) {
      includedMemories.push(memory);
    } else {
      truncated = true;
    }
  }

  if (input.evidence) {
    const remaining = maxTokens - sections.reduce((sum, section) => sum + section.estimatedTokens, 0);
    const recentBudget = Math.min(input.recentEvidenceMaxTokens ?? 1_000, Math.max(0, remaining));
    const recent = recentEvidenceText(input.evidence, recentBudget);
    if (recent) {
      if (!fitSection(sections, {
        id: "recent-evidence",
        kind: "recent_evidence",
        title: "Recent observed session evidence",
        body: recent.body,
        sourceRefs: [{ ...input.evidence.sourceRef }],
        metadata: { ownership: "harness_observed" },
      }, maxTokens)) {
        truncated = true;
      }
      truncated ||= recent.truncated;
    }
  }

  const limitations = [...new Set([
    ...(input.limitations ?? []),
    ...(input.evidence?.limitations ?? []),
    ...(truncated ? ["Context was truncated to fit the configured token budget."] : []),
  ])];
  if (limitations.length > 0 && !fitSection(sections, {
    id: "limitations",
    kind: "limitations",
    title: "Limitations",
    body: limitations.map((limitation) => `- ${limitation}`).join("\n"),
  }, maxTokens)) {
    truncated = true;
  }

  const sourceRefs = [
    { kind: "operator", ref: input.createdById } as ContextSourceRef,
    ...includedMemories.flatMap((memory) => memory.sourceRefs),
    ...(input.evidence ? [{ ...input.evidence.sourceRef }] : []),
  ];
  const contextBlockIds = includedMemories.map((memory) => memory.id);
  const estimatedTokens = sections.reduce((sum, section) => sum + section.estimatedTokens, 0);
  const hashInput = {
    purpose: input.purpose,
    target: input.target,
    sections,
    contextBlockIds,
    sourceRefs,
    limitations,
  };
  const contentHash = contextContentHash(hashInput);

  return {
    schemaVersion: "openscout.context-pack.v1",
    id: input.id ?? `ctxpack.${contentHash.slice(-16)}`,
    title: input.title?.trim() || input.purpose.trim(),
    purpose: input.purpose.trim(),
    target: input.target,
    sections,
    contextBlockIds,
    sourceRefs,
    budget: { maxTokens, estimatedTokens, truncated },
    limitations,
    contentHash,
    createdById: input.createdById,
    createdAt: now,
    metadata: {
      assemblyStrategy: "constructive_memory_plus_bounded_evidence_v1",
      sourceSessionId: input.evidence?.sessionId,
    },
  };
}

export function renderContextPackPrompt(pack: ContextPack): string {
  return [
    `# ${pack.title}`,
    "",
    `Context pack: ${pack.id}`,
    `Purpose: ${pack.purpose}`,
    "",
    ...pack.sections.flatMap((section) => [
      `## ${section.title}`,
      "",
      section.body,
      "",
    ]),
    "Use this as bounded constructive context. Treat cited session material as observed evidence, not as new Scout-authored messages.",
  ].join("\n").trim();
}
