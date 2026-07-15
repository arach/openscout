import { describe, expect, test } from "bun:test";
import { isolateOpenScoutUserDataForTests } from "./test-user-data-isolation.ts";

isolateOpenScoutUserDataForTests();

import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildHarnessResumeCommand,
  createBuiltInHarnessCatalog,
  evaluateHarnessReadiness,
  loadHarnessCatalogSnapshot,
  mergeHarnessCatalogEntries,
  writeHarnessCatalogOverrides,
} from "./harness-catalog.js";

describe("harness catalog", () => {
  test("built-in catalog contains the current supported external harnesses", () => {
    const entries = createBuiltInHarnessCatalog();

    expect(entries.map((entry) => entry.name)).toEqual(["claude", "grok", "codex", "grok-acp", "cursor", "flue", "pi"]);
    expect(entries.find((entry) => entry.name === "claude")?.support.collaboration).toBe(true);
    expect(entries.find((entry) => entry.name === "codex")?.support.workspace).toBe(true);
    expect(entries.find((entry) => entry.name === "grok-acp")?.metadata?.adapterType).toBe("grok-acp");
    expect(entries.find((entry) => entry.name === "pi")?.install?.macos).toBe(
      "npm install -g @earendil-works/pi-coding-agent",
    );
  });

  test("merge applies local overrides without discarding nested builtin fields", () => {
    const [claude] = mergeHarnessCatalogEntries(createBuiltInHarnessCatalog(), {
      claude: {
        support: {
          browser: true,
        },
        install: {
          verify: "claude --version >/dev/null 2>&1",
        },
      },
    });

    expect(claude?.support.browser).toBe(true);
    expect(claude?.support.collaboration).toBe(true);
    expect(claude?.install?.binary).toBe("claude");
    expect(claude?.install?.verify).toBe("claude --version >/dev/null 2>&1");
  });

  test("readiness reports installed when binary exists but auth is still missing", () => {
    const codex = createBuiltInHarnessCatalog().find((entry) => entry.name === "codex");
    expect(codex).toBeTruthy();

    const report = evaluateHarnessReadiness(codex!, {
      env: {},
      whichBinary: () => "/usr/local/bin/codex",
      requirementExists: () => false,
    });

    expect(report.state).toBe("installed");
    expect(report.installed).toBe(true);
    expect(report.configured).toBe(false);
    expect(report.missing).toEqual(["one of: OPENAI_API_KEY, ~/.codex/auth.json"]);
  });

  test("readiness reports ready when binary and any auth source are present", () => {
    const claude = createBuiltInHarnessCatalog().find((entry) => entry.name === "claude");
    expect(claude).toBeTruthy();

    const report = evaluateHarnessReadiness(claude!, {
      env: {
        ANTHROPIC_API_KEY: "test-key",
      },
      whichBinary: () => "/usr/local/bin/claude",
      requirementExists: () => false,
    });

    expect(report.state).toBe("ready");
    expect(report.installed).toBe(true);
    expect(report.configured).toBe(true);
    expect(report.ready).toBe(true);
  });

  test("readiness reports pi ready when binary and auth file are present", () => {
    const pi = createBuiltInHarnessCatalog().find((entry) => entry.name === "pi");
    expect(pi).toBeTruthy();

    const report = evaluateHarnessReadiness(pi!, {
      env: {},
      whichBinary: () => "/usr/local/bin/pi",
      requirementExists: (requirement) => requirement.path === "~/.pi/agent/auth.json",
    });

    expect(report.state).toBe("ready");
    expect(report.installed).toBe(true);
    expect(report.configured).toBe(true);
    expect(report.ready).toBe(true);
  });

  test("readiness reports pi ready with Scout xAI credentials", () => {
    const pi = createBuiltInHarnessCatalog().find((entry) => entry.name === "pi");
    expect(pi).toBeTruthy();

    const report = evaluateHarnessReadiness(pi!, {
      env: {
        SCOUT_XAI_API_KEY: "test-key",
      },
      whichBinary: () => "/usr/local/bin/pi",
      requirementExists: () => false,
    });

    expect(report.state).toBe("ready");
    expect(report.installed).toBe(true);
    expect(report.configured).toBe(true);
    expect(report.ready).toBe(true);
  });

  test("readiness reports Grok ACP ready with Scout xAI credentials", () => {
    const grokAcp = createBuiltInHarnessCatalog().find((entry) => entry.name === "grok-acp");
    expect(grokAcp).toBeTruthy();

    const report = evaluateHarnessReadiness(grokAcp!, {
      env: {
        SCOUT_XAI_API_KEY: "test-key",
      },
      whichBinary: () => "/usr/local/bin/grok",
      requirementExists: () => false,
    });

    expect(report.state).toBe("ready");
    expect(report.installed).toBe(true);
    expect(report.configured).toBe(true);
    expect(report.ready).toBe(true);
  });

  test("builds current shell-safe resume commands", () => {
    const entries = createBuiltInHarnessCatalog();
    const claude = entries.find((entry) => entry.name === "claude");
    const codex = entries.find((entry) => entry.name === "codex");
    const pi = entries.find((entry) => entry.name === "pi");

    expect(claude).toBeTruthy();
    expect(codex).toBeTruthy();
    expect(pi).toBeTruthy();
    expect(buildHarnessResumeCommand(claude!, "claude-session", "/Users/me/dev/app")).toBe(
      "claude --resume claude-session",
    );
    expect(buildHarnessResumeCommand(codex!, "codex-session", "/Users/me/dev/app")).toBe(
      "codex resume -C /Users/me/dev/app codex-session",
    );
    expect(buildHarnessResumeCommand(codex!, "codex-session", "/Users/me/dev/my app")).toBe(
      "codex resume -C '/Users/me/dev/my app' codex-session",
    );
    expect(buildHarnessResumeCommand(codex!, "codex-session", "~/dev/amplink")).toContain(
      `${homedir()}/dev/amplink`,
    );
    expect(buildHarnessResumeCommand(codex!, "codex-session", "~/dev/amplink")).not.toContain(
      "'~/dev/amplink'",
    );
    expect(buildHarnessResumeCommand(pi!, "pi-session", "/Users/me/dev/app")).toBe(
      "pi --session-id pi-session",
    );
  });

  test("snapshot applies local override file and marks override source", async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), "openscout-harness-catalog-"));
    const overridePath = join(tempDirectory, "harness-catalog.json");

    try {
      await writeHarnessCatalogOverrides({
        codex: {
          support: {
            browser: true,
          },
        },
      }, overridePath);

      const snapshot = await loadHarnessCatalogSnapshot({
        overridePath,
        env: {},
        whichBinary: () => null,
        requirementExists: () => false,
      });

      const codex = snapshot.entries.find((entry) => entry.name === "codex");
      expect(codex?.source).toBe("local");
      expect(codex?.support.browser).toBe(true);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
