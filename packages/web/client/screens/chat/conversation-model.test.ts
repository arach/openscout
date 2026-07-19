import { describe, expect, test } from "bun:test";
import {
  SLASH_COMMANDS,
  hasOutstandingConversationReply,
  resolveComposeAction,
} from "./conversation-model.ts";

describe("conversation composer product model", () => {
  test("presents one Send path instead of Ask, Tell, or Steer commands", () => {
    expect(SLASH_COMMANDS.map((command) => command.command)).not.toContain("/ask");
    expect(SLASH_COMMANDS.map((command) => command.command)).not.toContain("/tell");
    expect(SLASH_COMMANDS.map((command) => command.command)).not.toContain("/steer");
  });

  test("resolves Send behavior from Chat and Run context", () => {
    expect(resolveComposeAction({ isDm: false, hasOutstandingReply: false }))
      .toBe("message");
    expect(resolveComposeAction({ isDm: true, hasOutstandingReply: false }))
      .toBe("invoke");
    expect(resolveComposeAction({ isDm: true, hasOutstandingReply: true }))
      .toBe("steer");
  });

  test("keeps active Runs routable when their visual presence is suppressed", () => {
    for (const state of ["queued", "waking", "waiting", "running"]) {
      expect(hasOutstandingConversationReply({
        sending: false,
        awaitingResponse: false,
        currentFlight: { state },
      })).toBe(true);
    }

    expect(hasOutstandingConversationReply({
      sending: false,
      awaitingResponse: false,
      currentFlight: { state: "completed" },
    })).toBe(false);
  });
});
