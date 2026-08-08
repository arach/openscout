import { describe, expect, test } from "bun:test";

import {
  FAMILY_TIER_PICKS,
  inexpensiveCognitionPick,
  modelEconomics,
  POPULAR_MODEL_FAMILIES,
  type ModelFamilyId,
} from "./model-economics.js";

describe("model economics (models.dev-backed + curated picks)", () => {
  test("every family in the popular order carries picks, and vice versa", () => {
    const ordered = new Set(POPULAR_MODEL_FAMILIES);
    const picked = new Set(Object.keys(FAMILY_TIER_PICKS));
    expect([...picked].sort()).toEqual([...ordered].sort());
  });

  test("the popular heads lead the order", () => {
    expect(POPULAR_MODEL_FAMILIES.slice(0, 4)).toEqual(["anthropic", "openai", "xai", "minimax"]);
  });

  test("every cloud pick resolves to a catalog row with a real price", () => {
    for (const family of POPULAR_MODEL_FAMILIES) {
      if (family === "apple") continue; // on-device, deliberately uncataloged
      const pick = inexpensiveCognitionPick(family);
      expect(pick.economics, `${family}: ${pick.inexpensive} missing from catalog`).toBeDefined();
      expect(pick.economics!.output).toBeGreaterThanOrEqual(0);
    }
  });

  test("inexpensive means inexpensive: every cloud pick is ≤ $5 out per 1M", () => {
    for (const family of POPULAR_MODEL_FAMILIES) {
      if (family === "apple") continue;
      const pick = inexpensiveCognitionPick(family);
      expect(pick.economics!.output, `${family}: ${pick.inexpensive}`).toBeLessThanOrEqual(5);
    }
  });

  test("budget floors are never pricier than the pick they floor", () => {
    for (const picks of Object.values(FAMILY_TIER_PICKS)) {
      if (!picks.budgetFloor) continue;
      const floor = modelEconomics(picks.budgetFloor);
      const pick = modelEconomics(picks.inexpensive);
      if (!floor || !pick) continue; // apple / free tiers
      expect(floor.input, `${picks.family}: ${picks.budgetFloor}`).toBeLessThanOrEqual(pick.input);
    }
  });

  test("known current ids resolve with expected prices", () => {
    expect(modelEconomics("claude-haiku-4-5")).toMatchObject({ input: 1, output: 5 });
    expect(modelEconomics("gpt-5.6-luna")?.input).toBe(0.2);
    expect(modelEconomics("deepseek-v4-flash")).toMatchObject({ input: 0.14, output: 0.28 });
    expect(modelEconomics("MiniMax-M3")).toMatchObject({ input: 0.3, output: 1.2 });
    expect(modelEconomics("openai/gpt-oss-20b")?.structuredOutput).toBe(true);
  });

  test("retired ids the industry moved off are not our picks", () => {
    const pickedIds = Object.values(FAMILY_TIER_PICKS).map((p) => p.inexpensive);
    for (const retired of ["claude-3-5-haiku-latest", "deepseek-chat", "qwen-turbo"]) {
      expect(pickedIds).not.toContain(retired);
    }
  });

  test("family ids are exhaustive at the type level", () => {
    // Compile-time exhaustiveness: a new ModelFamilyId without picks fails to
    // build; this runtime line just keeps the import meaningful.
    const families: ModelFamilyId[] = Object.keys(FAMILY_TIER_PICKS) as ModelFamilyId[];
    expect(families.length).toBeGreaterThanOrEqual(12);
  });
});
