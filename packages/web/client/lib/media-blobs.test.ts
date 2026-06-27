import { describe, expect, test } from "bun:test";
import { isCodeFileName, isMarkdownFileName } from "./capture-attachments.ts";
import {
  isRoutableMediaFile,
  isRoutableMediaType,
  resolvedUploadMediaType,
} from "./media-blobs.ts";

describe("media blob routing", () => {
  test("accepts image, video, markdown, and code mime types", () => {
    expect(isRoutableMediaType("image/png")).toBe(true);
    expect(isRoutableMediaType("video/mp4")).toBe(true);
    expect(isRoutableMediaType("text/markdown")).toBe(true);
    expect(isRoutableMediaType("text/plain", "router.ts")).toBe(true);
    expect(isRoutableMediaType("text/plain", "notes.txt")).toBe(true);
    expect(isRoutableMediaType("text/plain")).toBe(false);
  });

  test("accepts routable files by type or capture extension", () => {
    expect(isRoutableMediaFile({ type: "image/jpeg", name: "shot.png" })).toBe(true);
    expect(isRoutableMediaFile({ type: "application/pdf", name: "brief.pdf" })).toBe(false);
    expect(isRoutableMediaFile({ type: "", name: "plan.md" })).toBe(true);
    expect(isRoutableMediaFile({ type: "", name: "src/router.ts" })).toBe(true);
    expect(isMarkdownFileName("docs/README.markdown")).toBe(true);
    expect(isCodeFileName("Dockerfile")).toBe(true);
  });

  test("resolves capture uploads to the right text mime", () => {
    expect(resolvedUploadMediaType({ type: "text/plain", name: "brief.md" })).toBe("text/markdown");
    expect(resolvedUploadMediaType({ type: "text/plain", name: "router.ts" })).toBe("text/typescript");
    expect(resolvedUploadMediaType({ type: "", name: "config.json" })).toBe("application/json");
    expect(resolvedUploadMediaType({ type: "image/png", name: "shot.png" })).toBe("image/png");
  });
});