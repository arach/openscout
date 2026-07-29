import { describe, expect, test } from "bun:test";
import {
  SLASH_COMMANDS,
  WORKING_DURATION_THRESHOLDS_MS,
  deriveWorkingDurationStage,
  hasOutstandingConversationReply,
  resolveComposeAction,
  resolveConversationAutoscroll,
  resolveThreadEmbedProps,
  terminalTurnReceiptForFlight,
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

describe("terminal turn receipt", () => {
  const completedFlight = {
    id: "flt-1",
    invocationId: "inv-1",
    messageId: "msg-origin",
    agentId: "agent-1",
    agentName: "Tesla",
    conversationId: "c.agent-1",
    collaborationRecordId: null,
    state: "completed",
    summary: "worker-alias-3 replied.",
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_020_000,
    sessions: [],
  };
  const linkedReply = {
    id: "msg-reply",
    conversationId: "c.agent-1",
    actorId: "agent-1",
    actorName: "Tesla",
    body: "Here is the answer.",
    createdAt: 1_700_000_019_000,
    class: "agent",
    replyToMessageId: "msg-origin",
  };

  test("keeps execution completion visible without claiming a reply settled", () => {
    const receipt = terminalTurnReceiptForFlight({
      ...completedFlight,
      messageId: null,
      summary: null,
    });

    expect(receipt).toEqual(expect.objectContaining({
      label: "Run completed",
      detail: "Execution ended successfully.",
      tone: "complete",
      settled: false,
    }));
    expect(receipt?.detail?.toLowerCase()).not.toContain("reply");
  });

  test("settles into a quiet duration receipt once the linked reply lands", () => {
    const receipt = terminalTurnReceiptForFlight(completedFlight, [linkedReply]);

    expect(receipt).toEqual(expect.objectContaining({
      tone: "complete",
      settled: true,
      durationLabel: "20s",
      // The reply owns the announcement; no summary sentence (which would
      // also leak the broker worker alias) survives settlement.
      detail: null,
    }));
  });

  test("does not settle on unlinked agent chatter", () => {
    const unlinked = { ...linkedReply, id: "msg-other", replyToMessageId: null };
    const receipt = terminalTurnReceiptForFlight(completedFlight, [unlinked]);

    expect(receipt?.settled).toBe(false);
    expect(receipt?.label).toBe("Run completed");
  });

  test("failed runs keep the full card regardless of thread contents", () => {
    const receipt = terminalTurnReceiptForFlight(
      { ...completedFlight, state: "failed" },
      [linkedReply],
    );

    expect(receipt).toEqual(expect.objectContaining({
      label: "Run failed",
      tone: "failed",
      settled: false,
    }));
  });
});
