import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDb } from "./db/internal/db.ts";
import {
  loadServiceBudgets,
  resetServiceBudgetsCache,
} from "./service-budgets.ts";

const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalHome = process.env.HOME;
const originalPath = process.env.PATH;
const tempPaths = new Set<string>();

afterEach(() => {
  closeDb();
  resetServiceBudgetsCache();

  if (originalControlHome === undefined) {
    delete process.env.OPENSCOUT_CONTROL_HOME;
  } else {
    process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }

  for (const path of tempPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  tempPaths.clear();
});

function createQuotaTable(rawDb: Database): void {
  rawDb.exec(`
    CREATE TABLE budget_quota_window_snapshots (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      provider TEXT,
      harness TEXT,
      transport TEXT,
      model TEXT,
      agent_id TEXT,
      endpoint_id TEXT,
      session_id TEXT,
      user_id TEXT,
      account_id TEXT,
      plan_type TEXT,
      label TEXT NOT NULL,
      window_kind TEXT,
      used_percent REAL,
      percent_remaining REAL,
      used REAL,
      limit_value REAL,
      reset_at INTEGER,
      window_ms INTEGER,
      captured_at INTEGER NOT NULL,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );
  `);
}

describe("service budgets", () => {
  test("uses Claude statusline hook capture for quota windows", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-service-budgets-claude-statusline-"));
    tempPaths.add(root);
    const controlHome = join(root, "control-plane");
    const home = join(root, "home");
    process.env.OPENSCOUT_CONTROL_HOME = controlHome;
    process.env.HOME = home;
    process.env.PATH = "";
    mkdirSync(controlHome, { recursive: true });

    const rawDb = new Database(join(controlHome, "control-plane.sqlite"));
    createQuotaTable(rawDb);

    const statuslineDir = join(home, "Library", "Application Support", "OpenScout", "runtime", "statusline");
    mkdirSync(statuslineDir, { recursive: true });
    const now = Date.now();
    const latest = {
      session_id: "claude-statusline-session",
      cwd: "/repo",
      model: { id: "claude-opus-4-8[1m]", display_name: "Opus 4.8" },
      context_window: {
        total_input_tokens: 313_707,
        total_output_tokens: 755,
        used_percentage: 31,
        remaining_percentage: 69,
      },
      rate_limits: {
        five_hour: {
          used_percentage: 11,
          resets_at: Math.floor((now + 5 * 60 * 60 * 1000) / 1000),
        },
        seven_day: {
          used_percentage: 70,
          resets_at: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
        },
      },
      openscoutCapturedAt: now,
    };
    writeFileSync(join(statuslineDir, "claude-latest.json"), JSON.stringify(latest), "utf8");
    writeFileSync(join(statuslineDir, "claude-history.jsonl"), JSON.stringify({
      ...latest,
      rate_limits: {
        five_hour: { ...latest.rate_limits.five_hour, used_percentage: 9 },
        seven_day: { ...latest.rate_limits.seven_day, used_percentage: 68 },
      },
      openscoutCapturedAt: now - 60_000,
    }) + "\n", "utf8");

    const response = await loadServiceBudgets(true);
    const claude = response.gauges.find((gauge) => gauge.id === "claude");

    expect(claude).toEqual(expect.objectContaining({
      id: "claude",
      label: "claude",
      kind: "quota",
      usedLabel: "70%",
      capLabel: "100%",
      unitLabel: "7d",
    }));
    expect(claude && claude.kind === "quota" ? claude.windows : []).toEqual([
      expect.objectContaining({ label: "5h", usedLabel: "11%" }),
      expect.objectContaining({ label: "7d", usedLabel: "70%" }),
    ]);
    expect(rawDb.query<{ count: number }>(
      "SELECT count(*) AS count FROM budget_quota_window_snapshots WHERE provider = 'anthropic' AND harness = 'claude'",
    ).get()?.count).toBe(4);
    rawDb.close();
  });

  test("uses persisted Anthropic quota windows for the Claude gauge", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-service-budgets-"));
    tempPaths.add(controlHome);
    process.env.OPENSCOUT_CONTROL_HOME = controlHome;
    process.env.HOME = join(controlHome, "home");
    process.env.PATH = "";
    mkdirSync(controlHome, { recursive: true });

    const rawDb = new Database(join(controlHome, "control-plane.sqlite"));
    createQuotaTable(rawDb);
    const insert = rawDb.query(`
      INSERT INTO budget_quota_window_snapshots (
        id,
        source,
        provider,
        harness,
        transport,
        label,
        window_kind,
        used_percent,
        percent_remaining,
        used,
        limit_value,
        reset_at,
        window_ms,
        captured_at,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    insert.run(
      "claude-primary",
      "provider_reported",
      "anthropic",
      "claude",
      "claude_stream_json",
      "5h",
      "primary",
      32,
      68,
      null,
      null,
      now + 300 * 60 * 1000,
      300 * 60 * 1000,
      now,
      "{}",
      now,
    );
    insert.run(
      "claude-secondary",
      "provider_reported",
      "anthropic",
      "claude",
      "claude_stream_json",
      "weekly",
      "secondary",
      null,
      59,
      null,
      null,
      now + 7 * 24 * 60 * 60 * 1000,
      7 * 24 * 60 * 60 * 1000,
      now,
      "{}",
      now,
    );
    rawDb.close();

    const response = await loadServiceBudgets(true);
    const claude = response.gauges.find((gauge) => gauge.id === "claude");

    expect(claude).toEqual(expect.objectContaining({
      id: "claude",
      label: "claude",
      kind: "quota",
      usedLabel: "41%",
      capLabel: "100%",
      unitLabel: "7d",
    }));
    expect(claude && claude.kind === "quota" ? claude.windows : []).toEqual([
      expect.objectContaining({
        label: "5h",
        fill: 0.32,
        usedLabel: "32%",
        capLabel: "100%",
        unitLabel: "quota",
      }),
      expect.objectContaining({
        label: "7d",
        fill: 0.41,
        usedLabel: "41%",
        capLabel: "100%",
        unitLabel: "quota",
      }),
    ]);
  });

  test("harvests Codex rate limits into quota snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-service-budgets-codex-"));
    tempPaths.add(root);
    const controlHome = join(root, "control-plane");
    const home = join(root, "home");
    process.env.OPENSCOUT_CONTROL_HOME = controlHome;
    process.env.HOME = home;
    process.env.PATH = "";
    mkdirSync(controlHome, { recursive: true });

    const rawDb = new Database(join(controlHome, "control-plane.sqlite"));
    createQuotaTable(rawDb);

    const sessionDir = join(home, ".codex", "sessions", "2026", "06", "08");
    mkdirSync(sessionDir, { recursive: true });
    const now = Date.now();
    writeFileSync(join(sessionDir, "session.jsonl"), JSON.stringify({
      timestamp: new Date(now).toISOString(),
      payload: {
        rate_limits: {
          primary: {
            used_percent: 22,
            window_minutes: 300,
            resets_at: Math.floor((now + 300 * 60 * 1000) / 1000),
          },
          secondary: {
            used_percent: 44,
            window_minutes: 7 * 24 * 60,
            resets_at: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          },
        },
      },
    }) + "\n", "utf8");

    const response = await loadServiceBudgets(true);
    const codex = response.gauges.find((gauge) => gauge.id === "codex");

    expect(codex).toEqual(expect.objectContaining({
      id: "codex",
      kind: "quota",
      usedLabel: "44%",
      unitLabel: "7d",
    }));
    expect(codex && codex.kind === "quota" ? codex.windows : []).toEqual([
      expect.objectContaining({ label: "5h", usedLabel: "22%" }),
      expect.objectContaining({ label: "7d", usedLabel: "44%" }),
    ]);
    const codexWindows = codex && codex.kind === "quota" ? codex.windows ?? [] : [];
    expect(codexWindows[0]?.history?.length).toBeGreaterThanOrEqual(1);
    expect(rawDb.query<{ count: number }>(
      "SELECT count(*) AS count FROM budget_quota_window_snapshots WHERE provider = 'openai' AND harness = 'codex'",
    ).get()?.count).toBe(4);
    expect(rawDb.query<{ count: number }>(
      "SELECT count(*) AS count FROM budget_quota_window_snapshots WHERE id LIKE 'budget:quota:history:%' AND provider = 'openai' AND harness = 'codex'",
    ).get()?.count).toBe(2);
    rawDb.close();
  });

  test("harvests GitHub rate limits into quota snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-service-budgets-github-"));
    tempPaths.add(root);
    const controlHome = join(root, "control-plane");
    const home = join(root, "home");
    const bin = join(root, "bin");
    process.env.OPENSCOUT_CONTROL_HOME = controlHome;
    process.env.HOME = home;
    process.env.PATH = bin;
    mkdirSync(controlHome, { recursive: true });
    mkdirSync(bin, { recursive: true });

    const reset = Math.floor((Date.now() + 3600 * 1000) / 1000);
    const ghPath = join(bin, "gh");
    writeFileSync(ghPath, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({
      resources: {
        core: {
          limit: 5000,
          remaining: 4993,
          reset,
        },
      },
    })}'\n`, "utf8");
    chmodSync(ghPath, 0o755);

    const rawDb = new Database(join(controlHome, "control-plane.sqlite"));
    createQuotaTable(rawDb);

    const response = await loadServiceBudgets(true);
    const github = response.gauges.find((gauge) => gauge.id === "github");

    expect(github).toEqual(expect.objectContaining({
      id: "github",
      kind: "quota",
      usedLabel: "7",
      capLabel: "5.0k",
      unitLabel: "1h",
    }));
    expect(github && github.kind === "quota" ? github.windows : []).toEqual([
      expect.objectContaining({
        label: "1h",
        usedLabel: "7",
        capLabel: "5.0k",
        unitLabel: "req",
      }),
    ]);
    const githubWindows = github && github.kind === "quota" ? github.windows ?? [] : [];
    expect(githubWindows[0]?.history?.length).toBeGreaterThanOrEqual(1);
    expect(rawDb.query<{ count: number }>(
      "SELECT count(*) AS count FROM budget_quota_window_snapshots WHERE provider = 'github'",
    ).get()?.count).toBe(2);
    expect(rawDb.query<{ used: number; limit_value: number }>(
      "SELECT used, limit_value FROM budget_quota_window_snapshots WHERE provider = 'github' AND id NOT LIKE 'budget:quota:history:%'",
    ).get()).toEqual(expect.objectContaining({
      used: 7,
      limit_value: 5000,
    }));
    rawDb.close();
  });
});
