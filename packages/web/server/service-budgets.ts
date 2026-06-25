/**
 * Real-data aggregator for the home/briefing service gauges.
 *
 * Sources per service:
 *   - codex:  most recent `token_count` event in ~/.codex/sessions/**.jsonl
 *             (carries authoritative rate_limits.secondary — the OpenAI weekly window)
 *   - claude: provider-reported Anthropic quota windows from statusline capture
 *             or the control-plane DB when available
 *   - github: `gh api rate_limit` resources.core (hourly window; honest about scope)
 *
 * Cached server-side so we can poll cheaply from the client.
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { Database } from "bun:sqlite";
import { epochMs } from "@openscout/protocol";
import { resolveClaudeStatuslineDirectory } from "@openscout/runtime/claude-statusline";
import { db, resolveDbPath } from "./db/internal/db.ts";

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const CODEX_LOOKBACK_DAYS = 3;
const GH_CLI_TIMEOUT_MS = 4000;
const DB_BUSY_TIMEOUT_MS = 2_500;
const QUOTA_HISTORY_BUCKET_MS = 60 * 60 * 1000;
const QUOTA_HISTORY_LOOKBACK_MS = WEEK_MS;
const QUOTA_HISTORY_ID_PREFIX = "budget:quota:history:";
const PERSISTED_QUOTA_ROW_LIMIT = 768;
const CLAUDE_STATUSLINE_HISTORY_MAX_BYTES = 32 * 1024 * 1024;
const GH_CLI_BIN_ENV = "OPENSCOUT_GH_BIN";
const GH_RATE_LIMIT_JSON_ENV = "OPENSCOUT_GH_RATE_LIMIT_JSON";

type GaugeTone = "ok" | "warn" | "err" | "dim";

export type ServiceQuotaHistoryPoint = {
  capturedAt: number;
  fill: number;
  usedLabel: string;
  resetAt?: number;
};

export type ServiceQuotaWindowGauge = {
  label: string;
  fill: number;
  usedLabel: string;
  capLabel: string;
  unitLabel: string;
  resetAt: number;
  history?: ServiceQuotaHistoryPoint[];
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

let cached: { value: ServiceBudgetsResponse; expiresAt: number } | null = null;
let inflight: Promise<ServiceBudgetsResponse> | null = null;
let quotaWriteDb: Database | null = null;

export function resetServiceBudgetsCache(): void {
  cached = null;
  inflight = null;
  quotaWriteDb?.close();
  quotaWriteDb = null;
}

export async function loadServiceBudgets(forceRefresh = false): Promise<ServiceBudgetsResponse> {
  const now = Date.now();
  if (!forceRefresh && cached && cached.expiresAt > now) return cached.value;
  if (!forceRefresh && inflight) return inflight;

  inflight = (async () => {
    const [codex, claude, github] = await Promise.all([
      loadCodexGauge(forceRefresh).catch((error) => serviceBudgetProviderFailed("codex", error)),
      loadClaudeGauge().catch((error) => serviceBudgetProviderFailed("claude", error)),
      loadGithubGauge(forceRefresh).catch((error) => serviceBudgetProviderFailed("github", error)),
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

function serviceBudgetProviderFailed(provider: string, error: unknown): null {
  debugServiceBudgetProvider(provider, "gauge failed", error);
  return null;
}

function debugServiceBudgetProvider(provider: string, message: string, detail?: unknown): void {
  if (process.env.OPENSCOUT_DEBUG_SERVICE_BUDGETS === "1") {
    console.error(`[service-budgets] ${provider} ${message}`, detail);
  }
}

/* ── codex ──────────────────────────────────────────────────────────── */

type CodexRateLimitWindow = {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
};

type CodexRateLimitsPayload = {
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
};

type CodexRateLimitsObservation = {
  limits: CodexRateLimitsPayload;
  capturedAt: number;
};

async function loadCodexGauge(forceRefresh = false): Promise<ServiceGauge | null> {
  if (!forceRefresh) {
    const persisted = loadPersistedProviderQuotaGauge({
      id: "codex",
      label: "codex",
      provider: "openai",
      harness: "codex",
      maxAgeMs: WEEK_MS,
    });
    if (persisted) return persisted;
  }

  const root = join(homeDir(), ".codex", "sessions");
  if (!existsSync(root)) return null;

  const latest = findLatestCodexJsonl(root, CODEX_LOOKBACK_DAYS);
  if (!latest) return null;

  const observation = await readLatestCodexRateLimits(latest);
  if (!observation) return null;

  const snapshots = codexQuotaSnapshotsFromRateLimits(observation.limits, observation.capturedAt);
  persistQuotaSnapshots(snapshots);
  const persisted = loadPersistedProviderQuotaGauge({
    id: "codex",
    label: "codex",
    provider: "openai",
    harness: "codex",
    maxAgeMs: WEEK_MS,
  });
  if (persisted) return persisted;
  return quotaGaugeFromSnapshots({
    id: "codex",
    label: "codex",
  }, snapshots);
}

function codexQuotaSnapshot(
  kind: "primary" | "secondary",
  window: CodexRateLimitWindow | null | undefined,
  capturedAt: number,
): ServiceQuotaSnapshot | null {
  if (!window || typeof window.used_percent !== "number") return null;
  const resetAt = typeof window.resets_at === "number" && Number.isFinite(window.resets_at)
    ? window.resets_at * 1000
    : capturedAt + (kind === "primary" ? 5 * 3600 * 1000 : WEEK_MS);
  const windowMs = typeof window.window_minutes === "number" && Number.isFinite(window.window_minutes)
    ? window.window_minutes * 60_000
    : kind === "primary"
      ? 5 * 3600 * 1000
      : WEEK_MS;
  return {
    provider: "openai",
    harness: "codex",
    transport: "codex_app_server",
    label: formatQuotaWindowLabel(window.window_minutes, kind),
    windowKind: kind,
    usedPercent: window.used_percent,
    percentRemaining: Math.max(0, 100 - window.used_percent),
    resetAt,
    windowMs,
    capturedAt,
    metadata: {
      source: "service-budgets.codex-jsonl",
    },
  };
}

function codexQuotaSnapshotsFromRateLimits(
  limits: CodexRateLimitsPayload,
  capturedAt: number,
): ServiceQuotaSnapshot[] {
  return [
    codexQuotaSnapshot("primary", limits.primary, capturedAt),
    codexQuotaSnapshot("secondary", limits.secondary, capturedAt),
  ].filter((entry): entry is ServiceQuotaSnapshot => entry !== null);
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

function findLatestCodexJsonl(root: string, lookbackDays: number): string | null {
  const cutoffMs = Date.now() - lookbackDays * 86400 * 1000;
  let bestPath: string | null = null;
  let bestMtime = 0;

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
        if (stat.mtimeMs > bestMtime) {
          bestMtime = stat.mtimeMs;
          bestPath = full;
        }
      }
    }
  };

  walk(root);
  return bestPath;
}

async function readLatestCodexRateLimits(path: string): Promise<CodexRateLimitsObservation | null> {
  const handle = await open(path, "r");
  try {
    const rl = createInterface({ input: handle.createReadStream({ encoding: "utf8" }) });
    let latest: CodexRateLimitsObservation | null = null;
    for await (const line of rl) {
      if (!line.includes("\"rate_limits\"")) continue;
      try {
        const record = JSON.parse(line) as {
          timestamp?: unknown;
          ts?: unknown;
          payload?: { rate_limits?: CodexRateLimitsPayload };
        };
        const limits = record.payload?.rate_limits;
        if (limits && (limits.primary || limits.secondary)) {
          latest = {
            limits,
            capturedAt: timestampMs(record.timestamp) ?? timestampMs(record.ts) ?? Date.now(),
          };
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

type ServiceQuotaSnapshot = {
  provider?: string | null;
  harness?: string | null;
  transport?: string | null;
  label: string;
  windowKind?: string | null;
  usedPercent?: number | null;
  percentRemaining?: number | null;
  used?: number | null;
  limitValue?: number | null;
  resetAt?: number | null;
  windowMs?: number | null;
  capturedAt: number;
  metadata?: Record<string, unknown>;
};

type StoredQuotaWindowRow = ServiceQuotaSnapshot & {
  metadataJson: string | null;
};

async function loadClaudeGauge(): Promise<ServiceGauge | null> {
  const statusline = loadClaudeStatuslineGauge();
  if (statusline) return statusline;

  return loadPersistedProviderQuotaGauge({
    id: "claude",
    label: "claude",
    provider: "anthropic",
    harness: "claude",
    maxAgeMs: WEEK_MS,
  });
}

type ClaudeStatuslineSnapshot = Record<string, unknown>;

function loadClaudeStatuslineGauge(): ServiceGauge | null {
  const snapshots = loadClaudeStatuslineQuotaSnapshots();
  if (snapshots.length > 0) {
    persistQuotaSnapshots([...snapshots].sort((a, b) => a.capturedAt - b.capturedAt));
    const persisted = loadPersistedProviderQuotaGauge({
      id: "claude",
      label: "claude",
      provider: "anthropic",
      harness: "claude",
      maxAgeMs: WEEK_MS,
    });
    if (persisted) return persisted;

    const direct = quotaGaugeFromSnapshots({
      id: "claude",
      label: "claude",
      maxCurrentAgeMs: WEEK_MS,
    }, snapshots);
    if (direct) return direct;

    const stale = quotaGaugeFromSnapshots({
      id: "claude",
      label: "claude",
      maxCurrentAgeMs: WEEK_MS,
      allowExpiredWindows: true,
    }, snapshots);
    if (stale) return stale;
  }

  return null;
}

function claudeStatuslineDir(): string {
  return resolveClaudeStatuslineDirectory();
}

function readClaudeStatuslineLatest(): ClaudeStatuslineSnapshot | null {
  return readJsonRecord(join(claudeStatuslineDir(), "claude-latest.json"));
}

function loadClaudeStatuslineQuotaSnapshots(): ServiceQuotaSnapshot[] {
  const now = Date.now();
  const latest = readClaudeStatuslineLatest();
  const history = readClaudeStatuslineHistory(now - QUOTA_HISTORY_LOOKBACK_MS);
  return [
    ...(latest ? [latest] : []),
    ...history,
  ]
    .flatMap((record) => claudeQuotaSnapshotsFromStatusline(record))
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .slice(0, PERSISTED_QUOTA_ROW_LIMIT);
}

function readClaudeStatuslineHistory(minCapturedAt: number): ClaudeStatuslineSnapshot[] {
  const path = join(claudeStatuslineDir(), "claude-history.jsonl");
  const stat = safeStat(path);
  if (!stat) return [];

  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }

  if (stat.size > CLAUDE_STATUSLINE_HISTORY_MAX_BYTES) {
    content = content.slice(-CLAUDE_STATUSLINE_HISTORY_MAX_BYTES);
    const firstNewline = content.indexOf("\n");
    if (firstNewline >= 0) {
      content = content.slice(firstNewline + 1);
    }
  }

  const out: ClaudeStatuslineSnapshot[] = [];
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const record = parseJsonRecord(trimmed);
    if (!record) continue;
    if (claudeStatuslineCapturedAt(record) < minCapturedAt) continue;
    out.push(record);
  }
  return out;
}

function claudeQuotaSnapshotsFromStatusline(record: ClaudeStatuslineSnapshot): ServiceQuotaSnapshot[] {
  const rateLimits = recordValue(record.rate_limits);
  if (!rateLimits) return [];

  const capturedAt = claudeStatuslineCapturedAt(record);
  return [
    claudeQuotaSnapshotFromStatuslineWindow(record, rateLimits.five_hour, {
      label: "5h",
      windowKind: "primary",
      windowMs: 5 * 3600 * 1000,
      capturedAt,
    }),
    claudeQuotaSnapshotFromStatuslineWindow(record, rateLimits.seven_day, {
      label: "7d",
      windowKind: "secondary",
      windowMs: WEEK_MS,
      capturedAt,
    }),
  ].filter((entry): entry is ServiceQuotaSnapshot => entry !== null);
}

function claudeQuotaSnapshotFromStatuslineWindow(
  record: ClaudeStatuslineSnapshot,
  value: unknown,
  options: {
    label: string;
    windowKind: string;
    windowMs: number;
    capturedAt: number;
  },
): ServiceQuotaSnapshot | null {
  const window = recordValue(value);
  if (!window) return null;

  const usedPercent = numericValue(window.used_percentage)
    ?? numericValue(window.usedPercent)
    ?? numericValue(window.used_percent);
  const percentRemaining = numericValue(window.remaining_percentage)
    ?? numericValue(window.remainingPercent)
    ?? numericValue(window.percent_remaining)
    ?? (usedPercent === undefined ? undefined : Math.max(0, 100 - usedPercent));
  if (usedPercent === undefined && percentRemaining === undefined) return null;

  const resetAt = timestampMs(window.resets_at)
    ?? timestampMs(window.reset_at)
    ?? timestampMs(window.resetAt)
    ?? options.capturedAt + options.windowMs;

  return {
    provider: "anthropic",
    harness: "claude",
    transport: "claude_statusline",
    label: options.label,
    windowKind: options.windowKind,
    usedPercent,
    percentRemaining,
    resetAt,
    windowMs: options.windowMs,
    capturedAt: options.capturedAt,
    metadata: {
      source: "service-budgets.claude-statusline",
      sessionId: stringValue(record.session_id),
      cwd: stringValue(record.cwd),
      model: claudeStatuslineModel(record),
    },
  };
}

function claudeStatuslineCapturedAt(record: ClaudeStatuslineSnapshot): number {
  return timestampMs(record.openscoutCapturedAt)
    ?? timestampMs(record.capturedAt)
    ?? timestampMs(record.timestamp)
    ?? Date.now();
}

function claudeStatuslineModel(record: ClaudeStatuslineSnapshot): string | undefined {
  const model = recordValue(record.model);
  return stringValue(model?.id)
    ?? stringValue(model?.display_name);
}

function loadPersistedProviderQuotaGauge(input: {
  id: string;
  label: string;
  provider: string;
  harness: string;
  maxAgeMs: number;
}): ServiceGauge | null {
  return quotaGaugeFromSnapshots({
    id: input.id,
    label: input.label,
    maxCurrentAgeMs: input.maxAgeMs,
  }, loadPersistedProviderQuotaSnapshots(input));
}

function loadPersistedProviderQuotaSnapshots(input: {
  provider: string;
  harness: string;
  maxAgeMs: number;
}): ServiceQuotaSnapshot[] {
  let rows: StoredQuotaWindowRow[];
  try {
    const now = Date.now();
    const lookbackMs = Math.max(input.maxAgeMs, QUOTA_HISTORY_LOOKBACK_MS);
    rows = db().query(
      `SELECT
        provider,
        harness,
        transport,
        label,
        window_kind AS windowKind,
        used_percent AS usedPercent,
        percent_remaining AS percentRemaining,
        used,
        limit_value AS limitValue,
        reset_at AS resetAt,
        window_ms AS windowMs,
        captured_at AS capturedAt,
        metadata_json AS metadataJson
      FROM budget_quota_window_snapshots
      WHERE source = 'provider_reported'
        AND captured_at >= ?1
        AND (provider = ?2 OR harness = ?3)
      ORDER BY captured_at DESC, created_at DESC
      LIMIT ?4`,
    ).all(now - lookbackMs, input.provider, input.harness, PERSISTED_QUOTA_ROW_LIMIT) as StoredQuotaWindowRow[];
  } catch {
    return [];
  }

  return rows.map((row) => ({
    ...row,
    metadata: parseMetadataJson(row.metadataJson),
  }));
}

function quotaGaugeFromSnapshots(input: {
  id: string;
  label: string;
  maxCurrentAgeMs?: number;
  allowExpiredWindows?: boolean;
}, snapshots: ServiceQuotaSnapshot[]): ServiceGauge | null {
  const latestByWindow = new Map<string, ServiceQuotaSnapshot>();
  const historyByWindow = quotaHistoryByWindow(snapshots);
  const now = Date.now();
  const minCurrentCapturedAt = input.maxCurrentAgeMs === undefined
    ? Number.NEGATIVE_INFINITY
    : now - input.maxCurrentAgeMs;

  for (const row of snapshots) {
    if (row.capturedAt < minCurrentCapturedAt) continue;
    if (!input.allowExpiredWindows && quotaSnapshotIsExpired(row, now)) continue;
    const key = quotaSnapshotWindowKey(row);
    if (!latestByWindow.has(key)) {
      latestByWindow.set(key, row);
    }
  }

  const windows = [...latestByWindow.values()]
    .map((snapshot) => storedQuotaWindowGauge(snapshot, historyByWindow.get(quotaSnapshotWindowKey(snapshot)) ?? []))
    .filter((window): window is ServiceQuotaWindowGauge => Boolean(window))
    .sort((a, b) => quotaWindowSortRank(a.label) - quotaWindowSortRank(b.label) || a.label.localeCompare(b.label));
  if (windows.length === 0) return null;

  const displayWindow =
    windows.find((window) => window.label === "7d") ??
    windows[windows.length - 1]!;
  const fill = Math.max(...windows.map((window) => window.fill));

  return {
    id: input.id,
    label: input.label,
    kind: "quota",
    fill,
    usedLabel: displayWindow.usedLabel,
    capLabel: displayWindow.capLabel,
    unitLabel: displayWindow.label,
    resetAt: displayWindow.resetAt,
    windows,
  };
}

function quotaHistoryByWindow(snapshots: ServiceQuotaSnapshot[]): Map<string, ServiceQuotaHistoryPoint[]> {
  const bucketsByWindow = new Map<string, Map<number, ServiceQuotaHistoryPoint>>();
  const minCapturedAt = Date.now() - QUOTA_HISTORY_LOOKBACK_MS;

  for (const row of snapshots) {
    if (row.capturedAt < minCapturedAt) continue;
    const usage = quotaSnapshotUsage(row);
    if (!usage) continue;

    const key = quotaSnapshotWindowKey(row);
    const bucket = Math.floor(row.capturedAt / QUOTA_HISTORY_BUCKET_MS);
    let buckets = bucketsByWindow.get(key);
    if (!buckets) {
      buckets = new Map();
      bucketsByWindow.set(key, buckets);
    }

    const resetAt = finiteNumber(row.resetAt);
    const point: ServiceQuotaHistoryPoint = {
      capturedAt: row.capturedAt,
      fill: usage.fill,
      usedLabel: usage.usedLabel,
      ...(resetAt === undefined ? {} : { resetAt }),
    };
    const existing = buckets.get(bucket);
    if (!existing || point.capturedAt >= existing.capturedAt) {
      buckets.set(bucket, point);
    }
  }

  const out = new Map<string, ServiceQuotaHistoryPoint[]>();
  for (const [key, buckets] of bucketsByWindow) {
    out.set(
      key,
      [...buckets.values()]
        .sort((a, b) => a.capturedAt - b.capturedAt)
        .slice(-Math.ceil(QUOTA_HISTORY_LOOKBACK_MS / QUOTA_HISTORY_BUCKET_MS)),
    );
  }
  return out;
}

function quotaSnapshotWindowKey(row: ServiceQuotaSnapshot): string {
  return row.windowKind ?? row.label;
}

function quotaSnapshotIsExpired(row: ServiceQuotaSnapshot, now: number): boolean {
  const resetAt = finiteNumber(row.resetAt);
  return resetAt !== undefined && resetAt <= now;
}

function quotaSnapshotUsage(row: ServiceQuotaSnapshot): {
  fill: number;
  usedLabel: string;
  capLabel: string;
  unitLabel: string;
} | null {
  const remainingPercent = finiteNumber(row.percentRemaining);
  const usedPercent = finiteNumber(row.usedPercent)
    ?? (remainingPercent === undefined ? undefined : 100 - remainingPercent)
    ?? deriveUsedPercent(row.used, row.limitValue);
  const percentRemaining = remainingPercent
    ?? (usedPercent === undefined ? undefined : Math.max(0, 100 - usedPercent));

  if (usedPercent === undefined && percentRemaining === undefined) return null;

  const fill = Math.max(0, Math.min(1, (usedPercent ?? 100 - percentRemaining!) / 100));
  const used = finiteNumber(row.used);
  const limit = finiteNumber(row.limitValue);

  return {
    fill,
    usedLabel: used === undefined ? `${Math.round(fill * 100)}%` : formatRequestCount(used),
    capLabel: limit === undefined ? "100%" : formatRequestCount(limit),
    unitLabel: used === undefined || limit === undefined ? "quota" : "req",
  };
}

function storedQuotaWindowGauge(
  row: ServiceQuotaSnapshot,
  history: ServiceQuotaHistoryPoint[] = [],
): ServiceQuotaWindowGauge | null {
  const usage = quotaSnapshotUsage(row);
  if (!usage) return null;
  const windowMs = finiteNumber(row.windowMs);
  const resetAt = finiteNumber(row.resetAt)
    ?? (windowMs === undefined ? undefined : row.capturedAt + windowMs)
    ?? Date.now();

  return {
    label: formatStoredQuotaWindowLabel(row),
    ...usage,
    resetAt,
    ...(history.length === 0 ? {} : { history }),
  };
}

function deriveUsedPercent(used: number | null | undefined, limit: number | null | undefined): number | undefined {
  const usedValue = finiteNumber(used);
  const limitValue = finiteNumber(limit);
  if (usedValue === undefined || limitValue === undefined || limitValue <= 0) return undefined;
  return (usedValue / limitValue) * 100;
}

function finiteNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatStoredQuotaWindowLabel(row: ServiceQuotaSnapshot): string {
  const explicitDuration = row.label.trim();
  if (/^\d+(?:\.\d+)?[mhd]$/iu.test(explicitDuration)) return explicitDuration;

  const fromDuration = formatWindowMs(finiteNumber(row.windowMs));
  if (fromDuration) return fromDuration;

  const label = explicitDuration.toLowerCase();
  if (label === "weekly" || label === "week" || row.windowKind === "secondary") return "7d";
  if (label === "primary" || row.windowKind === "primary") return "5h";
  return row.label;
}

function formatWindowMs(windowMs: number | undefined): string | null {
  if (windowMs === undefined || windowMs <= 0) return null;
  const minutes = Math.round(windowMs / 60_000);
  return formatQuotaWindowLabel(minutes, minutes >= 24 * 60 ? "secondary" : "primary");
}

function quotaWindowSortRank(label: string): number {
  if (label === "5h") return 0;
  if (label === "7d") return 1;
  return 2;
}

/* ── github ─────────────────────────────────────────────────────────── */

type GhRateLimitResponse = {
  resources?: {
    core?: { limit?: number; remaining?: number; reset?: number };
  };
};

async function loadGithubGauge(forceRefresh = false): Promise<ServiceGauge | null> {
  if (!forceRefresh) {
    const persisted = loadPersistedProviderQuotaGauge({
      id: "github",
      label: "github",
      provider: "github",
      harness: "github",
      maxAgeMs: 15 * 60 * 1000,
    });
    if (persisted) return persisted;
  }

  let stdout: string;
  const fixtureJson = process.env[GH_RATE_LIMIT_JSON_ENV];
  if (fixtureJson?.trim()) {
    stdout = fixtureJson;
  } else {
    try {
      const ghBin = process.env[GH_CLI_BIN_ENV] || "gh";
      const result = await execFileAsync(ghBin, ["api", "rate_limit"], {
        env: { ...process.env },
        timeout: GH_CLI_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
      });
      stdout = result.stdout;
    } catch (error) {
      debugServiceBudgetProvider("github", "gh api failed", error);
      return null;
    }
  }

  let parsed: GhRateLimitResponse;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    debugServiceBudgetProvider("github", "gh api returned invalid json", { error, stdout });
    return null;
  }

  const core = parsed.resources?.core;
  if (!core || typeof core.limit !== "number" || typeof core.remaining !== "number") {
    debugServiceBudgetProvider("github", "gh api missing core rate limit", parsed);
    return null;
  }

  const snapshot = githubQuotaSnapshot(core, Date.now());
  if (!snapshot) {
    debugServiceBudgetProvider("github", "core rate limit could not become a snapshot", core);
    return null;
  }

  persistQuotaSnapshots([snapshot]);
  const persisted = loadPersistedProviderQuotaGauge({
    id: "github",
    label: "github",
    provider: "github",
    harness: "github",
    maxAgeMs: 15 * 60 * 1000,
  });
  if (persisted) return persisted;
  return quotaGaugeFromSnapshots({
    id: "github",
    label: "github",
  }, [snapshot]);
}

function githubQuotaSnapshot(
  core: NonNullable<NonNullable<GhRateLimitResponse["resources"]>["core"]>,
  capturedAt: number,
): ServiceQuotaSnapshot | null {
  if (typeof core.limit !== "number" || typeof core.remaining !== "number") {
    return null;
  }
  const limit = core.limit;
  const used = Math.max(0, limit - core.remaining);
  const resetAt = timestampMs(core.reset) ?? capturedAt + 3600 * 1000;

  return {
    provider: "github",
    harness: "github",
    transport: "gh_cli",
    label: "1h",
    windowKind: "primary",
    usedPercent: limit > 0 ? (used / limit) * 100 : undefined,
    percentRemaining: limit > 0 ? (core.remaining / limit) * 100 : undefined,
    used,
    limitValue: limit,
    resetAt,
    windowMs: Math.max(0, resetAt - capturedAt),
    capturedAt,
    metadata: {
      source: "service-budgets.gh-rate-limit",
      resource: "core",
      unitLabel: "req",
    },
  };
}

function formatRequestCount(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/* ── shared ─────────────────────────────────────────────────────────── */

function quotaDb(): Database {
  if (!quotaWriteDb) {
    quotaWriteDb = new Database(resolveDbPath(), { create: true });
    quotaWriteDb.exec(`PRAGMA busy_timeout = ${DB_BUSY_TIMEOUT_MS};`);
    quotaWriteDb.exec("PRAGMA journal_mode = WAL;");
    quotaWriteDb.exec("PRAGMA synchronous = NORMAL;");
  }
  return quotaWriteDb;
}

function persistQuotaSnapshots(snapshots: ServiceQuotaSnapshot[]): void {
  if (snapshots.length === 0) return;

  try {
    const writer = quotaDb();
    const statement = writer.query(
      `INSERT INTO budget_quota_window_snapshots (
        id, source, provider, harness, transport, model, agent_id, endpoint_id,
        session_id, user_id, account_id, plan_type, label, window_kind,
        used_percent, percent_remaining, used, limit_value, reset_at, window_ms,
        captured_at, metadata_json, created_at
      ) VALUES (
        ?1, 'provider_reported', ?2, ?3, ?4, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, ?5, ?6,
        ?7, ?8, ?9, ?10, ?11, ?12,
        ?13, ?14, ?15
      )
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source,
        provider = excluded.provider,
        harness = excluded.harness,
        transport = excluded.transport,
        label = excluded.label,
        window_kind = excluded.window_kind,
        used_percent = excluded.used_percent,
        percent_remaining = excluded.percent_remaining,
        used = excluded.used,
        limit_value = excluded.limit_value,
        reset_at = excluded.reset_at,
        window_ms = excluded.window_ms,
        captured_at = excluded.captured_at,
        metadata_json = excluded.metadata_json,
        created_at = excluded.created_at`,
    );
    const pruneHistory = writer.query(
      `DELETE FROM budget_quota_window_snapshots
      WHERE id LIKE '${QUOTA_HISTORY_ID_PREFIX}%'
        AND captured_at < ?1`,
    );

    const createdAt = Date.now();
    const writeSnapshot = (
      id: string,
      snapshot: ServiceQuotaSnapshot,
      metadata: Record<string, unknown> | undefined,
    ): void => {
      statement.run(
        id,
        snapshot.provider ?? null,
        snapshot.harness ?? null,
        snapshot.transport ?? null,
        snapshot.label,
        snapshot.windowKind ?? null,
        finiteNumber(snapshot.usedPercent) ?? null,
        finiteNumber(snapshot.percentRemaining) ?? null,
        finiteNumber(snapshot.used) ?? null,
        finiteNumber(snapshot.limitValue) ?? null,
        finiteNumber(snapshot.resetAt) ?? null,
        finiteNumber(snapshot.windowMs) ?? null,
        snapshot.capturedAt,
        JSON.stringify(metadata ?? {}),
        createdAt,
      );
    };

    for (const snapshot of snapshots) {
      writeSnapshot(quotaSnapshotId(snapshot), snapshot, snapshot.metadata);
      writeSnapshot(quotaHistorySnapshotId(snapshot), snapshot, quotaHistoryMetadata(snapshot));
    }
    pruneHistory.run(createdAt - QUOTA_HISTORY_LOOKBACK_MS - QUOTA_HISTORY_BUCKET_MS);
  } catch {
    // Quota harvesting is best-effort. If the broker has not created the
    // control-plane schema yet, the direct readers still return a UI gauge.
  }
}

function quotaSnapshotId(snapshot: ServiceQuotaSnapshot): string {
  return `budget:quota:${stableHash([
    "service-budgets",
    snapshot.provider ?? "",
    snapshot.harness ?? "",
    snapshot.windowKind ?? snapshot.label,
  ])}`;
}

function quotaHistorySnapshotId(snapshot: ServiceQuotaSnapshot): string {
  return `${QUOTA_HISTORY_ID_PREFIX}${stableHash([
    "service-budgets",
    "history",
    snapshot.provider ?? "",
    snapshot.harness ?? "",
    snapshot.windowKind ?? snapshot.label,
    Math.floor(snapshot.capturedAt / QUOTA_HISTORY_BUCKET_MS),
  ])}`;
}

function quotaHistoryMetadata(snapshot: ServiceQuotaSnapshot): Record<string, unknown> {
  const bucket = Math.floor(snapshot.capturedAt / QUOTA_HISTORY_BUCKET_MS);
  return {
    ...(snapshot.metadata ?? {}),
    historyBucketMs: QUOTA_HISTORY_BUCKET_MS,
    historyBucketStartAt: bucket * QUOTA_HISTORY_BUCKET_MS,
  };
}

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

function timestampMs(value: unknown): number | undefined {
  const normalized = epochMs(value);
  if (normalized !== null) return normalized;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(/%$/u, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return recordValue(JSON.parse(value)) ?? null;
  } catch {
    return null;
  }
}

function readJsonRecord(path: string): Record<string, unknown> | null {
  try {
    return parseJsonRecord(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function parseMetadataJson(value: string | null | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function homeDir(): string {
  return process.env.HOME?.trim() || homedir();
}

function safeStat(path: string): { mtimeMs: number; size: number } | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
