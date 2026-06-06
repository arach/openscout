import { basename } from "node:path";
import { getTailDiscovery } from "../tail/service.js";
import type { DiscoveredProcess, DiscoveredTranscript, TailDiscoveryScope } from "../tail/types.js";
import { getCachedEnrichment, setCachedEnrichment } from "./cache.js";
import { enrichClaudeTranscript } from "./claude.js";
import { enrichCodexTranscript } from "./codex.js";
import {
  SESSION_MAX_TURNS,
  type SessionEnrichment,
  type SessionInventory,
  type SessionInventoryScope,
  type SessionRecord,
} from "./types.js";

const ACTIVE_WINDOW_MS = 60_000;
const DEFAULT_TURNS = 3;

const EMPTY_ENRICHMENT: SessionEnrichment = {
  model: null,
  contextUsedTokens: null,
  contextWindowTokens: null,
  lastEventTs: null,
  lastSummary: null,
  lastKind: null,
  lastUserText: null,
  lastAssistantText: null,
  lastToolName: null,
  recentTurns: [],
};

function clampTurns(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return DEFAULT_TURNS;
  return Math.max(0, Math.min(SESSION_MAX_TURNS, Math.trunc(value)));
}

function pathLeaf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return basename(normalized) || normalized;
}

function pathParent(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.at(-1) ?? "";
}

function normalizeRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const leaf = pathLeaf(trimmed);
  return leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
}

function processKey(process: DiscoveredProcess): string {
  return `${process.source}\0${process.cwd ?? ""}`;
}

function transcriptKey(transcript: DiscoveredTranscript): string {
  return `${transcript.source}\0${transcript.cwd ?? ""}`;
}

async function enrich(transcript: DiscoveredTranscript): Promise<SessionEnrichment> {
  const cached = getCachedEnrichment(transcript.transcriptPath, transcript.mtimeMs, transcript.size);
  if (cached) return cached;
  let enrichment: SessionEnrichment = EMPTY_ENRICHMENT;
  try {
    if (transcript.source === "claude") {
      enrichment = await enrichClaudeTranscript(transcript.transcriptPath);
    } else if (transcript.source === "codex") {
      enrichment = await enrichCodexTranscript(transcript.transcriptPath);
    }
  } catch {
    // Best-effort: any parser failure falls back to the empty stub.
  }
  setCachedEnrichment(transcript.transcriptPath, transcript.mtimeMs, transcript.size, enrichment);
  return enrichment;
}

/** Build a fully-enriched inventory of every transcript tail discovery knows about. */
export async function getSessionInventory(
  scope: SessionInventoryScope = "shallow",
  options?: { turns?: number },
): Promise<SessionInventory> {
  const tailScope: TailDiscoveryScope = scope === "deep" ? "deep" : "shallow";
  const turns = clampTurns(options?.turns);
  const discovery = await getTailDiscovery(tailScope === "deep");

  const processByKey = new Map<string, DiscoveredProcess>();
  for (const process of discovery.processes) {
    if (!process.cwd) continue;
    const existing = processByKey.get(processKey(process));
    if (!existing || process.pid < existing.pid) {
      processByKey.set(processKey(process), process);
    }
  }

  const now = Date.now();
  const transcripts = discovery.transcripts ?? [];

  const records: SessionRecord[] = await Promise.all(
    transcripts.map(async (transcript) => {
      const refId =
        normalizeRef(transcript.sessionId) ?? normalizeRef(transcript.transcriptPath) ?? transcript.transcriptPath;
      const process = processByKey.get(transcriptKey(transcript)) ?? null;
      const cached = await enrich(transcript);
      // The cache always holds up to SESSION_MAX_TURNS; slice per request.
      const enrichment: SessionEnrichment = turns >= cached.recentTurns.length
        ? cached
        : { ...cached, recentTurns: cached.recentTurns.slice(-turns) };
      const recencyTs = Math.max(transcript.mtimeMs, enrichment.lastEventTs ?? 0);
      const active = Boolean(process) || now - recencyTs <= ACTIVE_WINDOW_MS;
      const project =
        transcript.project?.trim()
        || (transcript.cwd ? pathLeaf(transcript.cwd) : pathParent(transcript.transcriptPath))
        || "unknown";

      return {
        source: transcript.source || "unknown",
        refId,
        sessionId: transcript.sessionId,
        transcriptPath: transcript.transcriptPath,
        cwd: transcript.cwd,
        project,
        harness: transcript.harness,
        mtimeMs: transcript.mtimeMs,
        size: transcript.size,
        active,
        enrichment,
      } satisfies SessionRecord;
    }),
  );

  records.sort((left, right) => {
    const leftTs = Math.max(left.mtimeMs, left.enrichment.lastEventTs ?? 0);
    const rightTs = Math.max(right.mtimeMs, right.enrichment.lastEventTs ?? 0);
    return rightTs - leftTs || left.project.localeCompare(right.project);
  });

  const bySource: Record<string, number> = {};
  let active = 0;
  for (const record of records) {
    bySource[record.source] = (bySource[record.source] ?? 0) + 1;
    if (record.active) active += 1;
  }

  return {
    generatedAt: now,
    sessions: records,
    totals: {
      total: records.length,
      active,
      bySource,
    },
  };
}
