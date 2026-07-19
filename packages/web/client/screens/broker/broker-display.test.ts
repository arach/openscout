import { describe, expect, test } from "bun:test";

import { SCOUTBOT_SUBMIT_EVENT } from "../../lib/scoutbot.ts";
import type { BrokerRouteAttempt } from "../../lib/types.ts";
import {
  brokerAttemptContextJson,
  brokerAttemptContextText,
  brokerAttemptDedupeFingerprint,
  brokerAttemptErrorSummary,
  brokerAttemptIsFailure,
  brokerMessageFeedRows,
  brokerAttemptRootCauseFingerprint,
  brokerScoutbotTriageRequest,
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

  test("presents one message row with its linked delivery failure folded in", () => {
    const message = attempt({
      id: "message:message-1",
      kind: "success",
      status: "sent",
      ts: 100,
      actorName: "Arach",
      target: "agent-1",
      route: "dm",
      detail: "Please review this.",
      messageId: "message-1",
      metadata: { source: "messages" },
    });
    const failure = attempt({
      id: "delivery:delivery-1",
      kind: "failed_delivery",
      status: "failed",
      ts: 110,
      actorName: "Agent One",
      target: "agent-1",
      route: "local_socket",
      detail: "direct_message",
      messageId: "message-1",
      deliveryId: "delivery-1",
      metadata: { failureReason: "agent_unreachable" },
    });
    const retry = attempt({
      id: "attempt:attempt-1",
      kind: "delivery_attempt",
      status: "failed",
      ts: 105,
      messageId: "message-1",
      deliveryId: "delivery-1",
    });

    expect(brokerMessageFeedRows([failure, retry, message])).toEqual([{
      ...failure,
      id: message.id,
      ts: message.ts,
      actorName: "Arach",
      route: "dm",
      detail: "Please review this.",
      metadata: {
        failureReason: "agent_unreachable",
        message: { source: "messages" },
      },
    }]);
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

  test("prefers actionable delivery failure detail over its transport reason", () => {
    const summary = brokerAttemptErrorSummary(attempt({
      kind: "failed_delivery",
      status: "failed",
      detail: "Please review this.",
      metadata: {
        reason: "direct_message",
        failureReason: "local_socket_unreachable",
        failureDetail: "connect ENOENT /tmp/agent.sock",
      },
    }));
    expect(summary).toContain("connect ENOENT /tmp/agent.sock");
    expect(summary).not.toContain("direct_message");
  });

  test("does not present a generic delivery reason as an error", () => {
    expect(brokerAttemptErrorSummary(attempt({
      kind: "failed_delivery",
      status: "failed",
      detail: "Please review this.",
      metadata: { reason: "direct_message" },
    }))).toBeNull();
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

  test("builds an explicit Scout submission for failed-dispatch triage", () => {
    const failed = attempt({
      kind: "failed_delivery",
      status: "failed",
      detail: "connect ENOENT /tmp/talkie.sock",
      deliveryId: "delivery-1",
    });

    const request = brokerScoutbotTriageRequest(failed);

    expect(request.eventName).toBe(SCOUTBOT_SUBMIT_EVENT);
    expect(request.eventName).toBe("scout:scoutbot-submit");
    expect(request.body).toContain("Review and triage this failed dispatch.");
    expect(request.body).toContain("report your verdict and recommended next step");
    expect(request.body).toContain("deliveryId: delivery-1");
    expect(request.body).toContain("connect ENOENT /tmp/talkie.sock");
  });
});
