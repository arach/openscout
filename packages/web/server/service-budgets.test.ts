import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  clearServiceBudgetsCache,
  loadServiceBudgets,
  type ServiceGauge,
} from "./service-budgets.ts";

const originalHome = process.env.HOME;
const originalPath = process.env.PATH;
const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalClaudeProjectsRoot = process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT;
const originalTailClaudeProjectsRoot = process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT;
const originalClaudeStatuslineLatest = process.env.OPENSCOUT_CLAUDE_STATUSLINE_LATEST;
const originalCodexSessionsRoot = process.env.OPENSCOUT_CODEX_SESSIONS_ROOT;
const originalTailCodexSessionsRoot = process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT;

const testRoots = new Set<string>();

function makeTestRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "openscout-service-budgets-"));
  testRoots.add(root);
  return root;
}

function writeClaudeJsonl(projectsRoot: string, lines: Array<Record<string, unknown>>): void {
  const projectDir = join(projectsRoot, "project-a");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, "session.jsonl"),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );
}

function writeCodexJsonl(home: string, relativePath: string, lines: Array<Record<string, unknown>>): string {
  const root = process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT ?? join(home, ".codex", "sessions");
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );
  return path;
}

function codexQuotaGauge(gauges: ServiceGauge[]): Extract<ServiceGauge, { id: string; kind: "quota" }> {
  const gauge = gauges.find((candidate) => candidate.id === "codex");
  expect(gauge).toBeTruthy();
  expect(gauge?.kind).toBe("quota");
  return gauge as Extract<ServiceGauge, { id: string; kind: "quota" }>;
}

function claudeGauge(gauges: ServiceGauge[]): Extract<ServiceGauge, { id: string; kind: "status" }> {
  const gauge = gauges.find((candidate) => candidate.id === "claude");
  expect(gauge).toBeTruthy();
  expect(gauge?.kind).toBe("status");
  return gauge as Extract<ServiceGauge, { id: string; kind: "status" }>;
}

function claudeQuotaGauge(gauges: ServiceGauge[]): Extract<ServiceGauge, { id: string; kind: "quota" }> {
  const gauge = gauges.find((candidate) => candidate.id === "claude");
  expect(gauge).toBeTruthy();
  expect(gauge?.kind).toBe("quota");
  return gauge as Extract<ServiceGauge, { id: string; kind: "quota" }>;
}

beforeEach(() => {
  clearServiceBudgetsCache();
  const home = makeTestRoot();
  const supportDirectory = join(home, "Library", "Application Support", "OpenScout");
  const controlHome = join(home, ".openscout", "control-plane");
  const emptyPath = join(home, "bin");
  mkdirSync(supportDirectory, { recursive: true });
  mkdirSync(controlHome, { recursive: true });
  mkdirSync(emptyPath, { recursive: true });
  process.env.HOME = home;
  process.env.PATH = emptyPath;
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = supportDirectory;
  process.env.OPENSCOUT_CONTROL_HOME = controlHome;
  process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT = join(home, ".codex", "sessions");
  delete process.env.OPENSCOUT_CODEX_SESSIONS_ROOT;
  delete process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT;
  delete process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT;
  delete process.env.OPENSCOUT_CLAUDE_STATUSLINE_LATEST;
});

afterEach(() => {
  clearServiceBudgetsCache();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalSupportDirectory === undefined) delete process.env.OPENSCOUT_SUPPORT_DIRECTORY;
  else process.env.OPENSCOUT_SUPPORT_DIRECTORY = originalSupportDirectory;
  if (originalControlHome === undefined) delete process.env.OPENSCOUT_CONTROL_HOME;
  else process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  if (originalClaudeProjectsRoot === undefined) delete process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT;
  else process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT = originalClaudeProjectsRoot;
  if (originalTailClaudeProjectsRoot === undefined) delete process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT;
  else process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT = originalTailClaudeProjectsRoot;
  if (originalClaudeStatuslineLatest === undefined) delete process.env.OPENSCOUT_CLAUDE_STATUSLINE_LATEST;
  else process.env.OPENSCOUT_CLAUDE_STATUSLINE_LATEST = originalClaudeStatuslineLatest;
  if (originalCodexSessionsRoot === undefined) delete process.env.OPENSCOUT_CODEX_SESSIONS_ROOT;
  else process.env.OPENSCOUT_CODEX_SESSIONS_ROOT = originalCodexSessionsRoot;
  if (originalTailCodexSessionsRoot === undefined) delete process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT;
  else process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT = originalTailCodexSessionsRoot;
  for (const root of testRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  testRoots.clear();
});

describe("service budgets", () => {
  test("prefers a fresh named Codex bucket over nearby generic snapshots", async () => {
    const home = process.env.HOME!;
    const now = Date.now();
    const staleTouchedFile = writeCodexJsonl(home, "2026/06/06/stale-touch.jsonl", [
      {
        timestamp: new Date(now - 1_000).toISOString(),
        payload: {
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: 18,
              window_minutes: 300,
              resets_at: Math.floor((now + 5 * 3600 * 1000) / 1000),
            },
            secondary: {
              used_percent: 36,
              window_minutes: 7 * 24 * 60,
              resets_at: Math.floor((now + 7 * 24 * 3600 * 1000) / 1000),
            },
          },
        },
      },
    ]);
    const newestEventFile = writeCodexJsonl(home, "2026/06/05/newest-event.jsonl", [
      {
        timestamp: new Date(now - 5_000).toISOString(),
        payload: {
          rate_limits: {
            limit_id: "codex_bengalfox",
            limit_name: "GPT-5.3-Codex-Spark",
            primary: {
              used_percent: 0,
              window_minutes: 300,
              resets_at: Math.floor((now + 5 * 3600 * 1000) / 1000),
            },
            secondary: {
              used_percent: 0,
              window_minutes: 7 * 24 * 60,
              resets_at: Math.floor((now + 7 * 24 * 3600 * 1000) / 1000),
            },
          },
        },
      },
    ]);
    utimesSync(staleTouchedFile, new Date(now), new Date(now));
    utimesSync(newestEventFile, new Date(now - 10 * 60_000), new Date(now - 10 * 60_000));

    const result = await loadServiceBudgets({ forceRefresh: true });
    const gauge = codexQuotaGauge(result.gauges);

    expect(gauge.fill).toBe(0);
    expect(gauge.windows?.map((window) => window.label)).toEqual(["5h", "7d"]);
    expect(gauge.windows?.map((window) => window.usedLabel)).toEqual(["0%", "0%"]);
    expect(gauge.unitLabel).toBe("7d");
  });

  test("uses newest generic Codex snapshot when named buckets are stale", async () => {
    const home = process.env.HOME!;
    const now = Date.now();
    const genericFile = writeCodexJsonl(home, "2026/06/06/generic-current.jsonl", [
      {
        timestamp: new Date(now - 1_000).toISOString(),
        payload: {
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: 18,
              window_minutes: 300,
              resets_at: Math.floor((now + 5 * 3600 * 1000) / 1000),
            },
            secondary: {
              used_percent: 36,
              window_minutes: 7 * 24 * 60,
              resets_at: Math.floor((now + 7 * 24 * 3600 * 1000) / 1000),
            },
          },
        },
      },
    ]);
    const staleNamedFile = writeCodexJsonl(home, "2026/06/05/named-stale.jsonl", [
      {
        timestamp: new Date(now - 30 * 60_000).toISOString(),
        payload: {
          rate_limits: {
            limit_id: "codex_bengalfox",
            limit_name: "GPT-5.3-Codex-Spark",
            primary: {
              used_percent: 0,
              window_minutes: 300,
              resets_at: Math.floor((now + 5 * 3600 * 1000) / 1000),
            },
            secondary: {
              used_percent: 0,
              window_minutes: 7 * 24 * 60,
              resets_at: Math.floor((now + 7 * 24 * 3600 * 1000) / 1000),
            },
          },
        },
      },
    ]);
    utimesSync(genericFile, new Date(now), new Date(now));
    utimesSync(staleNamedFile, new Date(now - 30 * 60_000), new Date(now - 30 * 60_000));

    const result = await loadServiceBudgets({ forceRefresh: true });
    const gauge = codexQuotaGauge(result.gauges);

    expect(gauge.fill).toBe(0.36);
    expect(gauge.windows?.map((window) => window.usedLabel)).toEqual(["18%", "36%"]);
    expect(gauge.unitLabel).toBe("7d");
  });

  test("prefers fresh Claude statusline rate-limit windows", async () => {
    const latestPath = join(makeTestRoot(), "claude-latest.json");
    process.env.OPENSCOUT_CLAUDE_STATUSLINE_LATEST = latestPath;
    writeFileSync(latestPath, JSON.stringify({
      openscoutCapturedAt: Date.now(),
      context_window: {
        remaining_percentage: 76,
        total_input_tokens: 123456,
      },
      rate_limits: {
        five_hour: {
          used_percentage: 12.4,
          resets_at: Math.floor((Date.now() + 2 * 3600 * 1000) / 1000),
        },
        seven_day: {
          used_percentage: 45.2,
          resets_at: Math.floor((Date.now() + 5 * 24 * 3600 * 1000) / 1000),
        },
      },
    }), "utf8");

    const result = await loadServiceBudgets({ forceRefresh: true });
    const gauge = claudeQuotaGauge(result.gauges);

    expect(gauge.windows?.map((window) => window.label)).toEqual(["5h", "7d"]);
    expect(gauge.windows?.map((window) => window.usedLabel)).toEqual(["12%", "45%"]);
    expect(gauge.usedLabel).toBe("45%");
    expect(gauge.unitLabel).toBe("7d");
  });

  test("counts Claude history usage once per assistant message and includes cache tokens", async () => {
    const projectsRoot = join(makeTestRoot(), ".claude", "projects");
    process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT = projectsRoot;
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();

    writeClaudeJsonl(projectsRoot, [
      {
        timestamp: recent,
        type: "assistant",
        message: {
          id: "msg-1",
          role: "assistant",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 20,
          },
        },
      },
      {
        timestamp: recent,
        type: "assistant",
        message: {
          id: "msg-1",
          role: "assistant",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 20,
          },
        },
      },
      {
        timestamp: recent,
        type: "assistant",
        requestId: "request-2",
        message: {
          role: "assistant",
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
          },
        },
      },
      {
        timestamp: recent,
        type: "user",
        message: {
          role: "user",
          usage: {
            input_tokens: 999,
            output_tokens: 999,
          },
        },
      },
      {
        timestamp: old,
        type: "assistant",
        message: {
          id: "old-msg",
          role: "assistant",
          usage: {
            input_tokens: 999,
            output_tokens: 999,
          },
        },
      },
    ]);

    const result = await loadServiceBudgets({ forceRefresh: true });
    const gauge = claudeGauge(result.gauges);

    expect(gauge.statusLabel).toBe("145");
    expect(gauge.windowLabel).toBe("7d");
    expect(gauge.detailLabel).toBe("local logs");
  });

  test("prefers broker observe budget events when present", async () => {
    const projectsRoot = join(makeTestRoot(), ".claude", "projects");
    process.env.OPENSCOUT_CLAUDE_PROJECTS_ROOT = projectsRoot;
    writeClaudeJsonl(projectsRoot, [
      {
        timestamp: new Date().toISOString(),
        type: "assistant",
        message: {
          id: "local-msg",
          role: "assistant",
          usage: {
            input_tokens: 10,
            output_tokens: 1,
          },
        },
      },
    ]);

    const dbPath = join(process.env.OPENSCOUT_CONTROL_HOME!, "control-plane.sqlite");
    const db = new Database(dbPath, { create: true });
    try {
      db.exec(`
        CREATE TABLE budget_usage_events (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          source TEXT NOT NULL,
          provider TEXT,
          harness TEXT,
          occurred_at INTEGER NOT NULL,
          input_tokens INTEGER,
          output_tokens INTEGER,
          reasoning_output_tokens INTEGER,
          cache_creation_input_tokens INTEGER,
          cache_read_input_tokens INTEGER,
          total_tokens INTEGER
        )
      `);
      db.query(`
        INSERT INTO budget_usage_events (
          id, scope, source, provider, harness, occurred_at,
          input_tokens, output_tokens, reasoning_output_tokens,
          cache_creation_input_tokens, cache_read_input_tokens, total_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "evt-1",
        "harness_execution",
        "provider_session_snapshot",
        "anthropic",
        "claude",
        Date.now(),
        1_000_000_000,
        25_000_000,
        null,
        50_000_000,
        100_000_000,
        999,
      );
    } finally {
      db.close();
    }

    const result = await loadServiceBudgets({ forceRefresh: true });
    const gauge = claudeGauge(result.gauges);

    expect(gauge.statusLabel).toBe("1.2B");
    expect(gauge.detailLabel).toBe("observe");
  });
});
