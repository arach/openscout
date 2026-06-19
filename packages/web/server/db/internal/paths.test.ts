import { describe, expect, test } from "bun:test";

import { isTransportSessionRef, resolveHarnessSessionId } from "./paths.ts";

describe("resolveHarnessSessionId", () => {
  test("keeps tmux attach refs on terminalSurface only", () => {
    expect(resolveHarnessSessionId("tmux", "relay-agent-1-claude", {
      tmuxSession: "relay-agent-1-claude",
    })).toBeNull();
  });

  test("returns provider thread ids for codex app server", () => {
    expect(resolveHarnessSessionId("codex_app_server", "relay-runtime-codex", {
      threadId: "019d9762-19f7-7792-8962-90d924ce7faa",
      runtimeInstanceId: "relay-runtime-codex",
    })).toBe("019d9762-19f7-7792-8962-90d924ce7faa");
  });

  test("drops relay runtime ids when no provider session is known", () => {
    expect(resolveHarnessSessionId("codex_app_server", "relay-runtime-codex", {
      runtimeInstanceId: "relay-runtime-codex",
    })).toBeNull();
  });

  test("prefers externalSessionId for claude stream workers", () => {
    expect(resolveHarnessSessionId("claude_stream_json", "relay-agent-claude", {
      externalSessionId: "claude-sess-live",
      runtimeInstanceId: "relay-agent-claude",
    })).toBe("claude-sess-live");
  });
});

describe("isTransportSessionRef", () => {
  test("detects legacy relay-prefixed runtime refs", () => {
    expect(isTransportSessionRef("relay-agent-1-claude")).toBe(true);
    expect(isTransportSessionRef("claude-sess-live")).toBe(false);
  });
});