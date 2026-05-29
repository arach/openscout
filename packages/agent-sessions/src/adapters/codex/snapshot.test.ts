import { describe, expect, test } from "bun:test";

import {
  normalizeCodexAppServerLaunchArgs,
  readCodexAppServerReasoningEffortFromLaunchArgs,
} from "./launch-args.js";
import {
  buildCodexAppServerSessionSnapshot,
  buildCodexRolloutSessionSnapshot,
} from "./snapshot.js";

describe("Codex app-server adapter helpers", () => {
  test("normalizes model and reasoning launch args into Codex config overrides", () => {
    const launchArgs = normalizeCodexAppServerLaunchArgs([
      "--model",
      "gpt-5.4-mini",
      "--reasoning-effort",
      "high",
    ]);

    expect(launchArgs).toEqual([
      "-c",
      "model=\"gpt-5.4-mini\"",
      "-c",
      "model_reasoning_effort=\"high\"",
    ]);
    expect(readCodexAppServerReasoningEffortFromLaunchArgs(launchArgs)).toBe("high");
  });

  test("projects app-server stdout JSONL into a shared session snapshot", () => {
    const raw = [
      JSON.stringify({
        id: "1",
        result: {
          thread: {
            id: "thread-1",
            path: "/tmp/thread-1.jsonl",
            cwd: "/repo",
          },
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        method: "turn/started",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "inProgress" },
        },
      }),
      JSON.stringify({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "agentMessage", id: "msg-1", text: "hello" },
        },
      }),
      JSON.stringify({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "completed", error: null },
        },
      }),
    ].join("\n");

    const snapshot = buildCodexAppServerSessionSnapshot(raw, {
      agentName: "codex",
      sessionId: "session-1",
      cwd: "/repo",
    }, "thread-1");

    expect(snapshot?.session.adapterType).toBe("codex_app_server");
    expect(snapshot?.session.model).toBe("gpt-5.4");
    expect(snapshot?.turns[0]?.status).toBe("completed");
    expect(snapshot?.turns[0]?.blocks[0]?.block.type).toBe("text");
    if (snapshot?.turns[0]?.blocks[0]?.block.type === "text") {
      expect(snapshot.turns[0].blocks[0].block.text).toBe("hello");
    }
  });

  test("projects Codex rollout JSONL into the same session snapshot shape", () => {
    const raw = [
      JSON.stringify({
        timestamp: "2026-04-17T01:54:38.000Z",
        type: "session_meta",
        payload: { id: "thread-1", cwd: "/repo" },
      }),
      JSON.stringify({
        timestamp: "2026-04-17T01:54:38.100Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-1",
          started_at: "2026-04-17T01:54:38.100Z",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-17T01:54:38.200Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "from rollout" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-17T01:54:38.300Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          completed_at: "2026-04-17T01:54:38.300Z",
        },
      }),
    ].join("\n");

    const snapshot = buildCodexRolloutSessionSnapshot(
      raw,
      {
        agentName: "codex",
        sessionId: "session-1",
        cwd: "/repo",
      },
      "thread-1",
      "/tmp/thread-1.jsonl",
    );

    expect(snapshot?.session.providerMeta?.threadPath).toBe("/tmp/thread-1.jsonl");
    expect(snapshot?.turns[0]?.status).toBe("completed");
    expect(snapshot?.turns[0]?.blocks[0]?.block.type).toBe("text");
    if (snapshot?.turns[0]?.blocks[0]?.block.type === "text") {
      expect(snapshot.turns[0].blocks[0].block.text).toBe("from rollout");
    }
  });
});
