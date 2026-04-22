import { describe, expect, test } from "bun:test";

import {
  createHistorySessionSnapshot,
  inferHistorySessionAdapterType,
  supportsHistorySessionSnapshotForPath,
} from "./history.ts";

describe("history snapshot replay", () => {
  test("reconstructs a unified Claude Code snapshot from external jsonl history", () => {
    const basePath = "/Users/arach/.claude/projects/-Users-arach-dev-openscout/session-123.jsonl";
    const content = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        timestamp: "2026-04-22T12:00:00.000Z",
        session_id: "claude-upstream-session",
        cwd: "/Users/arach/dev/openscout",
        model: "claude-sonnet-test",
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-22T12:00:01.000Z",
        message: { role: "user", content: "summarize the repo" },
      }),
      JSON.stringify({
        type: "stream_event",
        timestamp: "2026-04-22T12:00:02.000Z",
        event: { type: "message_start" },
      }),
      JSON.stringify({
        type: "stream_event",
        timestamp: "2026-04-22T12:00:02.100Z",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        timestamp: "2026-04-22T12:00:02.200Z",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "hello " },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        timestamp: "2026-04-22T12:00:02.300Z",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "world" },
        },
      }),
      JSON.stringify({
        type: "stream_event",
        timestamp: "2026-04-22T12:00:02.400Z",
        event: { type: "content_block_stop", index: 0 },
      }),
      JSON.stringify({
        type: "tool_use",
        timestamp: "2026-04-22T12:00:03.000Z",
        tool_name: "Bash",
        tool_use_id: "tool-bash-1",
        input: { command: "pwd" },
      }),
      JSON.stringify({
        type: "tool_result",
        timestamp: "2026-04-22T12:00:03.500Z",
        tool_use_id: "tool-bash-1",
        content: "/Users/arach/dev/openscout",
      }),
      JSON.stringify({
        type: "tool_use",
        timestamp: "2026-04-22T12:00:04.000Z",
        tool_name: "AskUserQuestion",
        tool_use_id: "tool-question-1",
        input: {
          questions: [
            {
              header: "Next step",
              question: "Ship it?",
              options: [{ label: "Yes" }, { label: "No" }],
              multiSelect: false,
            },
          ],
        },
      }),
      JSON.stringify({
        type: "tool_result",
        timestamp: "2026-04-22T12:00:04.500Z",
        tool_use_id: "tool-question-1",
        content: "Yes",
      }),
      JSON.stringify({
        type: "result",
        timestamp: "2026-04-22T12:00:05.000Z",
        subtype: "success",
        is_error: false,
      }),
    ].join("\n");

    const result = createHistorySessionSnapshot({
      path: basePath,
      content,
    });

    expect(result.adapterType).toBe("claude-code");
    expect(result.lineCount).toBe(12);
    expect(result.parsedLineCount).toBe(12);
    expect(result.skippedLineCount).toBe(0);

    const snapshot = result.snapshot;
    expect(snapshot.session.id).toBe(`history:${basePath}`);
    expect(snapshot.session.adapterType).toBe("claude-code");
    expect(snapshot.session.name).toBe("openscout");
    expect(snapshot.session.cwd).toBe("/Users/arach/dev/openscout");
    expect(snapshot.session.model).toBe("claude-sonnet-test");
    expect(snapshot.session.providerMeta).toEqual(
      expect.objectContaining({
        historyPath: basePath,
        historyAdapterType: "claude-code",
        source: "external_history",
        externalSessionId: "claude-upstream-session",
      }),
    );
    expect(snapshot.currentTurnId).toBeUndefined();
    expect(snapshot.turns).toHaveLength(1);

    const turn = snapshot.turns[0]!;
    expect(turn.status).toBe("completed");
    expect(turn.startedAt).toBe(Date.parse("2026-04-22T12:00:01.000Z"));
    expect(turn.endedAt).toBe(Date.parse("2026-04-22T12:00:05.000Z"));
    expect(turn.blocks).toHaveLength(3);

    const textBlock = turn.blocks[0]!.block;
    expect(textBlock.type).toBe("text");
    if (textBlock.type === "text") {
      expect(textBlock.text).toBe("hello world");
      expect(textBlock.status).toBe("completed");
    }

    const commandBlock = turn.blocks[1]!.block;
    expect(commandBlock.type).toBe("action");
    if (commandBlock.type === "action") {
      expect(commandBlock.action.kind).toBe("command");
      expect(commandBlock.action.status).toBe("completed");
      expect(commandBlock.action.output).toBe("/Users/arach/dev/openscout");
    }

    const questionBlock = turn.blocks[2]!.block;
    expect(questionBlock.type).toBe("question");
    if (questionBlock.type === "question") {
      expect(questionBlock.question).toBe("Ship it?");
      expect(questionBlock.questionStatus).toBe("answered");
      expect(questionBlock.answer).toEqual(["Yes"]);
      expect(questionBlock.status).toBe("completed");
    }
  });

  test("marks unsupported harness history clearly", () => {
    const path = "/Users/arach/.codex/history.jsonl";

    expect(inferHistorySessionAdapterType(path)).toBe("codex");
    expect(supportsHistorySessionSnapshotForPath(path)).toBe(false);
    expect(() =>
      createHistorySessionSnapshot({
        path,
        content: `${JSON.stringify({ cwd: "/tmp/project" })}\n`,
      }),
    ).toThrow('History snapshot is not supported for adapter type "codex".');
  });
});
