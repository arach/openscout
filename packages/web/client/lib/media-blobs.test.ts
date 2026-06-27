import { describe, expect, test } from "bun:test";
import { isRoutableMediaFile, isRoutableMediaType } from "./media-blobs.ts";

describe("media blob routing", () => {
  test("accepts image and video mime types", () => {
    expect(isRoutableMediaType("image/png")).toBe(true);
    expect(isRoutableMediaType("video/mp4")).toBe(true);
    expect(isRoutableMediaType("text/plain")).toBe(false);
  });

  test("accepts routable files by type", () => {
    expect(isRoutableMediaFile({ type: "image/jpeg" })).toBe(true);
    expect(isRoutableMediaFile({ type: "application/pdf" })).toBe(false);
  });
});