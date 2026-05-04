import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createBuiltInHarnessCatalog,
  evaluateHarnessReadiness,
  loadHarnessCatalogSnapshot,
  mergeHarnessCatalogEntries,
  writeHarnessCatalogOverrides,
} from "./harness-catalog.js";

describe("harness catalog", () => {
  test("built-in catalog contains the current supported external harnesses", () => {
    const entries = createBuiltInHarnessCatalog();

    expect(entries.map((entry) => entry.name)).toEqual(["claude", "codex", "cursor"]);
    expect(entries[0]?.support.collaboration).toBe(true);
    expect(entries[1]?.support.workspace).toBe(true);
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
