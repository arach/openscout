import { describe, expect, test } from "bun:test";

import { readCodexRolloutUsageObservation } from "./usage.ts";

describe("Codex usage observation", () => {
  test("keeps cumulative totals separate from latest-turn context input", () => {
    const observation = readCodexRolloutUsageObservation({
      type: "token_count",
      info: {
        model_context_window: 258400,
        total_token_usage: {
          input_tokens: 900000,
          output_tokens: 50,
          total_tokens: 900050,
          cached_input_tokens: 800000,
        },
        last_token_usage: {
          input_tokens: 12345,
          cached_input_tokens: 100,
          output_tokens: 50,
          total_tokens: 12395,
        },
      },
    }, Date.parse("2026-06-20T20:00:00.000Z"));

    expect(observation).toEqual(expect.objectContaining({
      inputTokens: 900000,
      contextInputTokens: 12445,
      outputTokens: 50,
      totalTokens: 900050,
      cacheReadInputTokens: 800000,
      contextWindowTokens: 258400,
    }));
  });
});
