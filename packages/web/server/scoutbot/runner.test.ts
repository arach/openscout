import { describe, expect, test } from "bun:test";
import type { ScoutBrokerFlightRecord, ScoutBrokerMessageRecord } from "../core/broker/service.ts";
import {
  isScoutbotAddressedMessage,
  isScoutbotDirectDeliveryFlight,
} from "./runner.ts";

describe("scoutbot runner routing", () => {
  test("recognizes direct-route metadata as addressed to scoutbot", () => {
    const message = {
      id: "msg-direct-status",
      conversationId: "dm.operator.scoutbot",
      actorId: "operator",
      body: "/status",
      createdAt: 1,
      class: "agent",
      metadata: {
        destinationKind: "direct",
        destinationId: "scoutbot",
        relayTargetIds: ["scoutbot"],
      },
    } as ScoutBrokerMessageRecord;

    expect(isScoutbotAddressedMessage(message)).toBe(true);
  });

  test("distinguishes broker direct deliveries from runner-owned scoutbot flights", () => {
    const directFlight = {
      id: "flight-direct",
      invocationId: "inv-direct",
      requesterId: "operator",
      targetAgentId: "scoutbot",
      state: "queued",
      metadata: {
        source: "scout-mobile",
        destinationKind: "direct",
        destinationId: "scoutbot",
      },
    } as ScoutBrokerFlightRecord;
    const runnerFlight = {
      ...directFlight,
      id: "flight-runner",
      metadata: {
        source: "scoutbot",
        relayTarget: "scoutbot",
      },
    } as ScoutBrokerFlightRecord;

    expect(isScoutbotDirectDeliveryFlight(directFlight)).toBe(true);
    expect(isScoutbotDirectDeliveryFlight(runnerFlight)).toBe(false);
  });
});
