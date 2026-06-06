/**
 * Real-data aggregator for the home/briefing service gauges.
 *
 * Sources per service:
 *   - codex:  most recent `token_count` event in ~/.codex/sessions/**.jsonl
 *             (carries authoritative rate_limits.secondary — the OpenAI weekly window)
 *   - claude: trailing-7d sum of message.usage tokens across ~/.claude/projects/**.jsonl
 *             (no published cap, so rendered as a status total, not a fill bar)
 *   - github: `gh api rate_limit` resources.core (hourly window; honest about scope)
 *
 * Cached server-side so we can poll cheaply from the client.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { Database } from "bun:sqlite";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

import { configureReadonlyDb, resolveDbPath } from "./db/internal/db.ts";

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const CODEX_LOOKBACK_DAYS = 3;
const GH_CLI_TIMEOUT_MS = 4000;
const CLAUDE_STATUSLINE_MAX_AGE_MS = 6 * 3600 * 1000;
const CODEX_NAMED_BUCKET_FRESHNESS_GRACE_MS = 15 * 60 * 1000;

type GaugeTone = "ok" | "warn" | "err" | "dim";

export type ServiceQuotaWindowGauge = {
  label: string;
  fill: number;
  usedLabel: string;
  capLabel: string;
  unitLabel: string;
  resetAt: number;
};

export type ServiceGauge =
  | {
      id: string;
      label: string;
      kind: "quota";
      fill: number;
      usedLabel: string;
      capLabel: string;
      unitLabel: string;
      resetAt: number;
      windows?: ServiceQuotaWindowGauge[];
    }
  | {
      id: string;
      label: string;
      kind: "status";
      statusLabel: string;
      windowLabel?: string;
      detailLabel?: string;
      tone: GaugeTone;
    };

export type ServiceBudgetsResponse = {
  generatedAt: number;
  gauges: ServiceGauge[];
};

export type LoadServiceBudgetsOptions = {
  forceRefresh?: boolean;
};

let cached: { value: ServiceBudgetsResponse; expiresAt: number } | null = null;
let inflight: Promise<ServiceBudgetsResponse> | null = null;

export async function loadServiceBudgets(
  options: LoadServiceBudgetsOptions = {},
): Promise<ServiceBudgetsResponse> {
  const now = Date.now();
  if (options.forceRefresh) {
    cached = null;
  }
  if (!options.forceRefresh && cached && cached.expiresAt > now) return cached.value;
  if (inflight) return inflight;

  inflight = (async () => {
    const [codex, claude, github] = await Promise.all([
      loadCodexGauge().catch(() => null),
      loadClaudeGauge().catch(() => null),
      loadGithubGauge().catch(() => null),
    ]);
    const gauges = [codex, claude, github].filter((g): g is ServiceGauge => g !== null);
    const value: ServiceBudgetsResponse = { generatedAt: Date.now(), gauges };
    cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function clearServiceBudgetsCache(): void {
  cached = null;
  inflight = null;
}

/* ── codex ──────────────────────────────────────────────────────────── */

type CodexRateLimitWindow = {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
};

type CodexRateLimitsPayload = {
  limit_id?: string | null;
  limit_name?: string | null;
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
};

type CodexRateLimitsSnapshot = {
  path: string;
  timestampMs: number;
  rateLimits: CodexRateLimitsPayload;
};

async function loadCodexGauge(): Promise<ServiceGauge | null> {
  const root = codexSessionsRoot();
  if (!existsSync(root)) return null;

  const snapshot = await readLatestCodexRateLimitsSnapshot(root, CODEX_LOOKBACK_DAYS);
  if (!snapshot) return null;
  const limits = snapshot.rateLimits;

  const windows = [
    codexWindowGauge("primary", limits.primary),
    codexWindowGauge("secondary", limits.secondary),
  ].filter((entry): entry is ServiceQuotaWindowGauge => entry !== null);
  if (windows.length === 0) return null;

  const displayWindow =
    windows.find((window) => window.label === "7d") ??
    windows[windows.length - 1]!;
  const fill = Math.max(...windows.map((window) => window.fill));
  return {
    id: "codex",
    label: "codex",
    kind: "quota",
    fill,
    usedLabel: displayWindow.usedLabel,
    capLabel: displayWindow.capLabel,
    unitLabel: displayWindow.label,
    resetAt: displayWindow.resetAt,
    windows,
  };
}

function codexSessionsRoot(): string {
  return process.env.OPENSCOUT_CODEX_SESSIONS_ROOT?.trim()
    || process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT?.trim()
    || join(homedir(), ".codex", "sessions");
}

function codexWindowGauge(
  kind: "primary" | "secondary",
  window: CodexRateLimitWindow | null | undefined,
): ServiceQuotaWindowGauge | null {
  if (!window || typeof window.used_percent !== "number") return null;
  const fill = Math.max(0, Math.min(1, window.used_percent / 100));
  const resetAt = typeof window.resets_at === "number" && Number.isFinite(window.resets_at)
    ? window.resets_at * 1000
    : Date.now() + (kind === "primary" ? 5 * 3600 * 1000 : WEEK_MS);
  return {
    label: formatQuotaWindowLabel(window.window_minutes, kind),
    fill,
    usedLabel: `${Math.round(window.used_percent)}%`,
    capLabel: "100%",
    unitLabel: "quota",
    resetAt,
  };
}

function formatQuotaWindowLabel(
  windowMinutes: number | undefined,
  fallback: "primary" | "secondary",
): string {
  if (typeof windowMinutes !== "number" || !Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    return fallback === "primary" ? "5h" : "7d";
  }
  if (windowMinutes % (24 * 60) === 0) {
    return `${windowMinutes / (24 * 60)}d`;
  }
  if (windowMinutes % 60 === 0) {
    return `${windowMinutes / 60}h`;
  }
  return `${windowMinutes}m`;
}

function listRecentCodexJsonl(root: string, lookbackDays: number): string[] {
  const cutoffMs = Date.now() - lookbackDays * 86400 * 1000;
  const paths: string[] = [];

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const stat = safeStat(full);
        if (!stat || stat.mtimeMs < cutoffMs) continue;
        paths.push(full);
      }
    }
  };

  walk(root);
  return paths;
}

async function readLatestCodexRateLimitsSnapshot(
  root: string,
  lookbackDays: number,
): Promise<CodexRateLimitsSnapshot | null> {
  const snapshots: CodexRateLimitsSnapshot[] = [];
  for (const path of listRecentCodexJsonl(root, lookbackDays)) {
    const snapshot = await readLatestCodexRateLimitsFromFile(path);
    if (!snapshot) continue;
    snapshots.push(snapshot);
  }
  return selectCodexRateLimitsSnapshot(snapshots);
}

function selectCodexRateLimitsSnapshot(
  snapshots: CodexRateLimitsSnapshot[],
): CodexRateLimitsSnapshot | null {
  if (snapshots.length === 0) return null;
  const sorted = [...snapshots].sort((a, b) => b.timestampMs - a.timestampMs);
  const newest = sorted[0]!;
  const named = sorted.find(isNamedCodexLimitSnapshot);
  if (
    named
    && newest.timestampMs - named.timestampMs <= CODEX_NAMED_BUCKET_FRESHNESS_GRACE_MS
  ) {
    return named;
  }
  return newest;
}

function isNamedCodexLimitSnapshot(snapshot: CodexRateLimitsSnapshot): boolean {
  const id = maybeString(snapshot.rateLimits.limit_id);
  return Boolean(maybeString(snapshot.rateLimits.limit_name) || (id && id !== "codex"));
}

async function readLatestCodexRateLimitsFromFile(path: string): Promise<CodexRateLimitsSnapshot | null> {
  const handle = await open(path, "r");
  try {
    const rl = createInterface({ input: handle.createReadStream({ encoding: "utf8" }) });
    let latest: CodexRateLimitsSnapshot | null = null;
    for await (const line of rl) {
      if (!line.includes("\"rate_limits\"")) continue;
      try {
        const record = JSON.parse(line) as {
          timestamp?: string;
          payload?: { rate_limits?: CodexRateLimitsPayload };
        };
        const limits = record.payload?.rate_limits;
        if (limits && (limits.primary || limits.secondary)) {
          const parsedTimestamp = record.timestamp ? Date.parse(record.timestamp) : NaN;
          const timestampMs = Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;
          if (!latest || timestampMs >= latest.timestampMs) {
            latest = { path, timestampMs, rateLimits: limits };
          }
        }
      } catch {
        // skip malformed line
      }
    }
    return latest;
  } finally {
    await handle.close();
  }
}

/* ── claude ─────────────────────────────────────────────────────────── */

async function loadClaudeGauge(): Promise<ServiceGauge | null> {
  const statusline = readClaudeStatuslineGauge();
  if (statusline) return statusline;

  const since = Date.now() - WEEK_MS;
  const usage = readClaudeBudgetUsageEventsSince(since)
    ?? await readClaudeHistoryUsageSince(since);

  if (!usage || usage.totalTokens === 0) return null;

  return {
    id: "claude",
    label: "claude",
    kind: "status",
    statusLabel: formatTokenCount(usage.totalTokens),
    windowLabel: "7d",
    detailLabel: usage.source === "broker" ? "observe" : "local logs",
    tone: "ok",
  };
}

type ClaudeUsageTotals = {
  totalTokens: number;
  source: "broker" | "history";
};

type ClaudeHistoryUsageTotals = ClaudeUsageTotals & {
  files: number;
  assistantMessages: number;
};

type ClaudeUsageEntry = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

type ClaudeStatuslineWindowPayload = {
  used_percentage?: unknown;
  used_percent?: unknown;
  percent_used?: unknown;
  resets_at?: unknown;
  reset_at?: unknown;
};

type ClaudeStatuslinePayload = {
  openscoutCapturedAt?: unknown;
  rate_limits?: Record<string, unknown>;
  context_window?: {
    remaining_percentage?: unknown;
    total_input_tokens?: unknown;
  };
};

function readClaudeStatuslineGauge(now = Date.now()): ServiceGauge | null {
  const path = process.env.OPENSCOUT_CLAUDE_STATUSLINE_LATEST?.trim()
    || resolveOpenScoutSupportPaths().claudeStatuslineLatestPath;
  if (!existsSync(path)) return null;

  let payload: ClaudeStatuslinePayload;
  try {
    payload = JSON.parse(readFileSync(path, "utf8")) as ClaudeStatuslinePayload;
  } catch {
    return null;
  }

  const capturedAt = timestampMs(payload.openscoutCapturedAt);
  if (capturedAt && now - capturedAt > CLAUDE_STATUSLINE_MAX_AGE_MS) {
    return null;
  }

  const rateLimits = isRecord(payload.rate_limits) ? payload.rate_limits : {};
  const windows = [
    claudeStatuslineWindow("5h", pickStatuslineWindow(rateLimits, ["five_hour", "fiveHour", "5h"]), 5 * 3600 * 1000),
    claudeStatuslineWindow("7d", pickStatuslineWindow(rateLimits, ["seven_day", "sevenDay", "7d"]), WEEK_MS),
  ].filter((entry): entry is ServiceQuotaWindowGauge => entry !== null);

  if (windows.length > 0) {
    const displayWindow = windows.find((window) => window.label === "7d") ?? windows[windows.length - 1]!;
    return {
      id: "claude",
      label: "claude",
      kind: "quota",
      fill: Math.max(...windows.map((window) => window.fill)),
      usedLabel: displayWindow.usedLabel,
      capLabel: displayWindow.capLabel,
      unitLabel: displayWindow.label,
      resetAt: displayWindow.resetAt,
      windows,
    };
  }

  const contextWindow = isRecord(payload.context_window) ? payload.context_window : null;
  const totalInputTokens = numberish(contextWindow?.total_input_tokens);
  const remaining = numberish(contextWindow?.remaining_percentage);
  if (totalInputTokens === 0 && remaining === 0) return null;
  return {
    id: "claude",
    label: "claude",
    kind: "status",
    statusLabel: totalInputTokens > 0 ? formatTokenCount(totalInputTokens) : `${Math.round(remaining)}%`,
    windowLabel: totalInputTokens > 0 ? "ctx" : "remaining",
    detailLabel: remaining > 0 ? `${Math.round(remaining)}% free` : "statusline",
    tone: remaining > 0 && remaining <= 20 ? "warn" : "ok",
  };
}

function pickStatuslineWindow(
  rateLimits: Record<string, unknown>,
  keys: string[],
): ClaudeStatuslineWindowPayload | null {
  for (const key of keys) {
    const value = rateLimits[key];
    if (isRecord(value)) return value as ClaudeStatuslineWindowPayload;
  }
  return null;
}

function claudeStatuslineWindow(
  label: string,
  payload: ClaudeStatuslineWindowPayload | null,
  fallbackWindowMs: number,
): ServiceQuotaWindowGauge | null {
  if (!payload) return null;
  const usedPercent = firstFiniteNumber(
    payload.used_percentage,
    payload.used_percent,
    payload.percent_used,
  );
  if (usedPercent === null) return null;
  const fill = Math.max(0, Math.min(1, usedPercent / 100));
  return {
    label,
    fill,
    usedLabel: `${Math.round(usedPercent)}%`,
    capLabel: "100%",
    unitLabel: "quota",
    resetAt: timestampMs(payload.resets_at ?? payload.reset_at) ?? (Date.now() + fallbackWindowMs),
  };
}

function readClaudeBudgetUsageEventsSince(sinceMs: number): ClaudeUsageTotals | null {
  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) return null;

  let database: Database | null = null;
  try {
    database = new Database(dbPath, { readonly: true });
    configureReadonlyDb(database);
    const row = database
      .query<{
        rows: number;
        totalTokens: number | null;
      }, [number]>(`
        SELECT
          COUNT(*) AS rows,
          SUM(
            CASE
              WHEN (
                COALESCE(input_tokens, 0)
                + COALESCE(output_tokens, 0)
                + COALESCE(reasoning_output_tokens, 0)
                + COALESCE(cache_creation_input_tokens, 0)
                + COALESCE(cache_read_input_tokens, 0)
              ) > 0
              THEN (
                COALESCE(input_tokens, 0)
                + COALESCE(output_tokens, 0)
                + COALESCE(reasoning_output_tokens, 0)
                + COALESCE(cache_creation_input_tokens, 0)
                + COALESCE(cache_read_input_tokens, 0)
              )
              ELSE COALESCE(total_tokens, 0)
            END
          ) AS totalTokens
        FROM budget_usage_events
        WHERE occurred_at >= ?
          AND (
            provider = 'anthropic'
            OR harness = 'claude'
            OR source LIKE 'claude-code.%'
          )
      `)
      .get(sinceMs);
    const totalTokens = Math.max(0, Math.round(numberish(row?.totalTokens)));
    if (!row || numberish(row.rows) === 0 || totalTokens === 0) return null;
    return { totalTokens, source: "broker" };
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

async function readClaudeHistoryUsageSince(sinceMs: number): Promise<ClaudeHistoryUsageTotals | null> {
  const root = claudeProjectsRoot();
  if (!existsSync(root)) return null;

  let totalTokens = 0;
  let files = 0;
  let assistantMessages = 0;

  for (const file of listClaudeProjectJsonl(root, sinceMs)) {
    try {
      const usage = await sumClaudeTokensSince(file, sinceMs);
      totalTokens += usage.totalTokens;
      assistantMessages += usage.assistantMessages;
      files++;
    } catch {
      // ignore unreadable file
    }
  }

  if (files === 0 || totalTokens === 0) return null;
  return { totalTokens, files, assistantMessages, source: "history" };
}

function claudeProjectsRoot(): string {
  return process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT?.trim()
    || process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT?.trim()
    || join(homedir(), ".claude", "projects");
}

function listClaudeProjectJsonl(root: string, sinceMs: number): string[] {
  const out: string[] = [];
  let projects;
  try {
    projects = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectDir = join(root, project.name);
    let files;
    try {
      files = readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const full = join(projectDir, file.name);
      const stat = safeStat(full);
      if (!stat || stat.mtimeMs < sinceMs) continue;
      out.push(full);
    }
  }
  return out;
}

async function sumClaudeTokensSince(
  path: string,
  sinceMs: number,
): Promise<ClaudeHistoryUsageTotals> {
  const handle = await open(path, "r");
  try {
    const rl = createInterface({ input: handle.createReadStream({ encoding: "utf8" }) });
    const usageByMessageId = new Map<string, ClaudeUsageEntry>();
    for await (const line of rl) {
      if (!line.includes("\"usage\"")) continue;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        const timestamp = maybeString(record.timestamp);
        const ts = timestamp ? Date.parse(timestamp) : NaN;
        if (Number.isFinite(ts) && ts < sinceMs) continue;
        const usage = readClaudeUsageEntry(record);
        if (!usage) continue;
        const messageId = claudeUsageMessageId(record);
        if (!messageId) continue;
        usageByMessageId.set(messageId, usage);
      } catch {
        // skip malformed
      }
    }
    let totalTokens = 0;
    for (const usage of usageByMessageId.values()) {
      totalTokens += totalClaudeUsageTokens(usage);
    }
    return {
      totalTokens,
      assistantMessages: usageByMessageId.size,
      files: 1,
      source: "history",
    };
  } finally {
    await handle.close();
  }
}

function readClaudeUsageEntry(record: Record<string, unknown>): ClaudeUsageEntry | null {
  const message = isRecord(record.message) ? record.message : null;
  const type = maybeString(record.type);
  const role = maybeString(message?.role);
  if (type !== "assistant" && role !== "assistant") return null;

  const usage = isRecord(message?.usage) ? message.usage : null;
  if (!usage) return null;

  const entry: ClaudeUsageEntry = {
    inputTokens: numberish(usage.input_tokens),
    outputTokens: numberish(usage.output_tokens),
    cacheReadInputTokens: numberish(usage.cache_read_input_tokens),
    cacheCreationInputTokens: numberish(usage.cache_creation_input_tokens),
  };
  return totalClaudeUsageTokens(entry) > 0 ? entry : null;
}

function claudeUsageMessageId(record: Record<string, unknown>): string | null {
  const message = isRecord(record.message) ? record.message : null;
  return maybeString(message?.id)
    ?? maybeString(record.requestId)
    ?? maybeString(record.uuid);
}

function totalClaudeUsageTokens(usage: ClaudeUsageEntry): number {
  return usage.inputTokens
    + usage.outputTokens
    + usage.cacheReadInputTokens
    + usage.cacheCreationInputTokens;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function maybeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function timestampMs(value: unknown): number | null {
  const parsed = finiteNumber(value);
  if (parsed === null || parsed <= 0) return null;
  return parsed < 1_000_000_000_000 ? Math.round(parsed * 1000) : Math.round(parsed);
}

function numberish(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/* ── github ─────────────────────────────────────────────────────────── */

type GhRateLimitResponse = {
  resources?: {
    core?: { limit?: number; remaining?: number; reset?: number };
  };
};

async function loadGithubGauge(): Promise<ServiceGauge | null> {
  let stdout: string;
  try {
    const result = await execFileAsync("gh", ["api", "rate_limit"], {
      timeout: GH_CLI_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
    });
    stdout = result.stdout;
  } catch {
    return null;
  }

  let parsed: GhRateLimitResponse;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  const core = parsed.resources?.core;
  if (!core || typeof core.limit !== "number" || typeof core.remaining !== "number") {
    return null;
  }

  const limit = core.limit;
  const used = Math.max(0, limit - core.remaining);
  const fill = limit > 0 ? Math.max(0, Math.min(1, used / limit)) : 0;
  const resetAt = typeof core.reset === "number" && Number.isFinite(core.reset)
    ? core.reset * 1000
    : Date.now() + 3600 * 1000;

  return {
    id: "github",
    label: "github",
    kind: "quota",
    fill,
    usedLabel: formatRequestCount(used),
    capLabel: formatRequestCount(limit),
    unitLabel: "req/h",
    resetAt,
    windows: [{
      label: "1h",
      fill,
      usedLabel: formatRequestCount(used),
      capLabel: formatRequestCount(limit),
      unitLabel: "req",
      resetAt,
    }],
  };
}

function formatRequestCount(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/* ── shared ─────────────────────────────────────────────────────────── */

function safeStat(path: string): { mtimeMs: number } | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
