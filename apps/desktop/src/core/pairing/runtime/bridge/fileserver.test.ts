import { afterEach, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import type { SessionState } from "@openscout/agent-sessions";

import { startFileServer, type FileServer } from "./fileserver.ts";
import { issueWebHandoff } from "./web-handoff.ts";

const activeServers: FileServer[] = [];
const temporaryFiles: string[] = [];

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a free port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.once("error", reject);
  });
}

afterEach(async () => {
  while (activeServers.length > 0) {
    activeServers.pop()?.stop();
  }

  while (temporaryFiles.length > 0) {
    const filePath = temporaryFiles.pop();
    if (filePath) {
      await rm(filePath, { force: true });
    }
  }
});

test("pairing file server exposes health and allowed file reads", async () => {
  const port = await getFreePort();
  const server = startFileServer({ port });
  activeServers.push(server);

  const filePath = join("/tmp", `scout-fileserver-${Date.now()}.txt`);
  temporaryFiles.push(filePath);
  await writeFile(filePath, "hello from scout\n", "utf8");

  const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
  expect(healthResponse.status).toBe(200);
  expect(await healthResponse.json()).toEqual({ ok: true });

  const fileResponse = await fetch(
    `http://127.0.0.1:${port}/file?path=${encodeURIComponent(filePath)}`,
  );
  expect(fileResponse.status).toBe(200);
  expect(await fileResponse.text()).toBe("hello from scout\n");
});

test("pairing file server requires a scoped secure token for web handoffs", async () => {
  const port = await getFreePort();
  const snapshot: SessionState = {
    session: {
      id: "session-1",
      name: "Secure Session",
      adapterType: "claude-code",
      status: "active",
      cwd: "/tmp/demo",
    },
    turns: [{
      id: "turn-1",
      status: "completed",
      startedAt: Date.now(),
      endedAt: Date.now(),
      blocks: [{
        status: "completed",
        block: {
          id: "block-1",
          turnId: "turn-1",
          type: "action",
          status: "completed",
          index: 0,
          action: {
            kind: "file_change",
            status: "completed",
            path: "src/demo.ts",
            diff: "+hello\n-world",
            output: "",
          },
        },
      }],
    }],
  };
  const server = startFileServer({
    port,
    bridge: {
      getSessionSnapshot(sessionId: string) {
        return sessionId === "session-1" ? snapshot : null;
      },
    },
  });
  activeServers.push(server);

  const unauthorized = await fetch(`http://127.0.0.1:${port}/handoff/session/session-1`);
  expect(unauthorized.status).toBe(401);

  const handoff = issueWebHandoff({ kind: "session", sessionId: "session-1" }, "device-1");
  const authorized = await fetch(`http://127.0.0.1:${port}/handoff/session/session-1`, {
    headers: {
      "x-scout-handoff-token": handoff.token,
    },
  });
  expect(authorized.status).toBe(200);
  const body = await authorized.text();
  expect(body).toContain("Secure Proxy Session Handoff");
  expect(body).toContain("Secure Session");

  const scopedMiss = await fetch(`http://127.0.0.1:${port}/handoff/file-change/session-1/turn-1/block-1`, {
    headers: {
      "x-scout-handoff-token": handoff.token,
    },
  });
  expect(scopedMiss.status).toBe(401);
});
