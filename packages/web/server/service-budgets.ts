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
import { existsSync, readdirSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const CODEX_LOOKBACK_DAYS = 3;
const GH_CLI_TIMEOUT_MS = 4000;

type GaugeTone = "ok" | "warn" | "err" | "dim";

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
    }
  | {
      id: string;
      label: string;
      kind: "status";
      statusLabel: string;
      tone: GaugeTone;
    };

export type ServiceBudgetsResponse = {
  generatedAt: number;
  gauges: ServiceGauge[];
};

let cached: { value: ServiceBudgetsResponse; expiresAt: number } | null = null;
let inflight: Promise<ServiceBudgetsResponse> | null = null;

export async function loadServiceBudgets(): Promise<ServiceBudgetsResponse> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
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

async function loadCodexGauge(): Promise<ServiceGauge | null> {
  const root = join(homedir(), ".codex", "sessions");
  if (!existsSync(root)) return null;

  const latest = findLatestCodexJsonl(root, CODEX_LOOKBACK_DAYS);
  if (!latest) return null;

  const limits = await readLatestCodexRateLimits(latest);
  if (!limits) return null;

  // Prefer secondary (weekly, 10080 min). Fall back to primary if absent.
  const window = limits.secondary ?? limits.primary;
  if (!window || typeof window.used_percent !== "number") return null;

  const fill = Math.max(0, Math.min(1, window.used_percent / 100));
  const resetAt = typeof window.resets_at === "number" && Number.isFinite(window.resets_at)
    ? window.resets_at * 1000
    : Date.now() + WEEK_MS;
  const pct = Math.round(window.used_percent);
  return {
    id: "codex",
    label: "codex",
    kind: "quota",
    fill,
    usedLabel: `${pct}%`,
    capLabel: "100%",
    unitLabel: window.window_minutes && window.window_minutes >= 10080 ? "weekly" : "window",
    resetAt,
  };
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

async function readLatestCodexRateLimits(path: string): Promise<CodexRateLimitsPayload | null> {
  const handle = await open(path, "r");
  try {
    const rl = createInterface({ input: handle.createReadStream({ encoding: "utf8" }) });
    let latest: CodexRateLimitsPayload | null = null;
    for await (const line of rl) {
      if (!line.includes("\"rate_limits\"")) continue;
      try {
        const record = JSON.parse(line) as { payload?: { rate_limits?: CodexRateLimitsPayload } };
        const limits = record.payload?.rate_limits;
        if (limits && (limits.primary || limits.secondary)) {
          latest = limits;
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
  const root = join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return null;

  const since = Date.now() - WEEK_MS;
  let totalTokens = 0;
  let scanned = 0;

  const files = listClaudeProjectJsonl(root, since);
  for (const file of files) {
    try {
      totalTokens += await sumClaudeTokensSince(file, since);
      scanned++;
    } catch {
      // ignore unreadable file
    }
  }

  if (scanned === 0 || totalTokens === 0) return null;

  return {
    id: "claude",
    label: "claude",
    kind: "status",
    statusLabel: `${formatTokenCount(totalTokens)} · 7d`,
    tone: "ok",
  };
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

async function sumClaudeTokensSince(path: string, sinceMs: number): Promise<number> {
  const handle = await open(path, "r");
  try {
    const rl = createInterface({ input: handle.createReadStream({ encoding: "utf8" }) });
    let sum = 0;
    for await (const line of rl) {
      if (!line.includes("\"usage\"")) continue;
      try {
        const record = JSON.parse(line) as {
          timestamp?: string;
          message?: { role?: string; usage?: Record<string, unknown> };
        };
        const usage = record.message?.usage;
        if (!usage) continue;
        const ts = record.timestamp ? Date.parse(record.timestamp) : NaN;
        if (Number.isFinite(ts) && ts < sinceMs) continue;
        const input = numberish(usage.input_tokens);
        const output = numberish(usage.output_tokens);
        sum += input + output;
      } catch {
        // skip malformed
      }
    }
    return sum;
  } finally {
    await handle.close();
  }
}

function numberish(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function formatTokenCount(n: number): string {
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
