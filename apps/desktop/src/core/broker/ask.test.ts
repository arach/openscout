import { describe, expect, test } from "bun:test";

import { buildScoutAskRoute } from "./ask.ts";

describe("buildScoutAskRoute", () => {
  test("keeps direct --to values as existing agent-label routes", () => {
    expect(buildScoutAskRoute({
      to: "Fable",
      currentDirectory: "/tmp/openscout",
    })).toEqual({
      kind: "agent_label",
      label: "Fable",
    });
  });

  test("builds explicit broker runtime-profile routes for the current project", () => {
    expect(buildScoutAskRoute({
      to: "",
      runtimeProfile: "opus",
      currentDirectory: "/tmp/openscout",
      reasoningEffort: "high",
    })).toEqual({
      kind: "runtime_profile",
      profile: "opus",
      projectPath: "/tmp/openscout",
      reasoningEffort: "high",
    });
  });

  test("builds a distinct exact existing-handle route", () => {
    expect(buildScoutAskRoute({
      to: "",
      existingHandle: "@composer-review",
      currentDirectory: "/tmp/openscout",
    })).toEqual({
      kind: "existing_handle",
      handle: "composer-review",
      value: "@composer-review",
    });
  });
});
