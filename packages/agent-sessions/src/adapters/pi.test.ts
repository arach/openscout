import { describe, expect, test } from "bun:test";

import { StateTracker } from "../state.ts";
import { buildPiProcessEnv, PiAdapter } from "./pi.ts";

describe("buildPiProcessEnv", () => {
  test("passes only MiniMax API key credentials for the MiniMax provider", () => {
    const env = buildPiProcessEnv(
      {
        env: {
          PATH: "/custom/bin",
          GITHUB_TOKEN: "do-not-forward",
          MINIMAX_API_KEY: "adapter-key",
          OPENAI_API_KEY: "do-not-forward",
        },
        options: {
          provider: "minimax",
          model: "MiniMax-M2.7",
        },
      },
      {
        HOME: "/Users/tester",
        PATH: "/usr/bin",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        MINIMAX_TOKEN: "source-token",
        ANTHROPIC_API_KEY: "do-not-forward",
      },
    );

    expect(env.PATH).toBe("/custom/bin");
    expect(env.HOME).toBe("/Users/tester");
    expect(env.MINIMAX_API_KEY).toBe("adapter-key");
    expect(env).not.toHaveProperty("MINIMAX_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("SSH_AUTH_SOCK");
  });

  test("maps MINIMAX_TOKEN to MINIMAX_API_KEY without forwarding the alias", () => {
    const env = buildPiProcessEnv(
      {
        env: {
          MINIMAX_TOKEN: "adapter-token",
        },
        options: {
          provider: "minimax",
        },
      },
      {
        MINIMAX_API_KEY: "source-key",
      },
    );

    expect(env.MINIMAX_API_KEY).toBe("adapter-token");
    expect(env).not.toHaveProperty("MINIMAX_TOKEN");
  });

  test("forwards XAI_API_KEY for Grok models", () => {
    const env = buildPiProcessEnv(
      {
        env: {
          XAI_API_KEY: "adapter-xai-key",
        },
        options: {
          model: "grok-4.3",
        },
      },
      {
        XAI_API_KEY: "source-xai-key",
      },
    );

    expect(env.XAI_API_KEY).toBe("adapter-xai-key");
  });

  test("does not forward provider credentials when no provider can be inferred", () => {
    const env = buildPiProcessEnv(
      {
        env: {
          MINIMAX_API_KEY: "do-not-forward",
        },
        options: {
          model: "unknown-model",
        },
      },
      {
        OPENAI_API_KEY: "do-not-forward",
      },
    );

    expect(env).not.toHaveProperty("MINIMAX_API_KEY");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });
});

describe("PiAdapter event mapping", () => {
  test("projects final assistant message records into text blocks", () => {
    const adapter = new PiAdapter({
      sessionId: "pi-session-1",
      name: "Pi test",
      cwd: "/Users/tester/project",
    });
    const tracker = new StateTracker();
    tracker.createSession(adapter.session.id, adapter.session);
    adapter.on("event", (event) => {
      tracker.trackEvent(adapter.session.id, event);
    });

    const handleEvent = (adapter as unknown as { handleEvent(event: unknown): void }).handleEvent.bind(adapter);
    handleEvent({ type: "turn_start" });
    handleEvent({
      type: "message",
      provider: "minimax",
      model: "MiniMax-M3",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private reasoning should not render" },
          { type: "text", text: "Smoke test reply from Pi." },
        ],
      },
    });
    handleEvent({ type: "turn_end" });

    const snapshot = tracker.getSessionState(adapter.session.id);
    const turn = snapshot?.turns[0];
    const block = turn?.blocks[0]?.block;
    expect(snapshot?.session.model).toBe("MiniMax-M3");
    expect(snapshot?.session.providerMeta?.provider).toBe("minimax");
    expect(turn?.status).toBe("completed");
    expect(block).toEqual(expect.objectContaining({
      type: "text",
      text: "Smoke test reply from Pi.",
      status: "completed",
    }));
  });

  test("keeps tool-use turns observable and projects the following final turn", () => {
    const adapter = new PiAdapter({
      sessionId: "pi-session-2",
      name: "Pi test",
      cwd: "/Users/tester/project",
    });
    const tracker = new StateTracker();
    tracker.createSession(adapter.session.id, adapter.session);
    adapter.on("event", (event) => {
      tracker.trackEvent(adapter.session.id, event);
    });

    const handleEvent = (adapter as unknown as { handleEvent(event: unknown): void }).handleEvent.bind(adapter);
    handleEvent({
      type: "response",
      command: "get_state",
      success: true,
      data: {
        sessionId: "review-pi",
        sessionFile: "/Users/tester/project/pi-sessions/review-pi.jsonl",
        followUpMode: "one-at-a-time",
        pendingMessageCount: 0,
      },
    });
    handleEvent({ type: "turn_start" });
    handleEvent({
      type: "message_update",
      message: {
        role: "assistant",
        provider: "minimax",
        model: "MiniMax-M3",
        content: [
          { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } },
        ],
      },
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 0 },
    });
    handleEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "pwd" },
    });
    handleEvent({
      type: "tool_execution_update",
      toolCallId: "call-1",
      toolName: "bash",
      partialResult: { content: [{ type: "text", text: "/Users/tester/project\n" }] },
    });
    handleEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "/Users/tester/project\n" }] },
      exitCode: 0,
    });
    handleEvent({
      type: "turn_end",
      message: {
        role: "assistant",
        provider: "minimax",
        model: "MiniMax-M3",
        stopReason: "toolUse",
        content: [
          { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } },
        ],
      },
      toolResults: [
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "bash",
          content: [{ type: "text", text: "/Users/tester/project\n" }],
          isError: false,
        },
      ],
    });
    handleEvent({ type: "turn_start" });
    handleEvent({
      type: "turn_end",
      message: {
        role: "assistant",
        provider: "minimax",
        model: "MiniMax-M3",
        stopReason: "stop",
        content: [{ type: "text", text: "FINAL: workspace is clean." }],
      },
      toolResults: [],
    });

    const snapshot = tracker.getSessionState(adapter.session.id);
    expect(snapshot?.session.providerMeta?.externalSessionId).toBe("review-pi");
    expect(snapshot?.session.providerMeta?.threadPath).toBe("/Users/tester/project/pi-sessions/review-pi.jsonl");
    expect(snapshot?.session.model).toBe("MiniMax-M3");
    expect(snapshot?.turns).toHaveLength(2);
    expect(snapshot?.turns[0]?.status).toBe("completed");
    expect(snapshot?.turns[0]?.blocks[0]?.block).toEqual(expect.objectContaining({
      type: "action",
      action: expect.objectContaining({
        kind: "command",
        command: "pwd",
        output: "/Users/tester/project\n",
        status: "completed",
      }),
    }));
    expect(snapshot?.turns[1]?.blocks[0]?.block).toEqual(expect.objectContaining({
      type: "text",
      text: "FINAL: workspace is clean.",
      status: "completed",
    }));
  });
});
