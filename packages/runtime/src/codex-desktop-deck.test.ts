import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  connectCodexDesktopDeckTask,
  getCodexDesktopDeckTaskSnapshot,
  interruptCodexDesktopDeckTurn,
  startCodexDesktopDeckTurn,
  steerCodexDesktopDeckTurn,
} from "./codex-desktop-deck.js";

const originalCodexHome = process.env.CODEX_HOME;
const tempPaths = new Set<string>();

afterEach(() => {
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  for (const path of tempPaths) rmSync(path, { recursive: true, force: true });
  tempPaths.clear();
});

function encodeFrame(message: Record<string, unknown>): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const result = Buffer.allocUnsafe(body.length + 4);
  result.writeUInt32LE(body.length, 0);
  body.copy(result, 4);
  return result;
}

describe("Codex Desktop Deck bridge", () => {
  test("follows an owned Desktop task and routes native turn controls to its owner", async () => {
    const root = mkdtempSync(join(tmpdir(), "openscout-codex-desktop-deck-"));
    tempPaths.add(root);
    process.env.CODEX_HOME = root;
    const ipcDirectory = join(root, "ipc");
    const sessionsDirectory = join(root, "sessions", "2026", "07", "27");
    mkdirSync(ipcDirectory, { recursive: true, mode: 0o700 });
    mkdirSync(sessionsDirectory, { recursive: true });

    const threadId = "019fa45a-4a90-72e0-a5fb-c5fce995a086";
    const cwd = join(root, "project");
    mkdirSync(cwd, { recursive: true });
    const rolloutPath = join(sessionsDirectory, `rollout-${threadId}.jsonl`);
    writeFileSync(rolloutPath, [
      JSON.stringify({
        timestamp: "2026-07-27T12:13:28.000Z",
        type: "session_meta",
        payload: { id: threadId, cwd, source: "vscode" },
      }),
      "",
    ].join("\n"), "utf8");

    const database = new Database(join(root, "state_5.sqlite"), { create: true });
    database.run("CREATE TABLE threads (id TEXT, cwd TEXT, archived INTEGER, recency_at_ms INTEGER, updated_at_ms INTEGER)");
    database.run(
      "INSERT INTO threads VALUES (?, ?, 0, 200, 200)",
      [threadId, cwd],
    );
    database.close();

    const socketPath = join(ipcDirectory, "ipc.sock");
    const received: Array<Record<string, unknown>> = [];
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      let buffer = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
          const length = buffer.readUInt32LE(0);
          if (buffer.length < length + 4) return;
          const message = JSON.parse(buffer.subarray(4, length + 4).toString("utf8")) as Record<string, unknown>;
          buffer = buffer.subarray(length + 4);
          received.push(message);
          const method = message.method;
          if (message.type === "request" && method === "initialize") {
            socket.write(encodeFrame({
              type: "response",
              requestId: message.requestId,
              resultType: "success",
              result: { clientId: "desktop-test-client" },
            }));
          } else if (message.type === "broadcast" && method === "thread-stream-following-changed") {
            const params = message.params as Record<string, unknown>;
            if (params.following === true) {
              socket.write(encodeFrame({
                type: "broadcast",
                method: "thread-stream-state-changed",
                sourceClientId: "desktop-owner",
                version: 11,
                params: {
                  hostId: "local",
                  conversationId: threadId,
                  change: {
                    type: "snapshot",
                    conversationState: { id: threadId, title: "Owned task", cwd, rolloutPath },
                  },
                },
              }));
            }
          } else if (message.type === "request" && method === "thread-follower-start-turn") {
            socket.write(encodeFrame({
              type: "response",
              requestId: message.requestId,
              resultType: "success",
              result: { result: { turn: { id: "turn-started" } } },
            }));
          } else if (message.type === "request") {
            socket.write(encodeFrame({
              type: "response",
              requestId: message.requestId,
              resultType: "success",
              result: { result: { ok: true } },
            }));
          }
        }
      });
    });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.once("error", rejectPromise);
      server.listen(socketPath, resolvePromise);
    });

    const options = {
      agentId: `desktop-test-${Date.now()}`,
      agentName: "Desktop test",
      cwd,
      runtimeDirectory: join(root, "runtime"),
    };

    try {
      const task = await connectCodexDesktopDeckTask(options);
      expect(task).toMatchObject({ threadId, title: "Owned task", cwd, rolloutPath });
      const snapshot = await getCodexDesktopDeckTaskSnapshot(options);
      expect(snapshot?.session).toMatchObject({ id: threadId, adapterType: "codex_desktop", name: "Owned task" });
      expect(await startCodexDesktopDeckTurn(options, "Start here")).toBe("turn-started");
      await steerCodexDesktopDeckTurn(options, "Steer here");
      await interruptCodexDesktopDeckTurn(options);

      const start = received.find((message) => message.method === "thread-follower-start-turn");
      const steer = received.find((message) => message.method === "thread-follower-steer-turn");
      const interrupt = received.find((message) => message.method === "thread-follower-interrupt-turn");
      expect(start).toMatchObject({ targetClientId: "desktop-owner", version: 1 });
      expect(steer).toMatchObject({ targetClientId: "desktop-owner", version: 1 });
      expect(interrupt).toMatchObject({
        targetClientId: "desktop-owner",
        version: 3,
        params: { conversationId: threadId, mode: "user-stop" },
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  });
});
