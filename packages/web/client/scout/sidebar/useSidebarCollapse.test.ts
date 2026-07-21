import { describe, expect, test } from "bun:test";
import {
  SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
} from "./useSidebarCollapse.ts";

describe("sidebar collapse constants (SCO-083)", () => {
  test("auto-collapse breakpoint is below 1024px", () => {
    expect(SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH).toBe(1023);
    expect(900).toBeLessThanOrEqual(SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH);
    expect(1280).toBeGreaterThan(SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH);
  });

  test("expanded and icon-rail widths match the anatomy", () => {
    expect(SIDEBAR_EXPANDED_WIDTH).toBe(260);
    expect(SIDEBAR_COLLAPSED_WIDTH).toBe(48);
  });
});
