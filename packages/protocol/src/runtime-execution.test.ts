import { describe, expect, test } from "bun:test";

import {
  createScoutExecutionResolution,
  parseScoutRuntimeSpec,
  formatScoutRuntimeSpec,
  normalizeScoutRuntimeModel,
  SCOUT_LAUNCHABLE_HARNESSES,
  validateScoutRuntimeTuple,
} from "./runtime-execution.js";

describe("runtime execution contracts", () => {
  test("keeps endpoint-only harness categories out of the launch vocabulary", () => {
    expect(SCOUT_LAUNCHABLE_HARNESSES).toContain("codex");
    expect(SCOUT_LAUNCHABLE_HARNESSES).not.toContain("worker" as never);
    expect(SCOUT_LAUNCHABLE_HARNESSES).not.toContain("bridge" as never);
  });

  test("rejects effort values that are valid globally but illegal for the harness", () => {
    expect(validateScoutRuntimeTuple({
      harness: "claude",
      reasoningEffort: "ultra",
    })).toEqual([expect.objectContaining({
      code: "reasoning_effort_harness_mismatch",
      dimension: "reasoningEffort",
    })]);
  });

  test("records requested, resolved, observed, and drift independently", () => {
    const resolution = createScoutExecutionResolution({
      requested: { harness: "codex", model: "5.6", reasoningEffort: "xhigh" },
      resolved: { harness: "codex", model: "gpt-5.6-sol", reasoningEffort: "xhigh" },
      source: { harness: "flag", model: "flag", reasoningEffort: "flag" },
      observed: { harness: "codex", model: "gpt-5.6-terra", reasoningEffort: "xhigh" },
      observedAt: 123,
    });

    expect(resolution.model).toEqual({
      requested: "5.6",
      resolved: "gpt-5.6-sol",
      source: "flag",
      observed: "gpt-5.6-terra",
      observedAt: 123,
      drift: "mismatch",
    });
    expect(resolution.reasoningEffort.drift).toBe("match");
  });

  test("parses a shell-safe fixed-position runtime literal", () => {
    expect(parseScoutRuntimeSpec("codex/gpt-5.6-sol/xhigh")).toEqual({
      ok: true,
      value: {
        harness: "codex",
        model: "gpt-5.6-sol",
        reasoningEffort: "xhigh",
      },
    });
    expect(parseScoutRuntimeSpec("claude/fable/ultra")).toEqual({
      ok: false,
      error: 'reasoning effort "ultra" is not supported by harness "claude"',
    });
  });

  test("normalizes model aliases at the shared boundary", () => {
    expect(normalizeScoutRuntimeModel("codex", "5.6")).toEqual({
      ok: true,
      requested: "5.6",
      resolved: "gpt-5.6-sol",
    });
    expect(normalizeScoutRuntimeModel("claude", "fable")).toEqual({
      ok: true,
      requested: "fable",
      resolved: "claude-fable-5",
    });
  });

  test("does not format sparse runtime tuples ambiguously", () => {
    expect(() => formatScoutRuntimeSpec({
      harness: "codex",
      reasoningEffort: "xhigh",
    })).toThrow("cannot encode effort without a model");
  });
});
