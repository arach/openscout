import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  MAX_CACHED_MESSAGES_PER_CHAT,
  RECENT_CHAT_PRELOAD_LIMIT,
  clearConversationTailCache,
  hasCachedConversationHistory,
  loadConversationHistory,
  loadConversationTail,
  preloadRecentConversationTails,
  readCachedConversationTail,
  writeCachedConversationTail,
} from "./chat-cache.ts";
import { clearApiGetCache } from "./api.ts";
import type { Message, SessionEntry } from "./types.ts";

function message(id: string, conversationId: string, createdAt: number): Message {
  return {
    id,
    conversationId,
    actorName: "Operator",
    body: id,
    createdAt,
    class: "operator",
  };
}

function conversation(id: string): SessionEntry {
  return {
    id,
    kind: "direct",
    title: id,
    participantIds: [],
    agentId: null,
    agentName: null,
    harness: null,
    harnessSessionId: null,
    harnessLogPath: null,
    currentBranch: null,
    preview: null,
    messageCount: 0,
    lastMessageAt: null,
    workspaceRoot: null,
  };
}

describe("chat tail cache", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearApiGetCache();
    clearConversationTailCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearApiGetCache();
    clearConversationTailCache();
  });

  test("reuses a completed tail request until a refresh is requested", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify([
        message(`msg-${calls}`, "chat-1", calls),
      ]));
    }) as unknown as typeof fetch;

    await expect(loadConversationTail("chat-1")).resolves.toHaveLength(1);
    await expect(loadConversationTail("chat-1")).resolves.toHaveLength(1);
    expect(calls).toBe(1);

    await expect(loadConversationTail("chat-1", { refresh: true })).resolves.toHaveLength(2);
    expect(calls).toBe(2);
  });

  test("hydrates older history once and later merges only the refreshed tail", async () => {
    const requestedLimits: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const limit = url.searchParams.get("limit") ?? "missing";
      requestedLimits.push(limit);
      const messages = limit === String(MAX_CACHED_MESSAGES_PER_CHAT)
        ? [message("msg-old", "chat-1", 1), message("msg-current", "chat-1", 2)]
        : [message("msg-new", "chat-1", 3)];
      return new Response(JSON.stringify(messages));
    }) as unknown as typeof fetch;

    await loadConversationHistory("chat-1");
    await loadConversationHistory("chat-1");
    await loadConversationTail("chat-1", { refresh: true });

    expect(requestedLimits).toEqual([
      String(MAX_CACHED_MESSAGES_PER_CHAT),
      "80",
    ]);
    expect(hasCachedConversationHistory("chat-1")).toBe(true);
    expect(readCachedConversationTail("chat-1")?.map((item) => item.id)).toEqual([
      "msg-old",
      "msg-current",
      "msg-new",
    ]);
  });

  test("keeps only the bounded cached history in stable order", () => {
    const messages = Array.from(
      { length: MAX_CACHED_MESSAGES_PER_CHAT + 5 },
      (_, index) => message(`msg-${String(index).padStart(3, "0")}`, "chat-1", index),
    ).reverse();

    const cached = writeCachedConversationTail("chat-1", messages);

    expect(cached).toHaveLength(MAX_CACHED_MESSAGES_PER_CHAT);
    expect(cached[0]?.createdAt).toBe(5);
    expect(cached.at(-1)?.createdAt).toBe(MAX_CACHED_MESSAGES_PER_CHAT + 4);
  });

  test("preloads only ten recent chats with bounded concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      active++;
      maxActive = Math.max(maxActive, active);
      const url = new URL(String(input), "http://localhost");
      const conversationId = url.searchParams.get("conversationId") ?? "missing";
      requested.push(conversationId);
      await Promise.resolve();
      active--;
      return new Response(JSON.stringify([message(`msg-${conversationId}`, conversationId, 1)]));
    }) as unknown as typeof fetch;

    const conversations = Array.from(
      { length: RECENT_CHAT_PRELOAD_LIMIT + 3 },
      (_, index) => conversation(`chat-${index}`),
    );
    await preloadRecentConversationTails(conversations);

    expect(requested).toHaveLength(RECENT_CHAT_PRELOAD_LIMIT);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(readCachedConversationTail("chat-0")).toHaveLength(1);
    expect(readCachedConversationTail(`chat-${RECENT_CHAT_PRELOAD_LIMIT}`)).toBeNull();
  });
});
