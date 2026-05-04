import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { PairingEvent } from "./protocol/primitives.ts";
import { createAdapter } from "./adapters/codex.ts";

const tempPaths = new Set<string>();
const pairingSessionIds = new Set<string>();
const originalCodexBin = process.env.OPENSCOUT_CODEX_BIN;

afterEach(() => {
  if (originalCodexBin === undefined) {
    delete process.env.OPENSCOUT_CODEX_BIN;
  } else {
    process.env.OPENSCOUT_CODEX_BIN = originalCodexBin;
  }

  for (const sessionId of pairingSessionIds) {
    rmSync(join(homedir(), ".scout", "pairing", "codex", sessionId), { recursive: true, force: true });
  }
  pairingSessionIds.clear();

  for (const path of tempPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  tempPaths.clear();
});

function writeFakeCodexExecutable(baseDirectory: string, body: string): string {
  const executablePath = join(baseDirectory, `fake-codex-${crypto.randomUUID()}`);
  writeFileSync(executablePath, body, "utf8");
  chmodSync(executablePath, 0o755);
  return executablePath;
}

function createEventCollector() {
  const events: PairingEvent[] = [];
  const listeners = new Set<() => void>();

  return {
    events,
    push(event: PairingEvent) {
      events.push(event);
      for (const listener of listeners) {
        listener();
      }
    },
    async waitFor(predicate: (events: PairingEvent[]) => boolean, timeoutMs = 5_000): Promise<void> {
      if (predicate(events)) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`Timed out waiting for events after ${timeoutMs}ms.`));
        }, timeoutMs);

        const check = () => {
          if (!predicate(events)) {
            return;
          }
          clearTimeout(timeout);
          listeners.delete(check);
          resolve();
        };

        listeners.add(check);
      });
    },
  };
}

describe("CodexAdapter", () => {
  test("resumes the requested thread id and emits live text deltas", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-codex-adapter-"));
    tempPaths.add(tempRoot);

    process.env.OPENSCOUT_CODEX_BIN = writeFakeCodexExecutable(tempRoot, `#!/usr/bin/env bun
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const message = JSON.parse(trimmed);
  const id = message.id;
  const method = message.method;
  const params = message.params ?? {};

  if (method === "initialize") {
    console.log(JSON.stringify({ id, result: {} }));
    continue;
  }

  if (method === "thread/resume") {
    const threadId = String(params.threadId ?? "thread-unknown");
    const thread = { id: threadId, path: \`/tmp/\${threadId}.jsonl\`, cwd: params.cwd, name: "Codex Here" };
    console.log(JSON.stringify({ id, result: { thread } }));
    console.log(JSON.stringify({ method: "thread/started", params: { thread } }));
    console.log(JSON.stringify({ method: "thread/status/changed", params: { threadId, status: { type: "idle" } } }));
    continue;
  }

  if (method === "turn/start") {
    const threadId = String(params.threadId ?? "thread-unknown");
    console.log(JSON.stringify({ id, result: { turn: { id: "turn-1" } } }));
    console.log(JSON.stringify({ method: "turn/started", params: { threadId, turn: { id: "turn-1", status: "inProgress" } } }));
    console.log(JSON.stringify({ method: "item/started", params: { threadId, turnId: "turn-1", item: { type: "agentMessage", id: "msg-1", text: "" } } }));
    console.log(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId, turnId: "turn-1", itemId: "msg-1", delta: "hello " } }));
    console.log(JSON.stringify({ method: "item/completed", params: { threadId, turnId: "turn-1", item: { type: "agentMessage", id: "msg-1", text: "hello from codex" } } }));
    console.log(JSON.stringify({ method: "turn/completed", params: { threadId, turn: { id: "turn-1", status: "completed", error: null } } }));
    continue;
  }

  console.log(JSON.stringify({ id, result: {} }));
}
`);

    const sessionId = `codex-test-${crypto.randomUUID()}`;
    pairingSessionIds.add(sessionId);

    const adapter = createAdapter({
      sessionId,
      name: "Codex Here",
      cwd: process.cwd(),
      options: {
        threadId: "thread-attached-1",
        requireExistingThread: true,
        systemPrompt: "Resume the existing session without changing its identity or prior context.",
      },
    });

    const collector = createEventCollector();
    adapter.on("event", (event) => collector.push(event));

    await adapter.start();
    adapter.send({ sessionId, text: "say hi" });

    await collector.waitFor((events) => events.some((event) => event.event === "turn:end"));

    const updates = collector.events.filter((event) => event.event === "session:update");
    const turnStarts = collector.events.filter((event) => event.event === "turn:start");
    const textStart = collector.events.find((event) => event.event === "block:start" && event.block.type === "text");
    const deltas = collector.events.filter((event) => event.event === "block:delta").map((event) => event.text).join("");
    const turnEnd = collector.events.find((event) => event.event === "turn:end");

    expect(updates.length).toBeGreaterThan(0);
    const lastUpdate = updates.at(-1);
    expect(lastUpdate?.event).toBe("session:update");
    if (lastUpdate?.event === "session:update") {
      expect(lastUpdate.session.providerMeta?.threadId).toBe("thread-attached-1");
      expect(lastUpdate.session.providerMeta?.stdoutLogFile).toBeDefined();
    }
    expect(turnStarts).toHaveLength(1);
    expect(textStart).toBeDefined();
    expect(deltas).toBe("hello from codex");
    expect(turnEnd).toEqual(expect.objectContaining({ event: "turn:end", status: "completed" }));

    await adapter.shutdown();
  });

  test("steers an active turn instead of starting a second turn", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-codex-adapter-steer-"));
    tempPaths.add(tempRoot);
    const methodLogPath = join(tempRoot, "methods.log");

    process.env.OPENSCOUT_CODEX_BIN = writeFakeCodexExecutable(tempRoot, `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const methodLogPath = process.env.METHOD_LOG;

for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const message = JSON.parse(trimmed);
  const id = message.id;
  const method = message.method;
  const params = message.params ?? {};
  if (methodLogPath) {
    appendFileSync(methodLogPath, \`\${method}\\n\`);
  }

  if (method === "initialize") {
    console.log(JSON.stringify({ id, result: {} }));
    continue;
  }

  if (method === "thread/resume") {
    const threadId = String(params.threadId ?? "thread-unknown");
    const thread = { id: threadId, path: \`/tmp/\${threadId}.jsonl\`, cwd: params.cwd, name: "Codex Here" };
    console.log(JSON.stringify({ id, result: { thread } }));
    console.log(JSON.stringify({ method: "thread/started", params: { thread } }));
    continue;
  }

  if (method === "turn/start") {
    const threadId = String(params.threadId ?? "thread-unknown");
    console.log(JSON.stringify({ id, result: { turn: { id: "turn-1" } } }));
    console.log(JSON.stringify({ method: "turn/started", params: { threadId, turn: { id: "turn-1", status: "inProgress" } } }));
    continue;
  }

  if (method === "turn/steer") {
    const threadId = String(params.threadId ?? "thread-unknown");
    console.log(JSON.stringify({ id, result: {} }));
    console.log(JSON.stringify({ method: "item/started", params: { threadId, turnId: "turn-1", item: { type: "agentMessage", id: "msg-1", text: "" } } }));
    console.log(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId, turnId: "turn-1", itemId: "msg-1", delta: "steered " } }));
    console.log(JSON.stringify({ method: "item/completed", params: { threadId, turnId: "turn-1", item: { type: "agentMessage", id: "msg-1", text: "steered reply" } } }));
    console.log(JSON.stringify({ method: "turn/completed", params: { threadId, turn: { id: "turn-1", status: "completed", error: null } } }));
    continue;
  }

  console.log(JSON.stringify({ id, result: {} }));
}
`);

    const sessionId = `codex-test-${crypto.randomUUID()}`;
    pairingSessionIds.add(sessionId);

    const adapter = createAdapter({
      sessionId,
      name: "Codex Here",
      cwd: process.cwd(),
      env: {
        METHOD_LOG: methodLogPath,
      },
      options: {
        threadId: "thread-attached-2",
        requireExistingThread: true,
        systemPrompt: "Resume the existing session without changing its identity or prior context.",
      },
    });

    const collector = createEventCollector();
    adapter.on("event", (event) => collector.push(event));

    await adapter.start();
    adapter.send({ sessionId, text: "first" });
    await collector.waitFor((events) => events.some((event) => event.event === "turn:start"));
    adapter.send({ sessionId, text: "follow-up" });

    await collector.waitFor((events) => events.some((event) => event.event === "turn:end"));

    const methods = readFileSync(methodLogPath, "utf8");
    const turnStarts = collector.events.filter((event) => event.event === "turn:start");
    const deltas = collector.events.filter((event) => event.event === "block:delta").map((event) => event.text).join("");

    expect(methods).toContain("turn/start");
    expect(methods).toContain("turn/steer");
    expect(turnStarts).toHaveLength(1);
    expect(deltas).toBe("steered reply");

    await adapter.shutdown();
  });
});
