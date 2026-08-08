import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  FAMILY_TIER_PICKS,
  POPULAR_MODEL_FAMILIES,
  modelEconomics,
} from "./model-economics.js";

/**
 * The published JSON is a projection of the TS picks — these tests are the
 * seam that keeps the two from drifting: regenerate-and-forget fails here
 * the moment a pick changes without a republish.
 */
const PUBLISHED = join(
  import.meta.dir,
  "../../../landing/openscout.app/public/.well-known/model-worldview.json",
);

const worldview = await Bun.file(PUBLISHED).json();

describe("model-worldview.json", () => {
  test("carries schema 1 and a generation date", () => {
    expect(worldview.schema).toBe(1);
    expect(worldview.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(worldview.source).toContain("FAMILY_TIER_PICKS");
  });

  test("popularOrder mirrors POPULAR_MODEL_FAMILIES exactly", () => {
    expect(worldview.popularOrder).toEqual(POPULAR_MODEL_FAMILIES);
  });

  test("every family in popularOrder appears once, in order", () => {
    expect(worldview.families.map((f: { id: string }) => f.id)).toEqual(
      POPULAR_MODEL_FAMILIES,
    );
  });

  test("every pick round-trips against the TS picks", () => {
    for (const family of worldview.families) {
      const pick = FAMILY_TIER_PICKS[family.id as keyof typeof FAMILY_TIER_PICKS];
      expect(pick).toBeDefined();
      expect(family.label).toBe(pick.label);
      expect(family.inexpensive).toBe(pick.inexpensive);
      expect(family.budgetFloor).toBe(pick.budgetFloor ?? null);
      expect(family.note).toBe(pick.note ?? null);
    }
  });

  test("every pick carries economics except apple (on-device, no catalog row)", () => {
    for (const family of worldview.families) {
      if (family.id === "apple") {
        expect(family.economics).toBeNull();
        continue;
      }
      const expected = modelEconomics(family.inexpensive);
      expect(expected, `${family.id} pick has no catalog row`).toBeDefined();
      expect(family.economics.input).toBe(expected?.input);
      expect(family.economics.output).toBe(expected?.output);
    }
  });
});
