import { describe, expect, test } from "bun:test";
import { nextListIndex } from "./keyboard-nav-core.ts";

describe("keyboard list index", () => {
  test("starts at the first item when moving down from an unset cursor", () => {
    expect(nextListIndex(-1, 3, 1)).toBe(0);
  });

  test("starts at the last item when moving up from an unset cursor", () => {
    expect(nextListIndex(-1, 3, -1)).toBe(2);
  });

  test("clamps at the ends of the list", () => {
    expect(nextListIndex(0, 3, -1)).toBe(0);
    expect(nextListIndex(2, 3, 1)).toBe(2);
    expect(nextListIndex(1, 3, 1)).toBe(2);
  });
});