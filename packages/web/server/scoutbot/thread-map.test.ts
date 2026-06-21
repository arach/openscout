import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { ScoutbotThreadMapStore } from "./thread-map.ts";

describe("ScoutbotThreadMapStore", () => {
  test("auto-creates default thread from an existing opaque scoutbot conversation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scoutbot-thread-map-"));
    try {
      const store = new ScoutbotThreadMapStore(join(dir, "threads.json"));
      const thread = await store.ensureDefaultThread({
        transportSessionId: "codex-thread-1",
        snapshot: {
          actors: {},
          agents: {},
          endpoints: {},
          nodes: {},
          messages: {},
          conversations: {
            "c.scoutbot-default": {
              id: "c.scoutbot-default",
              kind: "direct",
              title: "Scout",
              visibility: "private",
              shareMode: "local",
              authorityNodeId: "node-1",
              participantIds: ["operator", "scoutbot"],
              metadata: {
                scoutbotThreadId: "thr-default",
              },
            },
          },
        },
        now: 99,
      });
      expect(thread).toMatchObject({
        threadId: "thr-default",
        name: "default",
        conversationId: "c.scoutbot-default",
        transportSessionId: "codex-thread-1",
        transport: "codex_app_server",
        lastActiveAt: 99,
      });
      expect(await store.list()).toEqual({ threads: [thread], defaultThreadId: "thr-default" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
