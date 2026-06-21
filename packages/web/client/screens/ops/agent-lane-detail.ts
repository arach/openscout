import { plausibleTouchedFiles } from "../../lib/lane-observe.ts";
import { observeToolIsEdit, observeToolIsRead } from "../../lib/tail-display.ts";
import type {
  ObserveData,
  ObserveFile,
  ObserveUsageMeta,
  PlanDocument,
} from "../../lib/types.ts";
import type { AgentLane } from "./agent-lanes-model.ts";

export type LaneSessionStats = {
  tools: number;
  edits: number;
  reads: number;
  thinks: number;
  files: number;
  events: number;
  model: string | null;
  branch: string | null;
  harness: string | null;
  cwd: string | null;
  sessionId: string | null;
  usage: ObserveUsageMeta | null;
};

export type LaneSessionDocuments = {
  plans: PlanDocument[];
  docs: PlanDocument[];
};

export function buildLaneSessionStats(lane: AgentLane): LaneSessionStats {
  const { agent, observe } = lane;
  const session = observe?.metadata?.session;
  const events = observe?.events ?? [];
  const files = observe?.files ?? [];

  return {
    tools: events.filter((event) => event.kind === "tool").length,
    edits: events.filter(
      (event) => event.kind === "tool" && observeToolIsEdit(event.tool),
    ).length,
    reads: events.filter(
      (event) => event.kind === "tool" && observeToolIsRead(event.tool),
    ).length,
    thinks: events.filter((event) => event.kind === "think").length,
    files: files.length,
    events: events.length,
    model: session?.model ?? agent.model ?? null,
    branch: session?.gitBranch ?? agent.branch ?? null,
    harness: agent.harness ?? session?.adapterType ?? null,
    cwd: session?.cwd ?? agent.cwd ?? agent.projectRoot ?? null,
    sessionId: session?.externalSessionId ?? agent.harnessSessionId ?? null,
    usage: observe?.metadata?.usage ?? null,
  };
}

export function buildLaneTouchedFiles(
  observe: ObserveData | null | undefined,
  limit = 10,
): ObserveFile[] {
  if (!observe || observe.files.length === 0) return [];

  // `observe.files` READ entries can leak mis-recorded bash tokens (e.g. `necho`,
  // `nCHROME=`); gate + dedupe before display so only real paths surface.
  return plausibleTouchedFiles(observe.files)
    .sort((left, right) => {
      const leftChanged = left.state === "read" ? 0 : 1;
      const rightChanged = right.state === "read" ? 0 : 1;
      if (leftChanged !== rightChanged) return rightChanged - leftChanged;
      return right.lastT - left.lastT;
    })
    .slice(0, limit);
}

export function docExcerpt(document: PlanDocument, max = 220): string {
  const source = document.summary?.trim() || document.body.trim() || document.rawText.trim();
  if (!source) return "";
  const normalized = source.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function planBasename(value: string): string {
  const clean = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  const idx = clean.lastIndexOf("/");
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

function planSignificantTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !["plan", "plans", "todo", "work", "task", "docs", "markdown"].includes(token))
    .slice(0, 8);
}

export function scorePlanForLane(document: PlanDocument, lane: AgentLane): number {
  const { agent, observe, source } = lane;
  const session = observe?.metadata?.session;
  const haystack = [
    agent.project,
    agent.name,
    agent.branch,
    agent.harness,
    agent.workspace,
    agent.harnessSessionId,
    session?.cwd,
    session?.gitBranch,
    session?.model,
    ...observe?.files.map((file) => file.path) ?? [],
    ...observe?.events.slice(-12).flatMap((event) => [event.arg, event.text, event.detail]) ?? [],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!haystack) return 0;

  const path = document.path.toLowerCase();
  const file = planBasename(path).toLowerCase();
  const title = document.title.toLowerCase();
  let score = 0;

  if (document.agentId && document.agentId === agent.id) score += 10;
  if (document.agentName && document.agentName === agent.name) score += 6;
  if (document.workspaceName && agent.project && document.workspaceName.toLowerCase() === agent.project.toLowerCase()) {
    score += 5;
  }
  if (path && haystack.includes(path)) score += 8;
  if (file && haystack.includes(file)) score += 6;
  if (title.length > 8 && haystack.includes(title)) score += 6;

  for (const tag of document.tags) {
    if (tag.length >= 3 && haystack.includes(tag.toLowerCase())) score += 2;
  }
  for (const token of planSignificantTokens(document.title)) {
    if (haystack.includes(token)) score += 1;
  }
  for (const step of document.steps.slice(0, 8)) {
    for (const token of planSignificantTokens(step.text).slice(0, 3)) {
      if (haystack.includes(token)) score += 1;
    }
  }

  if (source === "scout" && document.source === "openscout") score += 2;

  return score;
}

function rankedLaneDocuments(
  documents: PlanDocument[],
  lane: AgentLane,
  minimumScore = 4,
) {
  return documents
    .map((document) => ({ document, score: scorePlanForLane(document, lane) }))
    .filter((entry) => entry.score >= minimumScore)
    .sort((left, right) => right.score - left.score || right.document.updatedAt - left.document.updatedAt);
}

export function relatedLanePlans(
  documents: PlanDocument[],
  lane: AgentLane,
  limit = 4,
): PlanDocument[] {
  return rankedLaneDocuments(documents, lane)
    .filter((entry) => entry.document.steps.length > 0)
    .slice(0, limit)
    .map((entry) => entry.document);
}

export function relatedLaneDocs(
  documents: PlanDocument[],
  lane: AgentLane,
  limit = 6,
): PlanDocument[] {
  return rankedLaneDocuments(documents, lane)
    .filter((entry) => entry.document.steps.length === 0)
    .slice(0, limit)
    .map((entry) => entry.document);
}

export function relatedLaneSessionDocuments(
  documents: PlanDocument[],
  lane: AgentLane,
  limits: { plans?: number; docs?: number } = {},
): LaneSessionDocuments {
  return {
    plans: relatedLanePlans(documents, lane, limits.plans ?? 4),
    docs: relatedLaneDocs(documents, lane, limits.docs ?? 6),
  };
}
