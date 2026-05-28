import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { ScoutbotThreadMapStore } from "./thread-map.ts";

describe("ScoutbotThreadMapStore", () => {
  test("auto-creates default thread and grandfathers legacy conversation", async () => {
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
            "dm.operator.scoutbot": {
              id: "dm.operator.scoutbot",
              kind: "direct",
              title: "Scout",
              visibility: "private",
              shareMode: "local",
              authorityNodeId: "node-1",
              participantIds: ["operator", "scoutbot"],
              metadata: {},
            },
          },
        },
        now: 99,
      });
      expect(thread).toMatchObject({
        threadId: "thr-default",
        name: "default",
        conversationId: "dm.operator.scoutbot",
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
