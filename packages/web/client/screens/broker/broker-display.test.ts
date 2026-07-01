import { describe, expect, test } from "bun:test";

import type { BrokerRouteAttempt } from "../../lib/types.ts";
import {
  brokerAttemptContextJson,
  brokerAttemptContextText,
  brokerAttemptDedupeFingerprint,
  brokerAttemptErrorSummary,
  brokerAttemptIsFailure,
  brokerAttemptRootCauseFingerprint,
  brokerMetadataPayload,
  brokerMetadataSummary,
} from "./broker-display.ts";

function attempt(overrides: Partial<BrokerRouteAttempt> = {}): BrokerRouteAttempt {
  return {
    id: "attempt-1",
    kind: "success",
    status: "sent",
    ts: 1,
    actorName: "Ava",
    target: "session-mcp@pi-lattice",
    route: "dm",
    detail: "Project-path routed request",
    conversationId: "c-1",
    messageId: "msg-1",
    deliveryId: null,
    invocationId: null,
    ...overrides,
  };
}

describe("broker dispatch display", () => {
  test("flags failed deliveries as failures", () => {
    expect(brokerAttemptIsFailure(attempt({ kind: "failed_delivery", status: "failed" }))).toBe(true);
    expect(brokerAttemptIsFailure(attempt())).toBe(false);
  });

  test("summarizes dispatch metadata for failed queries", () => {
    const summary = brokerAttemptErrorSummary(attempt({
      kind: "failed_query",
      status: "no_agent_match",
      detail: "No agent matches for pi-lattice",
      metadata: {
        dispatchKind: "ask",
        requestedLabel: "pi-lattice",
      },
    }));
    expect(summary).toContain("ask");
    expect(summary).toContain("no_agent_match");
  });

  test("splits metadata into summary scalars and structured payload", () => {
    const summary = brokerMetadataSummary({
      source: "messages",
      class: "scout.dispatch",
      raw: {
        request: "hello",
        context: { project: "openscout" },
      },
    });
    expect(summary).toEqual([
      { key: "source", value: "messages" },
      { key: "class", value: "scout.dispatch" },
    ]);
    expect(brokerMetadataPayload({
      source: "messages",
      class: "scout.dispatch",
      raw: {
        request: "hello",
        context: { project: "openscout" },
      },
    })).toEqual({
      request: "hello",
      context: { project: "openscout" },
    });
  });

  test("builds a stable copy context and dedupe fingerprint for failed deliveries", () => {
    const failed = attempt({
      kind: "failed_delivery",
      status: "failed",
      target: "talkie.codex-agent",
      route: "local_socket",
      detail: "mention",
      messageId: "msg-1",
      deliveryId: "delivery-1",
      metadata: {
        source: "deliveries",
        targetId: "talkie.codex-agent",
        transport: "local_socket",
        reason: "mention",
        failureReason: "local_socket_unreachable",
        failureDetail: "connect ENOENT /tmp/talkie.sock",
      },
    });

    expect(brokerAttemptDedupeFingerprint(failed))
      .toBe("failed_delivery|msg-1|talkie.codex-agent|local_socket");
    expect(brokerAttemptRootCauseFingerprint(failed))
      .toBe("failed_delivery|talkie.codex-agent|local_socket|local_socket_unreachable|connect enoent /tmp/talkie.sock");
    expect(brokerAttemptContextJson(failed)).toMatchObject({
      dedupeFingerprint: "failed_delivery|msg-1|talkie.codex-agent|local_socket",
      rootCauseFingerprint: "failed_delivery|talkie.codex-agent|local_socket|local_socket_unreachable|connect enoent /tmp/talkie.sock",
      attempt: failed,
    });
    expect(brokerAttemptContextText(failed)).toContain("Full JSON:");
    expect(brokerAttemptContextText(failed)).toContain("deliveryId: delivery-1");
  });
});
