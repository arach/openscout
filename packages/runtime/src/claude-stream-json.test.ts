import { describe, expect, test } from "bun:test";

import {
  buildClaudeStreamJsonSessionSnapshot,
  resolveClaudeStreamJsonOutput,
} from "./claude-stream-json";

describe("resolveClaudeStreamJsonOutput", () => {
  test("prefers the final result payload over earlier assistant text", () => {
    const output = resolveClaudeStreamJsonOutput(
      "Final answer",
      ["Let me research this.", " Interim note."],
    );

    expect(output).toBe("Final answer");
  });

  test("falls back to accumulated assistant text when the result payload is empty", () => {
    const output = resolveClaudeStreamJsonOutput(
      "   ",
      ["First part.", " Second part."],
    );

    expect(output).toBe("First part. Second part.");
  });
});

describe("buildClaudeStreamJsonSessionSnapshot", () => {
  test("projects reasoning and pending AskUserQuestion blocks from stream-json history", () => {
    const raw = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "claude-session-1",
        cwd: "/repo",
        model: "claude-sonnet-4-6",
      }),
      JSON.stringify({
        type: "stream_event",
        session_id: "claude-session-1",
        event: {
          type: "message_start",
          message: { id: "msg-1" },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        session_id: "claude-session-1",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        session_id: "claude-session-1",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Need an answer." },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        session_id: "claude-session-1",
        event: { type: "content_block_stop", index: 0 },
      }),
      JSON.stringify({
        type: "stream_event",
        session_id: "claude-session-1",
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "toolu_question_1",
            name: "AskUserQuestion",
            input: {},
          },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        session_id: "claude-session-1",
        event: {
          type: "content_block_delta",
          index: 1,
          delta: {
            type: "input_json_delta",
            partial_json: "{\"questions\":[{\"header\":\"Mode\",\"question\":\"Choose one\",\"options\":[{\"label\":\"Ship\"},{\"label\":\"Wait\"}],\"multiSelect\":false}]}",
          },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        session_id: "claude-session-1",
        event: { type: "content_block_stop", index: 1 },
      }),
    ].join("\n");

    const snapshot = buildClaudeStreamJsonSessionSnapshot(raw, {
      agentName: "reviewer",
      sessionId: "relay-reviewer",
      cwd: "/repo",
    }, "claude-session-1");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.session.model).toBe("claude-sonnet-4-6");
    expect(snapshot?.turns).toHaveLength(1);
    expect(snapshot?.turns[0]?.blocks).toHaveLength(2);
    expect(snapshot?.turns[0]?.blocks[0]?.block.type).toBe("reasoning");
    expect(snapshot?.turns[0]?.blocks[0]?.block.type === "reasoning" && snapshot.turns[0].blocks[0].block.text).toBe("Need an answer.");
    expect(snapshot?.turns[0]?.blocks[1]?.block.type).toBe("question");
    if (snapshot?.turns[0]?.blocks[1]?.block.type === "question") {
      expect(snapshot.turns[0].blocks[1].block.id).toBe("toolu_question_1");
      expect(snapshot.turns[0].blocks[1].block.questionStatus).toBe("awaiting_answer");
      expect(snapshot.turns[0].blocks[1].block.options.map((option) => option.label)).toEqual(["Ship", "Wait"]);
    }
  });

  test("ignores non-global history lines without a session id after the target session is known", () => {
    const raw = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "claude-session-1",
        cwd: "/repo",
        model: "claude-sonnet-4-6",
      }),
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "wrong session bleed" },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        session_id: "claude-session-1",
        event: {
          type: "message_start",
          message: { id: "msg-1" },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        session_id: "claude-session-1",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "kept" },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        session_id: "claude-session-1",
        event: {
          type: "content_block_stop",
          index: 0,
        },
      }),
    ].join("\n");

    const snapshot = buildClaudeStreamJsonSessionSnapshot(raw, {
      agentName: "reviewer",
      sessionId: "relay-reviewer",
      cwd: "/repo",
    }, "claude-session-1");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.turns).toHaveLength(1);
    expect(snapshot?.turns[0]?.blocks).toHaveLength(1);
    expect(snapshot?.turns[0]?.blocks[0]?.block.type).toBe("text");
    expect(snapshot?.turns[0]?.blocks[0]?.block.type === "text" && snapshot.turns[0].blocks[0].block.text).toBe("kept");
  });
});
