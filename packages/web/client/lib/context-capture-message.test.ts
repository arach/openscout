import { describe, expect, it } from "bun:test";
import { composeCaptureMessage, parseCaptureContextItems } from "./context-capture-message.ts";

describe("context capture messages", () => {
  it("keeps host context separate from the user draft", () => {
    expect(composeCaptureMessage("Review this", [
      { label: "Page", value: "Package registry" },
      { label: "Selection", value: "Typed page registry" },
    ])).toBe(
      "Review this\n\nContext from the host surface:\n- Page: Package registry\n- Selection: Typed page registry",
    );
  });

  it("rejects malformed context query values", () => {
    expect(parseCaptureContextItems("not-json")).toEqual([]);
    expect(parseCaptureContextItems(JSON.stringify([{ label: "Page", value: "  /studio  " }]))).toEqual([
      { label: "Page", value: "/studio" },
    ]);
  });
});
