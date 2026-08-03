import { describe, expect, test } from "bun:test";
import type { Message } from "../../lib/types.ts";
import {
  SLASH_COMMANDS,
  WORKING_DURATION_THRESHOLDS_MS,
  buildConversationFeedRows,
  feedRowCreatedAt,
  shouldShowThreadDayDivider,
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

  test("lets the macOS host keep its native composer with the shared transcript", () => {
    const props = resolveThreadEmbedProps(
      new URLSearchParams("conversationId=c-1&composer=0&treatment=ledger"),
    );

    expect(props).toEqual({
      conversationId: "c-1",
      embedded: true,
      showBackNav: false,
      showComposer: false,
      treatment: "ledger",
    });
  });

  test("keeps standalone thread embeds complete by default", () => {
    expect(resolveThreadEmbedProps(new URLSearchParams("conversationId=c-1")))
      .toEqual(expect.objectContaining({ showComposer: true }));
  });
});

describe("conversation feed rows", () => {
  const at = 1_700_000_000_000;
  const oneDay = 86_400_000;

  function message(overrides: Partial<Message> & Pick<Message, "id">): Message {
    return {
      conversationId: "chn-1",
      actorId: "agent-1",
      actorName: "Agent One",
      body: "body",
      createdAt: at,
      class: "agent",
      ...overrides,
    };
  }

  function delivery(id: string, recipient: string, overrides: Partial<Message> = {}): Message {
    return message({
      id,
      body: "Join the `visual-precision` channel.",
      actorName: recipient,
      metadata: {
        deliveryRequestId: `deliver-${id}`,
        targetDisplayName: recipient,
      },
      ...overrides,
    });
  }

  test("folds one kickoff's per-recipient deliveries into a single row", () => {
    const rows = buildConversationFeedRows([
      message({ id: "m-1", body: "before", createdAt: at - 5_000 }),
      delivery("d-1", "hudson-hegel-6", { createdAt: at }),
      delivery("d-2", "vox-zeno-2", { createdAt: at + 10 }),
      delivery("d-3", "linea-wagner-3", { createdAt: at + 206 }),
      message({ id: "m-2", body: "after", createdAt: at + 9_000 }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["message", "fanout", "message"]);
    const fanout = rows[1];
    if (fanout?.kind !== "fanout") throw new Error("expected a fan-out row");
    expect(fanout.recipients).toEqual(["hudson-hegel-6", "vox-zeno-2", "linea-wagner-3"]);
    expect(fanout.messages).toHaveLength(3);
    expect(fanout.createdAt).toBe(at);
  });

  test("carries the previous row's timestamp so day dividers survive folding", () => {
    const rows = buildConversationFeedRows([
      message({ id: "m-1", createdAt: at - 5_000 }),
      delivery("d-1", "a", { createdAt: at }),
      delivery("d-2", "b", { createdAt: at + 10 }),
      message({ id: "m-2", createdAt: at + 9_000 }),
    ]);

    expect(rows[1]?.previousCreatedAt).toBe(at - 5_000);
    // The row after a fan-out sees the *last* delivery, not the first.
    expect(rows[2]?.previousCreatedAt).toBe(at + 10);
  });

  test("keeps authored turns apart even when their text matches", () => {
    // No deliveryRequestId — two agents that genuinely said the same thing are
    // two turns, and folding them would put words in one agent's mouth.
    const rows = buildConversationFeedRows([
      message({ id: "m-1", body: "ack", actorName: "One" }),
      message({ id: "m-2", body: "ack", actorName: "Two", createdAt: at + 10 }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["message", "message"]);
  });

  test("does not fold deliveries whose text or timing differ", () => {
    const spread = buildConversationFeedRows([
      delivery("d-1", "a", { createdAt: at }),
      delivery("d-2", "b", { createdAt: at + 61_000 }),
    ]);
    expect(spread.map((row) => row.kind)).toEqual(["message", "message"]);

    const distinct = buildConversationFeedRows([
      delivery("d-1", "a", { createdAt: at }),
      delivery("d-2", "b", { body: "a different kickoff", createdAt: at + 10 }),
    ]);
    expect(distinct.map((row) => row.kind)).toEqual(["message", "message"]);
  });

  test("measures the run against its head, not the delivery before it", () => {
    // Each step is inside the window but the run is not: chaining step-to-step
    // lets a slow trickle of resends walk the window forward without limit.
    const rows = buildConversationFeedRows([
      delivery("d-1", "a", { createdAt: at }),
      delivery("d-2", "b", { createdAt: at + 50_000 }),
      delivery("d-3", "c", { createdAt: at + 100_000 }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["fanout", "message"]);
    const fanout = rows[0];
    if (fanout?.kind !== "fanout") throw new Error("expected a fan-out row");
    expect(fanout.messages.map((message) => message.id)).toEqual(["d-1", "d-2"]);
  });

  test("keeps a repeat send to the same recipient in its own row", () => {
    // Nothing on the record ties the legs of one dispatch together, so the test
    // is who was addressed: a dispatch reaches each recipient once. A second
    // delivery to a recipient already covered is a resend, not another leg.
    const rows = buildConversationFeedRows([
      delivery("d-1", "hudson-hegel-6", {
        metadata: { deliveryRequestId: "deliver-d-1", relayTarget: "session-hudson" },
      }),
      delivery("d-2", "hudson-hegel-6", {
        createdAt: at + 30_000,
        metadata: { deliveryRequestId: "deliver-d-2", relayTarget: "session-hudson" },
      }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["message", "message"]);
  });

  test("resumes folding after a resend interrupts a run", () => {
    const rows = buildConversationFeedRows([
      delivery("d-1", "a"),
      delivery("d-2", "b", { createdAt: at + 10 }),
      delivery("d-3", "a", { createdAt: at + 20 }),
      delivery("d-4", "b", { createdAt: at + 30 }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["fanout", "fanout"]);
    const [first, second] = rows;
    if (first?.kind !== "fanout" || second?.kind !== "fanout") {
      throw new Error("expected two fan-out rows");
    }
    expect(first.messages.map((message) => message.id)).toEqual(["d-1", "d-2"]);
    expect(second.messages.map((message) => message.id)).toEqual(["d-3", "d-4"]);
  });

  test("leaves a lone delivery as an ordinary message row", () => {
    const rows = buildConversationFeedRows([delivery("d-1", "solo")]);
    expect(rows.map((row) => row.kind)).toEqual(["message"]);
  });

  test("gives a collapsed fan-out the divider when it opens a new day", () => {
    // A folded run used to skip the divider entirely, which backdated it and
    // everything under it to the previous day.
    const rows = buildConversationFeedRows([
      message({ id: "m-1", body: "yesterday", createdAt: at - oneDay }),
      delivery("d-1", "a", { createdAt: at }),
      delivery("d-2", "b", { createdAt: at + 10 }),
      message({ id: "m-2", body: "later", createdAt: at + 9_000 }),
    ]);

    expect(rows.map((row, index) => shouldShowThreadDayDivider(row, index)))
      .toEqual([true, true, false]);
    expect(feedRowCreatedAt(rows[1]!)).toBe(at);
  });

  test("gives a collapsed fan-out no divider mid-day", () => {
    const rows = buildConversationFeedRows([
      message({ id: "m-1", body: "earlier", createdAt: at - 5_000 }),
      delivery("d-1", "a", { createdAt: at }),
      delivery("d-2", "b", { createdAt: at + 10 }),
    ]);

    expect(rows.map((row, index) => shouldShowThreadDayDivider(row, index)))
      .toEqual([true, false]);
  });

  test("names a recipient even when the record has no display name", () => {
    const rows = buildConversationFeedRows([
      message({
        id: "d-1",
        actorName: "Fallback Actor",
        metadata: { deliveryRequestId: "deliver-1", relayTarget: "session-abc" },
      }),
      message({
        id: "d-2",
        actorName: "Second Actor",
        createdAt: at + 10,
        metadata: { deliveryRequestId: "deliver-2" },
      }),
    ]);

    const fanout = rows[0];
    if (fanout?.kind !== "fanout") throw new Error("expected a fan-out row");
    expect(fanout.recipients).toEqual(["session-abc", "Second Actor"]);
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
    nearBottom: true,
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

  test("does not steal a reader's position in history", () => {
    expect(resolveConversationAutoscroll({
      ...settled,
      newestMessageId: "msg-0451",
      nearBottom: false,
    })).toBe("none");
    expect(resolveConversationAutoscroll({
      ...settled,
      showTyping: true,
      nearBottom: false,
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
      nearBottom: false,
    })).toBe("instant");
    expect(resolveConversationAutoscroll({
      newestMessageId: null,
      previousNewestMessageId: null,
      showTyping: false,
      previousShowTyping: false,
      historyRestorePending: false,
      initialScrollDone: false,
      nearBottom: false,
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
  test("does not create a feed receipt for successful completion", () => {
    expect(terminalTurnReceiptForFlight(completedFlight)).toBeNull();
    expect(terminalTurnReceiptForFlight({
      ...completedFlight,
      messageId: null,
      summary: null,
    })).toBeNull();
  });

  test("failed runs keep an interruption receipt", () => {
    const receipt = terminalTurnReceiptForFlight({ ...completedFlight, state: "failed" });

    expect(receipt).toEqual(expect.objectContaining({
      label: "Run failed",
      tone: "failed",
    }));
  });

  test("cancelled runs keep an interruption receipt", () => {
    const receipt = terminalTurnReceiptForFlight({ ...completedFlight, state: "cancelled" });

    expect(receipt).toEqual(expect.objectContaining({
      label: "Cancelled",
      tone: "cancelled",
    }));
  });
});
