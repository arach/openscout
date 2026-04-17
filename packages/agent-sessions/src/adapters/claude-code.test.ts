import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { PairingEvent } from "../protocol/primitives.ts";
import { createAdapter } from "./claude-code.ts";

const tempPaths = new Set<string>();
const originalHome = process.env.HOME;
const originalPath = process.env.PATH;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }

  for (const path of tempPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  tempPaths.clear();
});

function writeFakeClaudeExecutable(baseDirectory: string, body: string): string {
  const executablePath = join(baseDirectory, "claude");
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

describe("ClaudeCodeAdapter", () => {
  test("infers the owning project cwd for a resume id", async () => {
    const resumeId = crypto.randomUUID();
    const projectRoot = join("/private/tmp", `openscoutclaude${crypto.randomUUID().replace(/-/g, "")}`);
    const slug = `-${projectRoot.replace(/^\//u, "").replace(/\//g, "-")}`;
    const sessionDir = join(homedir(), ".claude", "projects", slug);
    const sessionPath = join(sessionDir, `${resumeId}.jsonl`);

    tempPaths.add(projectRoot);
    tempPaths.add(sessionDir);

    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(sessionPath, "", "utf8");

    const adapter = createAdapter({
      sessionId: `claude-test-${crypto.randomUUID()}`,
      name: "Claude Test",
      cwd: "/Users/arach/dev/openscout",
      options: {
        resume: resumeId,
      },
    });
    expect(adapter.session.cwd).toBe(projectRoot);
    expect(adapter.session.providerMeta).toEqual(
      expect.objectContaining({
        resumeSessionPath: sessionPath,
        resumeProjectCwd: projectRoot,
      }),
    );
  });

  test("emits text deltas from stream_event output", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-claude-stream-"));
    tempPaths.add(tempRoot);

    writeFakeClaudeExecutable(tempRoot, `#!/usr/bin/env bun
import readline from "node:readline";

console.log(JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "claude-session-test",
  cwd: process.cwd(),
  model: "claude-test",
}));

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;

  console.log(JSON.stringify({ type: "stream_event", event: { type: "message_start" } }));
  console.log(JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  }));
  console.log(JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello " } },
  }));
  console.log(JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
  }));
  console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_stop", index: 0 } }));
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false }));
  break;
}
`);

    process.env.PATH = `${tempRoot}:${originalPath ?? ""}`;

    const adapter = createAdapter({
      sessionId: `claude-test-${crypto.randomUUID()}`,
      name: "Claude Stream Test",
      cwd: "/Users/arach/dev/openscout",
      env: {
        PATH: process.env.PATH,
      },
    });

    const collector = createEventCollector();
    adapter.on("event", (event) => collector.push(event));

    await adapter.start();
    adapter.send({ sessionId: adapter.session.id, text: "say hi" });

    await collector.waitFor((events) => events.some((event) => event.event === "turn:end"));

    const textStart = collector.events.find(
      (event) => event.event === "block:start" && event.block.type === "text",
    );
    const deltas = collector.events
      .filter((event) => event.event === "block:delta")
      .map((event) => event.text)
      .join("");
    const turnEnd = collector.events.find((event) => event.event === "turn:end");

    expect(textStart).toBeDefined();
    expect(deltas).toBe("hello world");
    expect(turnEnd).toEqual(expect.objectContaining({ event: "turn:end", status: "completed" }));

    await adapter.shutdown();
  });
});
