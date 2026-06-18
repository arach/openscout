import { describe, expect, test } from "bun:test";

import {
  CONVERSATION_WORKING_TURN_ACTIVE_WINDOW_MS,
  isActiveConversationFlight,
  isConversationWorkingTurnWithoutRecentUpdate,
  isConversationWorkingTurnWithoutRecentUpdateAnswered,
  shouldClearConversationWorkingStateForAgentMessage,
  shouldShowConversationWorkingTurn,
} from "./conversations.ts";

describe("conversation flight presence", () => {
  test("keeps acknowledged running asks in the working state", () => {
    const runningFlight = { state: "running" };

    expect(isActiveConversationFlight(runningFlight)).toBe(true);
    expect(shouldShowConversationWorkingTurn(runningFlight)).toBe(true);
    expect(
      shouldClearConversationWorkingStateForAgentMessage(runningFlight),
    ).toBe(false);
  });

  test("does not show requester wait timeouts as conversation working turns", () => {
    const timeoutFlight = {
      state: "waiting",
      summary: "Review Run2 is still working; Scout stopped waiting for a synchronous result after 300000ms.",
    };

    expect(isActiveConversationFlight(timeoutFlight)).toBe(true);
    expect(shouldShowConversationWorkingTurn(timeoutFlight)).toBe(false);
  });

  test("clears working state after terminal flights", () => {
    for (const state of ["completed", "failed", "cancelled"]) {
      const terminalFlight = { state };

      expect(isActiveConversationFlight(terminalFlight)).toBe(false);
      expect(shouldShowConversationWorkingTurn(terminalFlight)).toBe(false);
      expect(
        shouldClearConversationWorkingStateForAgentMessage(terminalFlight),
      ).toBe(true);
    }
  });

  test("allows an agent message to resolve pending state before a flight exists", () => {
    expect(shouldClearConversationWorkingStateForAgentMessage(null)).toBe(true);
  });

  test("marks unresolved working turns as having no recent update after the active window", () => {
    const nowMs = 2_000_000_000_000;
    const freshFlight = {
      state: "running",
      startedAt: nowMs - CONVERSATION_WORKING_TURN_ACTIVE_WINDOW_MS,
    };
    const quietFlight = {
      state: "running",
      startedAt: nowMs - CONVERSATION_WORKING_TURN_ACTIVE_WINDOW_MS - 1,
    };

    expect(isConversationWorkingTurnWithoutRecentUpdate(freshFlight, nowMs)).toBe(false);
    expect(isConversationWorkingTurnWithoutRecentUpdate(quietFlight, nowMs)).toBe(true);
  });

  test("does not mark terminal flights as having no recent update", () => {
    const flight = {
      state: "completed",
      startedAt: 1,
    };

    expect(isConversationWorkingTurnWithoutRecentUpdate(flight, 1_000_000)).toBe(false);
  });

  test("does not mark queued-until-online flights as no recent update", () => {
    const nowMs = 2_000_000_000_000;
    const flight = {
      state: "queued",
      startedAt: nowMs - CONVERSATION_WORKING_TURN_ACTIVE_WINDOW_MS - 1,
      dispatchOutcome: {
        status: "queued_until_online",
        reason: "no_runnable_endpoint",
        checkedAt: nowMs - CONVERSATION_WORKING_TURN_ACTIVE_WINDOW_MS - 1,
      },
    };

    expect(shouldShowConversationWorkingTurn(flight)).toBe(true);
    expect(isConversationWorkingTurnWithoutRecentUpdate(flight, nowMs)).toBe(false);
  });

  test("treats a no-recent-update working turn as answered after a newer agent reply", () => {
    const nowMs = 2_000_000_000_000;
    const flight = {
      state: "running",
      startedAt: nowMs - CONVERSATION_WORKING_TURN_ACTIVE_WINDOW_MS - 1,
    };

    expect(
      isConversationWorkingTurnWithoutRecentUpdateAnswered(
        flight,
        flight.startedAt - 1,
        nowMs,
      ),
    ).toBe(false);
    expect(
      isConversationWorkingTurnWithoutRecentUpdateAnswered(
        flight,
        flight.startedAt + 1,
        nowMs,
      ),
    ).toBe(true);
  });
});
