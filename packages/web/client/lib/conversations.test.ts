import { describe, expect, test } from "bun:test";

import {
  isActiveConversationFlight,
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
});
