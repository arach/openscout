import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createOpenScoutVantageHandoff } from "./vantage-handoff.ts";

const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const testDirectories = new Set<string>();

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "openscout-vantage-handoff-"));
  testDirectories.add(root);
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(root, "support");
});

afterEach(() => {
  if (originalSupportDirectory === undefined) {
    delete process.env.OPENSCOUT_SUPPORT_DIRECTORY;
  } else {
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = originalSupportDirectory;
  }
  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  testDirectories.clear();
});

describe("createOpenScoutVantageHandoff", () => {
  test("does not launch an empty setup that would clear the native canvas", async () => {
    const handoff = await createOpenScoutVantageHandoff({
      currentDirectory: "/work/project",
      agentIds: ["missing.agent"],
      broker: null,
      tmuxSessions: [],
      nativeSessions: [],
      launch: true,
      now: new Date("2026-05-17T12:00:00.000Z"),
    });

    expect(handoff.plan.manifest.nodes).toHaveLength(0);
    expect(handoff.launch).toMatchObject({
      attempted: false,
      ok: false,
    });
    expect(handoff.launch.error).toContain("No Vantage windows matched the selected Scout surface");
    expect(existsSync(handoff.handoffPath)).toBe(true);
    expect(existsSync(handoff.setupPath)).toBe(true);
  });
});
