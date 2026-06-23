import { describe, expect, test } from "bun:test";

import {
  parseWaitCommandOptions,
  renderWaitCommandHelp,
  renderWaitCommandResult,
} from "./wait.ts";

describe("renderWaitCommandHelp", () => {
  test("documents generic wait refs", () => {
    const help = renderWaitCommandHelp();

    expect(help).toContain("Usage: scout wait <ref>");
    expect(help).toContain("invocation id, flight id, message id, or ref:<short-id>");
  });
});

describe("parseWaitCommandOptions", () => {
  test("parses a ref and timeout", () => {
    expect(parseWaitCommandOptions(["ref:abc123", "--timeout", "120"])).toEqual({
      command: "wait",
      ref: "ref:abc123",
      timeoutSeconds: 120,
    });
  });

  test("rejects extra positional args", () => {
    expect(() => parseWaitCommandOptions(["inv-1", "inv-2"])).toThrow("unexpected extra argument");
  });
});

describe("renderWaitCommandResult", () => {
  test("renders completed invocation output", () => {
    const output = renderWaitCommandResult({
      input: "ref:abc123",
      found: true,
      timedOut: false,
      resolution: {
        found: true,
        input: "ref:abc123",
        kind: "ref",
        invocationId: "inv-1",
        flightId: "flt-1",
        messageId: "msg-1",
        bindingRef: "abc123",
      },
      invocationId: "inv-1",
      flight: {
        id: "flt-1",
        invocationId: "inv-1",
        requesterId: "operator",
        targetAgentId: "codex",
        state: "completed",
        summary: "Review complete.",
        output: "Looks good.",
      },
      failureLayer: null,
      failureDetail: null,
      messageDelivery: null,
      output: "Looks good.",
      summary: "Review complete.",
      error: null,
      nextAction: null,
    });

    expect(output).toContain("Invocation: inv-1");
    expect(output).toContain("Flight: flt-1");
    expect(output).toContain("Resolved: ref");
    expect(output).toContain("Output:\nLooks good.");
  });

  test("renders failed layer diagnostics", () => {
    const output = renderWaitCommandResult({
      input: "flt-1",
      found: true,
      timedOut: false,
      resolution: {
        found: true,
        input: "flt-1",
        kind: "flight",
        invocationId: "inv-1",
        flightId: "flt-1",
        messageId: "msg-1",
        bindingRef: "abc123",
      },
      invocationId: "inv-1",
      flight: {
        id: "flt-1",
        invocationId: "inv-1",
        requesterId: "operator",
        targetAgentId: "claude-agent",
        state: "failed",
        summary: "Claude Agent failed to respond.",
        error: "Claude stream-json result reported an error without details",
      },
      failureLayer: "harness_execution",
      failureDetail: "Failed after dispatch acknowledgement from claude via claude_stream_json.",
      messageDelivery: "broker accepted message msg-1; the direct-message wake invocation failed.",
      output: null,
      summary: "Claude Agent failed to respond.",
      error: "Claude stream-json result reported an error without details",
      nextAction: "Inspect the error above, then retry or follow up in the conversation.",
    });

    expect(output).toContain("Failure Layer: harness_execution");
    expect(output).toContain("Failure Detail: Failed after dispatch acknowledgement");
    expect(output).toContain("Message Delivery: broker accepted message msg-1");
  });
});
