import { describe, expect, test } from "bun:test";
import {
  SLASH_COMMANDS,
  WORKING_DURATION_THRESHOLDS_MS,
  deriveWorkingDurationStage,
  hasOutstandingConversationReply,
  resolveComposeAction,
  resolveConversationAutoscroll,
  resolveThreadEmbedProps,
} from "./conversation-model.ts";

describe("conversation working duration", () => {
  const startedAt = 1_700_000_000_000;

  test("graduates an active turn from brief to sustained to long", () => {
    expect(deriveWorkingDurationStage(startedAt, startedAt + 14_999)).toBe("brief");
    expect(
      deriveWorkingDurationStage(
        startedAt,
        startedAt + WORKING_DURATION_THRESHOLDS_MS.sustained,
      ),
    ).toBe("sustained");
    expect(
      deriveWorkingDurationStage(
        startedAt,
        startedAt + WORKING_DURATION_THRESHOLDS_MS.long,
      ),
    ).toBe("long");
  });

  test("keeps missing and future timestamps in the brief stage", () => {
    expect(deriveWorkingDurationStage(null, startedAt)).toBe("brief");
    expect(deriveWorkingDurationStage(startedAt + 1_000, startedAt)).toBe("brief");
  });
});

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

  test("keeps the macOS thread embed on the complete web conversation composer", () => {
    const props = resolveThreadEmbedProps(
      new URLSearchParams("conversationId=c-1&composer=0&treatment=ledger"),
    );

    expect(props).toEqual({
      conversationId: "c-1",
      embedded: true,
      showBackNav: false,
      treatment: "ledger",
    });
  });
});

describe("conversation feed autoscroll", () => {
  const settled = {
    newestMessageId: "msg-0450",
    previousNewestMessageId: "msg-0450",
    showTyping: false,
    previousShowTyping: false,
    historyRestorePending: false,
    initialScrollDone: true,
  };

  /// The pre-fix trigger: a string key that folded typing state into identity
  /// and scrolled whenever it changed, in either direction.
  const visualRowKey = (newestMessageId: string, showTyping: boolean) =>
    `${newestMessageId}:${showTyping ? "typing" : "settled"}`;

  test("stays put when a typing row settles", () => {
    // The reviewer's probe caught the key going "msg-0450:typing" ->
    // "msg-0450:settled" with an unchanged newest message, which scrolled and
    // yanked a reader who was up in history.
    expect(visualRowKey("msg-0450", true)).not.toBe(visualRowKey("msg-0450", false));
    expect(resolveConversationAutoscroll({
      ...settled,
      previousShowTyping: true,
    })).toBe("none");
  });

  test("follows genuine growth at the bottom", () => {
    expect(resolveConversationAutoscroll({
      ...settled,
      newestMessageId: "msg-0451",
    })).toBe("smooth");
    expect(resolveConversationAutoscroll({
      ...settled,
      showTyping: true,
    })).toBe("smooth");
  });

  test("stands down while an earlier page is being restored", () => {
    // The layout effect owns scrollTop on this commit; scrolling would undo it.
    expect(resolveConversationAutoscroll({
      ...settled,
      newestMessageId: "msg-0451",
      historyRestorePending: true,
    })).toBe("none");
    expect(resolveConversationAutoscroll({
      ...settled,
      showTyping: true,
      historyRestorePending: true,
    })).toBe("none");
  });

  test("ignores commits that change nothing at the bottom", () => {
    expect(resolveConversationAutoscroll(settled)).toBe("none");
    expect(resolveConversationAutoscroll({
      ...settled,
      showTyping: true,
      previousShowTyping: true,
    })).toBe("none");
  });

  test("lands the first paint at the bottom without animating", () => {
    expect(resolveConversationAutoscroll({
      ...settled,
      previousNewestMessageId: null,
      initialScrollDone: false,
    })).toBe("instant");
    expect(resolveConversationAutoscroll({
      newestMessageId: null,
      previousNewestMessageId: null,
      showTyping: false,
      previousShowTyping: false,
      historyRestorePending: false,
      initialScrollDone: false,
    })).toBe("none");
  });
});
