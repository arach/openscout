import { test, expect, describe } from "bun:test";
import { StateTracker } from "./state.ts";
import type {
  Session,
  DispatchEvent,
  TextBlock,
  ReasoningBlock,
  ActionBlock,
  ErrorBlock,
  FileBlock,
} from "../protocol/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(id = "sess-1"): Session {
  return {
    id,
    name: "Test Session",
    adapterType: "test",
    status: "active",
    cwd: "/tmp",
  };
}

function makeTracker(sessionId = "sess-1"): StateTracker {
  const tracker = new StateTracker();
  tracker.createSession(sessionId, makeSession(sessionId));
  return tracker;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

describe("StateTracker — session lifecycle", () => {
  test("createSession initializes empty state", () => {
    const tracker = makeTracker();
    const state = tracker.getSessionState("sess-1");
    expect(state).not.toBeNull();
    expect(state!.session.id).toBe("sess-1");
    expect(state!.turns).toHaveLength(0);
    expect(state!.currentTurnId).toBeUndefined();
  });

  test("getSessionState returns null for unknown session", () => {
    const tracker = new StateTracker();
    expect(tracker.getSessionState("nope")).toBeNull();
  });

  test("removeSession deletes state", () => {
    const tracker = makeTracker();
    tracker.removeSession("sess-1");
    expect(tracker.getSessionState("sess-1")).toBeNull();
  });

  test("session:update replaces session data", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "session:update",
      session: { ...makeSession(), status: "idle", name: "Updated" },
    });
    const state = tracker.getSessionState("sess-1")!;
    expect(state.session.status).toBe("idle");
    expect(state.session.name).toBe("Updated");
  });

  test("session:closed sets status to closed", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", { event: "session:closed", sessionId: "sess-1" });
    expect(tracker.getSessionState("sess-1")!.session.status).toBe("closed");
  });

  test("trackEvent is no-op for unknown session", () => {
    const tracker = new StateTracker();
    // Should not throw.
    tracker.trackEvent("ghost", { event: "session:closed", sessionId: "ghost" });
  });
});

// ---------------------------------------------------------------------------
// Turn lifecycle
// ---------------------------------------------------------------------------

describe("StateTracker — turn lifecycle", () => {
  test("turn:start creates a new streaming turn", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: {
        id: "turn-1",
        sessionId: "sess-1",
        status: "started",
        startedAt: new Date().toISOString(),
        blocks: [],
      },
    });

    const state = tracker.getSessionState("sess-1")!;
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]!.id).toBe("turn-1");
    expect(state.turns[0]!.status).toBe("streaming");
    expect(state.currentTurnId).toBe("turn-1");
  });

  test("turn:end marks turn completed and clears currentTurnId", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });
    tracker.trackEvent("sess-1", {
      event: "turn:end",
      sessionId: "sess-1",
      turnId: "t1",
      status: "completed",
    });

    const state = tracker.getSessionState("sess-1")!;
    expect(state.turns[0]!.status).toBe("completed");
    expect(state.turns[0]!.endedAt).toBeNumber();
    expect(state.currentTurnId).toBeUndefined();
  });

  test("turn:end with stopped maps to interrupted", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });
    tracker.trackEvent("sess-1", {
      event: "turn:end",
      sessionId: "sess-1",
      turnId: "t1",
      status: "stopped",
    });
    expect(tracker.getSessionState("sess-1")!.turns[0]!.status).toBe("interrupted");
  });

  test("turn:end with failed maps to error", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });
    tracker.trackEvent("sess-1", {
      event: "turn:end",
      sessionId: "sess-1",
      turnId: "t1",
      status: "failed",
    });
    expect(tracker.getSessionState("sess-1")!.turns[0]!.status).toBe("error");
  });

  test("turn:error marks turn as error", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });
    tracker.trackEvent("sess-1", {
      event: "turn:error",
      sessionId: "sess-1",
      turnId: "t1",
      message: "something broke",
    });

    const state = tracker.getSessionState("sess-1")!;
    expect(state.turns[0]!.status).toBe("error");
    expect(state.currentTurnId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Block lifecycle — text accumulation
// ---------------------------------------------------------------------------

describe("StateTracker — text block accumulation", () => {
  test("block:start + text deltas + block:end accumulates full text", () => {
    const tracker = makeTracker();

    // Start a turn.
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });

    // Start a text block.
    const textBlock: TextBlock = {
      id: "b1",
      turnId: "t1",
      type: "text",
      text: "",
      status: "streaming",
      index: 0,
    };
    tracker.trackEvent("sess-1", {
      event: "block:start",
      sessionId: "sess-1",
      turnId: "t1",
      block: textBlock,
    });

    // Stream text deltas.
    tracker.trackEvent("sess-1", {
      event: "block:delta",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "b1",
      text: "Hello, ",
    });
    tracker.trackEvent("sess-1", {
      event: "block:delta",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "b1",
      text: "world!",
    });

    // End the block.
    tracker.trackEvent("sess-1", {
      event: "block:end",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "b1",
      status: "completed",
    });

    const state = tracker.getSessionState("sess-1")!;
    const block = state.turns[0]!.blocks[0]!;
    expect(block.status).toBe("completed");
    expect(block.block.type).toBe("text");
    expect((block.block as TextBlock).text).toBe("Hello, world!");
    expect(block.block.status).toBe("completed");
  });

  test("reasoning block accumulates text via deltas", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });

    const block: ReasoningBlock = {
      id: "r1",
      turnId: "t1",
      type: "reasoning",
      text: "",
      status: "streaming",
      index: 0,
    };
    tracker.trackEvent("sess-1", {
      event: "block:start",
      sessionId: "sess-1",
      turnId: "t1",
      block,
    });
    tracker.trackEvent("sess-1", {
      event: "block:delta",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "r1",
      text: "Let me think...",
    });
    tracker.trackEvent("sess-1", {
      event: "block:end",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "r1",
      status: "completed",
    });

    const bs = tracker.getSessionState("sess-1")!.turns[0]!.blocks[0]!;
    expect((bs.block as ReasoningBlock).text).toBe("Let me think...");
  });
});

// ---------------------------------------------------------------------------
// Block lifecycle — action blocks
// ---------------------------------------------------------------------------

describe("StateTracker — action blocks", () => {
  test("action output and status deltas update the action block", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });

    const actionBlock: ActionBlock = {
      id: "a1",
      turnId: "t1",
      type: "action",
      status: "streaming",
      index: 0,
      action: {
        kind: "command",
        command: "ls -la",
        status: "running",
        output: "",
      },
    };
    tracker.trackEvent("sess-1", {
      event: "block:start",
      sessionId: "sess-1",
      turnId: "t1",
      block: actionBlock,
    });

    // Stream output.
    tracker.trackEvent("sess-1", {
      event: "block:action:output",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "a1",
      output: "file1.txt\n",
    });
    tracker.trackEvent("sess-1", {
      event: "block:action:output",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "a1",
      output: "file2.txt\n",
    });

    // Status change.
    tracker.trackEvent("sess-1", {
      event: "block:action:status",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "a1",
      status: "completed",
    });

    // End block.
    tracker.trackEvent("sess-1", {
      event: "block:end",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "a1",
      status: "completed",
    });

    const bs = tracker.getSessionState("sess-1")!.turns[0]!.blocks[0]!;
    const action = (bs.block as ActionBlock).action;
    expect(action.kind).toBe("command");
    expect(action.output).toBe("file1.txt\nfile2.txt\n");
    expect(action.status).toBe("completed");
    expect(bs.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Block lifecycle — approval flow
// ---------------------------------------------------------------------------

describe("StateTracker — approval flow", () => {
  test("block:action:approval sets status and approval on action block", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });

    const actionBlock: ActionBlock = {
      id: "a1",
      turnId: "t1",
      type: "action",
      status: "streaming",
      index: 0,
      action: {
        kind: "command",
        command: "rm -rf build/",
        status: "pending",
        output: "",
      },
    };
    tracker.trackEvent("sess-1", {
      event: "block:start",
      sessionId: "sess-1",
      turnId: "t1",
      block: actionBlock,
    });

    // Emit approval delta.
    tracker.trackEvent("sess-1", {
      event: "block:action:approval",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "a1",
      approval: { version: 1, description: "Delete build directory", risk: "high" },
    });

    const bs = tracker.getSessionState("sess-1")!.turns[0]!.blocks[0]!;
    const action = (bs.block as ActionBlock).action;
    expect(action.status).toBe("awaiting_approval");
    expect(action.approval).toBeDefined();
    expect(action.approval!.version).toBe(1);
    expect(action.approval!.description).toBe("Delete build directory");
    expect(action.approval!.risk).toBe("high");
  });

  test("approval then status transition updates action correctly", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });

    const actionBlock: ActionBlock = {
      id: "a1",
      turnId: "t1",
      type: "action",
      status: "streaming",
      index: 0,
      action: {
        kind: "tool_call",
        toolName: "deploy",
        toolCallId: "tc-1",
        status: "pending",
        output: "",
      },
    };
    tracker.trackEvent("sess-1", {
      event: "block:start",
      sessionId: "sess-1",
      turnId: "t1",
      block: actionBlock,
    });

    // Transition to awaiting_approval.
    tracker.trackEvent("sess-1", {
      event: "block:action:approval",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "a1",
      approval: { version: 1, description: "Deploy to prod", risk: "high" },
    });

    let action = (tracker.getSessionState("sess-1")!.turns[0]!.blocks[0]!.block as ActionBlock).action;
    expect(action.status).toBe("awaiting_approval");

    // Approve — transition to running.
    tracker.trackEvent("sess-1", {
      event: "block:action:status",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "a1",
      status: "running",
    });

    action = (tracker.getSessionState("sess-1")!.turns[0]!.blocks[0]!.block as ActionBlock).action;
    expect(action.status).toBe("running");

    // Complete.
    tracker.trackEvent("sess-1", {
      event: "block:action:status",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "a1",
      status: "completed",
    });

    action = (tracker.getSessionState("sess-1")!.turns[0]!.blocks[0]!.block as ActionBlock).action;
    expect(action.status).toBe("completed");
  });

  test("approval on non-action block is a no-op", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });

    const textBlock: TextBlock = {
      id: "b1",
      turnId: "t1",
      type: "text",
      text: "",
      status: "streaming",
      index: 0,
    };
    tracker.trackEvent("sess-1", {
      event: "block:start",
      sessionId: "sess-1",
      turnId: "t1",
      block: textBlock,
    });

    // Should not throw.
    tracker.trackEvent("sess-1", {
      event: "block:action:approval",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "b1",
      approval: { version: 1 },
    });

    // Text block should be unchanged.
    const bs = tracker.getSessionState("sess-1")!.turns[0]!.blocks[0]!;
    expect(bs.block.type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Block lifecycle — other block types
// ---------------------------------------------------------------------------

describe("StateTracker — file and error blocks", () => {
  test("file block is tracked on block:start", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });

    const fileBlock: FileBlock = {
      id: "f1",
      turnId: "t1",
      type: "file",
      mimeType: "image/png",
      name: "screenshot.png",
      data: "base64data",
      status: "completed",
      index: 0,
    };
    tracker.trackEvent("sess-1", {
      event: "block:start",
      sessionId: "sess-1",
      turnId: "t1",
      block: fileBlock,
    });

    const bs = tracker.getSessionState("sess-1")!.turns[0]!.blocks[0]!;
    expect(bs.block.type).toBe("file");
    expect((bs.block as FileBlock).mimeType).toBe("image/png");
    expect(bs.status).toBe("completed");
  });

  test("error block is tracked correctly", () => {
    const tracker = makeTracker();
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });

    const errorBlock: ErrorBlock = {
      id: "e1",
      turnId: "t1",
      type: "error",
      message: "Out of tokens",
      code: "TOKEN_LIMIT",
      status: "completed",
      index: 0,
    };
    tracker.trackEvent("sess-1", {
      event: "block:start",
      sessionId: "sess-1",
      turnId: "t1",
      block: errorBlock,
    });

    const bs = tracker.getSessionState("sess-1")!.turns[0]!.blocks[0]!;
    expect(bs.block.type).toBe("error");
    expect((bs.block as ErrorBlock).message).toBe("Out of tokens");
  });
});

// ---------------------------------------------------------------------------
// Partial snapshot (mid-stream)
// ---------------------------------------------------------------------------

describe("StateTracker — partial snapshots", () => {
  test("snapshot reflects partial state during streaming", () => {
    const tracker = makeTracker();

    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });

    const textBlock: TextBlock = {
      id: "b1",
      turnId: "t1",
      type: "text",
      text: "",
      status: "streaming",
      index: 0,
    };
    tracker.trackEvent("sess-1", {
      event: "block:start",
      sessionId: "sess-1",
      turnId: "t1",
      block: textBlock,
    });

    tracker.trackEvent("sess-1", {
      event: "block:delta",
      sessionId: "sess-1",
      turnId: "t1",
      blockId: "b1",
      text: "Partial content...",
    });

    // Take snapshot mid-stream (no block:end, no turn:end).
    const state = tracker.getSessionState("sess-1")!;
    expect(state.currentTurnId).toBe("t1");
    expect(state.turns[0]!.status).toBe("streaming");
    expect(state.turns[0]!.blocks[0]!.status).toBe("streaming");
    expect((state.turns[0]!.blocks[0]!.block as TextBlock).text).toBe("Partial content...");
  });
});

// ---------------------------------------------------------------------------
// Session summaries
// ---------------------------------------------------------------------------

describe("StateTracker — session summaries", () => {
  test("getAllSessionSummaries returns summaries for all sessions", () => {
    const tracker = new StateTracker();
    tracker.createSession("s1", makeSession("s1"));
    tracker.createSession("s2", { ...makeSession("s2"), name: "Session Two" });

    // Add a turn to s1.
    tracker.trackEvent("s1", {
      event: "turn:start",
      sessionId: "s1",
      turn: { id: "t1", sessionId: "s1", status: "started", startedAt: "", blocks: [] },
    });

    const summaries = tracker.getAllSessionSummaries();
    expect(summaries).toHaveLength(2);

    const s1 = summaries.find((s) => s.sessionId === "s1")!;
    expect(s1.turnCount).toBe(1);
    expect(s1.currentTurnStatus).toBe("streaming");
    expect(s1.adapterType).toBe("test");

    const s2 = summaries.find((s) => s.sessionId === "s2")!;
    expect(s2.turnCount).toBe(0);
    expect(s2.currentTurnStatus).toBeUndefined();
    expect(s2.name).toBe("Session Two");
  });
});

// ---------------------------------------------------------------------------
// Full realistic flow
// ---------------------------------------------------------------------------

describe("StateTracker — full realistic flow", () => {
  test("multi-turn session with mixed block types", () => {
    const tracker = makeTracker();

    // Turn 1: text response with reasoning.
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t1", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });

    // Reasoning block (completed immediately, as Claude Code does).
    const reasoning: ReasoningBlock = {
      id: "r1", turnId: "t1", type: "reasoning", text: "Thinking...", status: "completed", index: 0,
    };
    tracker.trackEvent("sess-1", { event: "block:start", sessionId: "sess-1", turnId: "t1", block: reasoning });
    tracker.trackEvent("sess-1", { event: "block:end", sessionId: "sess-1", turnId: "t1", blockId: "r1", status: "completed" });

    // Text response streamed.
    const text: TextBlock = {
      id: "b1", turnId: "t1", type: "text", text: "", status: "streaming", index: 1,
    };
    tracker.trackEvent("sess-1", { event: "block:start", sessionId: "sess-1", turnId: "t1", block: text });
    tracker.trackEvent("sess-1", { event: "block:delta", sessionId: "sess-1", turnId: "t1", blockId: "b1", text: "I'll " });
    tracker.trackEvent("sess-1", { event: "block:delta", sessionId: "sess-1", turnId: "t1", blockId: "b1", text: "edit the file." });
    tracker.trackEvent("sess-1", { event: "block:end", sessionId: "sess-1", turnId: "t1", blockId: "b1", status: "completed" });

    // Action: file edit.
    const action: ActionBlock = {
      id: "a1", turnId: "t1", type: "action", status: "streaming", index: 2,
      action: { kind: "file_change", path: "/src/index.ts", status: "running", output: "" },
    };
    tracker.trackEvent("sess-1", { event: "block:start", sessionId: "sess-1", turnId: "t1", block: action });
    tracker.trackEvent("sess-1", { event: "block:action:output", sessionId: "sess-1", turnId: "t1", blockId: "a1", output: "+const x = 1;\n" });
    tracker.trackEvent("sess-1", { event: "block:action:status", sessionId: "sess-1", turnId: "t1", blockId: "a1", status: "completed" });
    tracker.trackEvent("sess-1", { event: "block:end", sessionId: "sess-1", turnId: "t1", blockId: "a1", status: "completed" });

    // End turn 1.
    tracker.trackEvent("sess-1", { event: "turn:end", sessionId: "sess-1", turnId: "t1", status: "completed" });

    // Turn 2: interrupted turn.
    tracker.trackEvent("sess-1", {
      event: "turn:start",
      sessionId: "sess-1",
      turn: { id: "t2", sessionId: "sess-1", status: "started", startedAt: "", blocks: [] },
    });
    const text2: TextBlock = {
      id: "b2", turnId: "t2", type: "text", text: "", status: "streaming", index: 0,
    };
    tracker.trackEvent("sess-1", { event: "block:start", sessionId: "sess-1", turnId: "t2", block: text2 });
    tracker.trackEvent("sess-1", { event: "block:delta", sessionId: "sess-1", turnId: "t2", blockId: "b2", text: "Starting to..." });
    tracker.trackEvent("sess-1", { event: "turn:end", sessionId: "sess-1", turnId: "t2", status: "stopped" });

    // Verify final state.
    const state = tracker.getSessionState("sess-1")!;

    expect(state.turns).toHaveLength(2);
    expect(state.currentTurnId).toBeUndefined();

    // Turn 1: completed with 3 blocks.
    const t1 = state.turns[0]!;
    expect(t1.status).toBe("completed");
    expect(t1.blocks).toHaveLength(3);
    expect((t1.blocks[0]!.block as ReasoningBlock).text).toBe("Thinking...");
    expect((t1.blocks[1]!.block as TextBlock).text).toBe("I'll edit the file.");
    expect((t1.blocks[2]!.block as ActionBlock).action.output).toBe("+const x = 1;\n");
    expect((t1.blocks[2]!.block as ActionBlock).action.status).toBe("completed");

    // Turn 2: interrupted with partial text.
    const t2 = state.turns[1]!;
    expect(t2.status).toBe("interrupted");
    expect(t2.blocks).toHaveLength(1);
    expect((t2.blocks[0]!.block as TextBlock).text).toBe("Starting to...");
    expect(t2.blocks[0]!.status).toBe("streaming"); // Never got block:end.
  });
});
