import { describe, expect, test } from "bun:test";

import { describeObserveEvidence } from "./observe-fidelity.ts";

describe("describeObserveEvidence", () => {
  test("only calls a timestamped live source live", () => {
    expect(describeObserveEvidence({
      source: "live",
      fidelity: "timestamped",
      live: true,
      eventCount: 8,
    })).toEqual(expect.objectContaining({
      label: "Live observed events",
      tone: "live",
      replayable: true,
    }));
  });

  test("labels timestamped history as recorded, not live", () => {
    expect(describeObserveEvidence({
      source: "history",
      fidelity: "timestamped",
      live: false,
      eventCount: 8,
    })).toEqual(expect.objectContaining({
      label: "Recorded event history",
      tone: "recorded",
      replayable: true,
    }));
  });

  test("does not offer replay for reconstructed broker evidence", () => {
    expect(describeObserveEvidence({
      source: "broker",
      fidelity: "synthetic",
      live: false,
      eventCount: 3,
    })).toEqual(expect.objectContaining({
      label: "Reconstructed session evidence",
      tone: "reconstructed",
      replayable: false,
    }));
  });

  test("makes an unavailable trace explicit", () => {
    expect(describeObserveEvidence({
      source: "unavailable",
      fidelity: "synthetic",
      live: false,
      eventCount: 0,
    })).toEqual(expect.objectContaining({
      label: "Trace unavailable",
      tone: "unavailable",
      replayable: false,
    }));
  });
});
