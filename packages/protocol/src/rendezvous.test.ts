import { describe, expect, test } from "bun:test";

import {
  normalizeScoutRendezvousTopic,
  validateScoutRendezvousTopic,
} from "./rendezvous.js";

describe("Scout rendezvous topics", () => {
  test("normalizes compatibility forms, case, and repeated whitespace", () => {
    expect(normalizeScoutRendezvousTopic("  ＲＥＶＩＥＷ\t  Parser  ")).toBe("review parser");
  });

  test("rejects blank, control-character, and oversized topics", () => {
    expect(() => validateScoutRendezvousTopic(" \n ")).toThrow("blank");
    expect(() => validateScoutRendezvousTopic("review\u0000parser")).toThrow(
      "control characters",
    );
    expect(() => validateScoutRendezvousTopic("x".repeat(121))).toThrow(
      "at most 120",
    );
  });
});
