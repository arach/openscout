import { describe, expect, test } from "bun:test";
import {
  SLASH_COMMANDS,
  WORKING_DURATION_THRESHOLDS_MS,
  buildTurnSnapshot,
  deriveWorkingDurationStage,
  hasOutstandingConversationReply,
  matchMentionTrigger,
  matchSlashTrigger,
  resolveComposeAction,
  resolveConversationAutoscroll,
  optimisticMessageIndexForClientId,
  mergeCanonicalMessagesPreservingPending,
  terminalTurnReceiptForFlight,
  selectTerminalFlightForConversation,
  resolveSendDisposition,
  resolveThreadEmbedProps,
  shouldFlushQueue,
} from "./conversation-model.ts";

describe("optimistic message identity", () => {
  test("reconciles by client id instead of identical body text and time", () => {
    const messages = [
      {
        id: "optimistic-client-a",
        conversationId: "c-1",
        actorName: "operator",
        body: "same request",
        createdAt: 1_700_000_000_000,
        class: "operator",
        metadata: { clientMessageId: "client-a" },
      },
      {
        id: "optimistic-client-b",
        conversationId: "c-1",
        actorName: "operator",
        body: "same request",
        createdAt: 1_700_000_000_000,
        class: "operator",
        metadata: { clientMessageId: "client-b" },
      },
    ];

    expect(optimisticMessageIndexForClientId(messages, "client-b")).toBe(1);
    expect(optimisticMessageIndexForClientId(messages, "client-c")).toBe(-1);
  });

  test("an incomplete refresh cannot erase an unresolved local message", () => {
    const optimistic = {
      id: "optimistic-client-a",
      conversationId: "c-1",
      actorName: "operator",
      body: "keep me visible",
      createdAt: 1_700_000_000_000,
      class: "operator",
      metadata: { clientMessageId: "client-a", deliveryState: "unknown" },
    };

    expect(mergeCanonicalMessagesPreservingPending([optimistic], [])).toEqual([optimistic]);
    expect(mergeCanonicalMessagesPreservingPending([optimistic], [{
      ...optimistic,
      id: "msg-canonical",
      metadata: { clientMessageId: "client-a" },
    }])).toEqual([
      expect.objectContaining({ id: "msg-canonical" }),
    ]);
  });
});

describe("turn activity evidence", () => {
  test("does not count an accepted flight as activity before its first update", () => {
    const snapshot = buildTurnSnapshot({
      currentFlight: null,
      presence: {
        label: "Waiting for worker",
        detail: "The request was accepted and is waiting for activity.",
        tone: "pending",
        showStrip: true,
        showTyping: true,
      },
      turnActivity: [],
      turnAsk: null,
      awaitingResponseSince: 1_700_000_000_000,
      nowMs: 1_700_000_001_000,
    });

    expect(snapshot.activityLabel).toBe("No activity yet");
  });
});

describe("terminal turn receipt", () => {
  test("keeps execution completion visible without claiming a reply settled", () => {
    const receipt = terminalTurnReceiptForFlight({
      id: "flt-1",
      invocationId: "inv-1",
      agentId: "agent-1",
      agentName: "Tesla",
      conversationId: "c.agent-1",
      collaborationRecordId: null,
      state: "completed",
      summary: null,
      startedAt: 1_700_000_000_000,
      completedAt: 1_700_000_020_000,
      sessions: [],
    });

    expect(receipt).toEqual(expect.objectContaining({
      label: "Run completed",
      detail: "Execution ended successfully.",
      tone: "complete",
    }));
    expect(receipt?.detail.toLowerCase()).not.toContain("reply");
  });

  test("prefers the terminal flight linked to the latest operator turn", () => {
    const baseFlight = {
      invocationId: "inv-1",
      agentId: "agent-1",
      agentName: "Tesla",
      conversationId: "c.agent-1",
      collaborationRecordId: null,
      state: "completed",
      summary: null,
      startedAt: 1_700_000_000_000,
      completedAt: 1_700_000_020_000,
      sessions: [],
    };
    const selected = selectTerminalFlightForConversation([
      { ...baseFlight, id: "flt-newer-unrelated", messageId: "msg-old" },
      { ...baseFlight, id: "flt-current", messageId: "msg-current" },
    ], [{
      id: "msg-current",
      conversationId: "c.agent-1",
      actorId: "operator",
      actorName: "operator",
      body: "current request",
      createdAt: 1_700_000_000_000,
      class: "operator",
    }]);

    expect(selected?.id).toBe("flt-current");
  });
});

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
  test("opens suggestions for bare slash and mention triggers", () => {
    expect(matchSlashTrigger("/", 1)).toEqual({ start: 0, query: "" });
    expect(matchMentionTrigger("@", 1)).toEqual({ start: 0, query: "" });
    expect(matchSlashTrigger("message /rou", 12)).toEqual({
      start: 8,
      query: "rou",
    });
    expect(matchMentionTrigger("message @ara", 12)).toEqual({
      start: 8,
      query: "ara",
    });
  });

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

describe("queue/steer modifier", () => {
  test("an idle agent ignores the modifier — Send just sends", () => {
    expect(
      resolveSendDisposition({ isAgentBusy: false, intent: "queue" }),
    ).toBe("send");
    expect(
      resolveSendDisposition({ isAgentBusy: false, intent: "steer" }),
    ).toBe("send");
  });

  test("mid-turn, Send does whatever the modifier says", () => {
    expect(resolveSendDisposition({ isAgentBusy: true, intent: "queue" })).toBe(
      "queue",
    );
    expect(resolveSendDisposition({ isAgentBusy: true, intent: "steer" })).toBe(
      "steer",
    );
  });

  test("a draft being rewritten is held out of the flush", () => {
    const rows = [
      { id: "a", body: "first", attachments: [], queuedAt: 1 },
      { id: "b", body: "second", attachments: [], queuedAt: 2 },
    ];
    // The screen passes the queue minus the row that is in the input box.
    const editing = rows.filter((row) => row.id !== "a");
    expect(
      shouldFlushQueue({ isAgentBusy: false, sending: false, queued: editing }),
    ).toBe(true);
    expect(editing[0]?.id).toBe("b");
    expect(
      shouldFlushQueue({ isAgentBusy: false, sending: false, queued: [] }),
    ).toBe(false);
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
