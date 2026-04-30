import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import {
  buildCodexAppServerSessionSnapshot,
  ensureCodexAppServerAgentOnline,
  getCodexAppServerAgentSnapshot,
  invokeCodexAppServerAgent,
  normalizeCodexAppServerLaunchArgs,
  resolveCodexExecutableCandidates,
  sendCodexAppServerAgent,
  shutdownCodexAppServerAgent,
} from "./codex-app-server";

const tempPaths = new Set<string>();
const originalCodexBin = process.env.OPENSCOUT_CODEX_BIN;
const originalCompletionGraceMs = process.env.OPENSCOUT_CODEX_COMPLETION_GRACE_MS;

afterEach(() => {
  if (originalCodexBin === undefined) {
    delete process.env.OPENSCOUT_CODEX_BIN;
  } else {
    process.env.OPENSCOUT_CODEX_BIN = originalCodexBin;
  }

  if (originalCompletionGraceMs === undefined) {
    delete process.env.OPENSCOUT_CODEX_COMPLETION_GRACE_MS;
  } else {
    process.env.OPENSCOUT_CODEX_COMPLETION_GRACE_MS = originalCompletionGraceMs;
  }

  for (const path of tempPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  tempPaths.clear();
});

function writeFakeCodexExecutable(baseDirectory: string): string {
  const executablePath = join(baseDirectory, "fake-codex");
  writeFileSync(executablePath, `#!/usr/bin/env bun
import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

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
    const cwd = typeof params.cwd === "string" ? params.cwd : null;
    const thread = { id: threadId, path: \`/tmp/\${threadId}.jsonl\`, cwd };
    console.log(JSON.stringify({ id, result: { thread } }));
    console.log(JSON.stringify({ method: "thread/started", params: { thread } }));
    continue;
  }

  if (method === "thread/start") {
    console.log(JSON.stringify({ id, error: { message: "thread/start should not be called in this test" } }));
    continue;
  }

  if (method === "turn/start") {
    const threadId = String(params.threadId ?? "thread-unknown");
    console.log(JSON.stringify({ id, result: { turn: { id: "turn-1" } } }));
    console.log(JSON.stringify({ method: "turn/started", params: { threadId, turn: { id: "turn-1", status: "inProgress", items: [] } } }));
    console.log(JSON.stringify({ method: "item/started", params: { threadId, turnId: "turn-1", item: { type: "agentMessage", id: "msg-1", text: "" } } }));
    console.log(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId, turnId: "turn-1", itemId: "msg-1", delta: "Attached session reply" } }));
    console.log(JSON.stringify({ method: "item/completed", params: { threadId, turnId: "turn-1", item: { type: "agentMessage", id: "msg-1", text: "Attached session reply" } } }));
    console.log(JSON.stringify({ method: "turn/completed", params: { threadId, turn: { id: "turn-1", status: "completed", error: null } } }));
    continue;
  }

  console.log(JSON.stringify({ id, result: {} }));
}
`, "utf8");
  chmodSync(executablePath, 0o755);
  return executablePath;
}

function writeArgCaptureFakeCodexExecutable(baseDirectory: string): {
  executablePath: string;
  argsPath: string;
} {
  const executablePath = join(baseDirectory, "fake-codex-args");
  const argsPath = join(baseDirectory, "codex-args.json");
  writeFileSync(executablePath, `#!/usr/bin/env bun
import readline from "node:readline";
import { writeFileSync } from "node:fs";

writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)), "utf8");

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

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
    const cwd = typeof params.cwd === "string" ? params.cwd : null;
    const thread = { id: threadId, path: \`/tmp/\${threadId}.jsonl\`, cwd };
    console.log(JSON.stringify({ id, result: { thread } }));
    console.log(JSON.stringify({ method: "thread/started", params: { thread } }));
    continue;
  }

  console.log(JSON.stringify({ id, result: {} }));
}
`, "utf8");
  chmodSync(executablePath, 0o755);
  return { executablePath, argsPath };
}

function writeSteerableFakeCodexExecutable(baseDirectory: string): string {
  const executablePath = join(baseDirectory, "fake-codex-steer");
  writeFileSync(executablePath, `#!/usr/bin/env bun
import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let activeThreadId = "thread-unknown";
let activeTurnId = "turn-1";

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
    activeThreadId = threadId;
    const cwd = typeof params.cwd === "string" ? params.cwd : null;
    const thread = { id: threadId, path: \`/tmp/\${threadId}.jsonl\`, cwd };
    console.log(JSON.stringify({ id, result: { thread } }));
    console.log(JSON.stringify({ method: "thread/started", params: { thread } }));
    continue;
  }

  if (method === "turn/start") {
    activeThreadId = String(params.threadId ?? activeThreadId);
    activeTurnId = "turn-1";
    console.log(JSON.stringify({ id, result: { turn: { id: activeTurnId } } }));
    console.log(JSON.stringify({ method: "turn/started", params: { threadId: activeThreadId, turn: { id: activeTurnId, status: "inProgress", items: [] } } }));
    continue;
  }

  if (method === "turn/steer") {
    console.log(JSON.stringify({ id, result: {} }));
    console.log(JSON.stringify({ method: "item/started", params: { threadId: activeThreadId, turnId: activeTurnId, item: { type: "agentMessage", id: "msg-1", text: "" } } }));
    console.log(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: activeThreadId, turnId: activeTurnId, itemId: "msg-1", delta: "Steered current session reply" } }));
    console.log(JSON.stringify({ method: "item/completed", params: { threadId: activeThreadId, turnId: activeTurnId, item: { type: "agentMessage", id: "msg-1", text: "Steered current session reply" } } }));
    console.log(JSON.stringify({ method: "turn/completed", params: { threadId: activeThreadId, turn: { id: activeTurnId, status: "completed", error: null } } }));
    continue;
  }

  console.log(JSON.stringify({ id, result: {} }));
}
`, "utf8");
  chmodSync(executablePath, 0o755);
  return executablePath;
}

function writeLateCompletionFakeCodexExecutable(baseDirectory: string): string {
  const executablePath = join(baseDirectory, "fake-codex-late-completion");
  writeFileSync(executablePath, `#!/usr/bin/env bun
import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let activeThreadId = "thread-unknown";
let activeTurnId = "turn-1";

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
    activeThreadId = String(params.threadId ?? "thread-unknown");
    const cwd = typeof params.cwd === "string" ? params.cwd : null;
    const thread = { id: activeThreadId, path: \`/tmp/\${activeThreadId}.jsonl\`, cwd };
    console.log(JSON.stringify({ id, result: { thread } }));
    console.log(JSON.stringify({ method: "thread/started", params: { thread } }));
    continue;
  }

  if (method === "turn/start") {
    activeThreadId = String(params.threadId ?? activeThreadId);
    activeTurnId = "turn-1";
    console.log(JSON.stringify({ id, result: { turn: { id: activeTurnId } } }));
    console.log(JSON.stringify({ method: "turn/started", params: { threadId: activeThreadId, turn: { id: activeTurnId, status: "inProgress", items: [] } } }));
    setTimeout(() => {
      console.log(JSON.stringify({ method: "item/started", params: { threadId: activeThreadId, turnId: activeTurnId, item: { type: "agentMessage", id: "msg-1", text: "" } } }));
      console.log(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: activeThreadId, turnId: activeTurnId, itemId: "msg-1", delta: "Late completion reply" } }));
      console.log(JSON.stringify({ method: "item/completed", params: { threadId: activeThreadId, turnId: activeTurnId, item: { type: "agentMessage", id: "msg-1", text: "Late completion reply" } } }));
      console.log(JSON.stringify({ method: "turn/completed", params: { threadId: activeThreadId, turn: { id: activeTurnId, status: "completed", error: null } } }));
    }, 150);
    continue;
  }

  if (method === "turn/interrupt") {
    console.log(JSON.stringify({ id, result: {} }));
    continue;
  }

  console.log(JSON.stringify({ id, result: {} }));
}
`, "utf8");
  chmodSync(executablePath, 0o755);
  return executablePath;
}

function writeDynamicToolFakeCodexExecutable(baseDirectory: string): {
  executablePath: string;
  responsePath: string;
} {
  const executablePath = join(baseDirectory, "fake-codex-dynamic-tool");
  const responsePath = join(baseDirectory, "dynamic-tool-response.json");
  writeFileSync(executablePath, `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let activeThreadId = "thread-unknown";

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
    activeThreadId = String(params.threadId ?? "thread-unknown");
    const cwd = typeof params.cwd === "string" ? params.cwd : null;
    const thread = { id: activeThreadId, path: \`/tmp/\${activeThreadId}.jsonl\`, cwd };
    console.log(JSON.stringify({ id, result: { thread } }));
    console.log(JSON.stringify({ method: "thread/started", params: { thread } }));
    continue;
  }

  if (method === "turn/start") {
    activeThreadId = String(params.threadId ?? activeThreadId);
    console.log(JSON.stringify({ id, result: { turn: { id: "turn-1" } } }));
    console.log(JSON.stringify({ method: "turn/started", params: { threadId: activeThreadId, turn: { id: "turn-1", status: "inProgress", items: [] } } }));
    console.log(JSON.stringify({
      id: "server-request-1",
      method: "item/tool/call",
      params: {
        threadId: activeThreadId,
        turnId: "turn-1",
        callId: "call-1",
        tool: "read_thread_terminal",
        arguments: {},
      },
    }));
    continue;
  }

  if (id === "server-request-1") {
    writeFileSync(${JSON.stringify(responsePath)}, JSON.stringify(message, null, 2));
    console.log(JSON.stringify({ method: "item/started", params: { threadId: activeThreadId, turnId: "turn-1", item: { type: "agentMessage", id: "msg-1", text: "" } } }));
    console.log(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: activeThreadId, turnId: "turn-1", itemId: "msg-1", delta: "Recovered after tool rejection" } }));
    console.log(JSON.stringify({ method: "item/completed", params: { threadId: activeThreadId, turnId: "turn-1", item: { type: "agentMessage", id: "msg-1", text: "Recovered after tool rejection" } } }));
    console.log(JSON.stringify({ method: "turn/completed", params: { threadId: activeThreadId, turn: { id: "turn-1", status: "completed", error: null } } }));
    continue;
  }

  console.log(JSON.stringify({ id, result: {} }));
}
`, "utf8");
  chmodSync(executablePath, 0o755);
  return { executablePath, responsePath };
}

function writeReplyContextFakeCodexExecutable(baseDirectory: string): {
  executablePath: string;
  observedContextPath: string;
} {
  const executablePath = join(baseDirectory, "fake-codex-reply-context");
  const observedContextPath = join(baseDirectory, "observed-reply-context.json");
  writeFileSync(executablePath, `#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let activeThreadId = "thread-unknown";

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
    activeThreadId = String(params.threadId ?? "thread-unknown");
    const thread = { id: activeThreadId, path: \`/tmp/\${activeThreadId}.jsonl\` };
    console.log(JSON.stringify({ id, result: { thread } }));
    console.log(JSON.stringify({ method: "thread/started", params: { thread } }));
    continue;
  }

  if (method === "turn/start") {
    const contextPath = process.env.OPENSCOUT_REPLY_CONTEXT_FILE ?? "";
    const observed = {
      contextPath,
      exists: contextPath ? existsSync(contextPath) : false,
      context: contextPath && existsSync(contextPath) ? JSON.parse(readFileSync(contextPath, "utf8")) : null,
    };
    writeFileSync(${JSON.stringify(observedContextPath)}, JSON.stringify(observed, null, 2));
    activeThreadId = String(params.threadId ?? activeThreadId);
    console.log(JSON.stringify({ id, result: { turn: { id: "turn-1" } } }));
    console.log(JSON.stringify({ method: "turn/started", params: { threadId: activeThreadId, turn: { id: "turn-1", status: "inProgress", items: [] } } }));
    console.log(JSON.stringify({ method: "item/started", params: { threadId: activeThreadId, turnId: "turn-1", item: { type: "agentMessage", id: "msg-1", text: "" } } }));
    console.log(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: activeThreadId, turnId: "turn-1", itemId: "msg-1", delta: "Reply context observed" } }));
    console.log(JSON.stringify({ method: "item/completed", params: { threadId: activeThreadId, turnId: "turn-1", item: { type: "agentMessage", id: "msg-1", text: "Reply context observed" } } }));
    console.log(JSON.stringify({ method: "turn/completed", params: { threadId: activeThreadId, turn: { id: "turn-1", status: "completed", error: null } } }));
    continue;
  }

  console.log(JSON.stringify({ id, result: {} }));
}
`, "utf8");
  chmodSync(executablePath, 0o755);
  return { executablePath, observedContextPath };
}
describe("buildCodexAppServerSessionSnapshot", () => {
  test("projects agent messages and tool activity from app-server history", () => {
    const raw = [
      JSON.stringify({
        id: "2",
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
        method: "thread/status/changed",
        params: {
          threadId: "thread-1",
          status: { type: "active" },
        },
      }),
      JSON.stringify({
        method: "turn/started",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "inProgress", items: [] },
        },
      }),
      JSON.stringify({
        method: "item/started",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "agentMessage", id: "msg-1", text: "" },
        },
      }),
      JSON.stringify({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "msg-1",
          delta: "Hello from Codex",
        },
      }),
      JSON.stringify({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "agentMessage", id: "msg-1", text: "Hello from Codex" },
        },
      }),
      JSON.stringify({
        method: "item/started",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "webSearch", id: "ws-1", query: "", action: { type: "other" } },
        },
      }),
      JSON.stringify({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "webSearch",
            id: "ws-1",
            query: "latest traces",
            action: { type: "search", queries: ["latest traces"] },
          },
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
      agentName: "amplink",
      sessionId: "relay-amplink",
      cwd: "/repo",
    }, "thread-1");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.session.model).toBe("gpt-5.4");
    expect(snapshot?.turns).toHaveLength(1);
    expect(snapshot?.turns[0]?.status).toBe("completed");
    expect(snapshot?.turns[0]?.blocks).toHaveLength(2);
    expect(snapshot?.turns[0]?.blocks[0]?.block.type).toBe("text");
    expect(snapshot?.turns[0]?.blocks[0]?.block.type === "text" && snapshot.turns[0].blocks[0].block.text).toBe("Hello from Codex");
    expect(snapshot?.turns[0]?.blocks[1]?.block.type).toBe("action");
    if (snapshot?.turns[0]?.blocks[1]?.block.type === "action") {
      expect(snapshot.turns[0].blocks[1].block.action.toolName).toBe("webSearch");
      expect(snapshot.turns[0].blocks[1].block.action.output).toContain("latest traces");
    }
  });

  test("ignores item events without a thread id once the target thread is known", () => {
    const raw = [
      JSON.stringify({
        id: "2",
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
          turn: { id: "turn-1", status: "inProgress", items: [] },
        },
      }),
      JSON.stringify({
        method: "item/started",
        params: {
          turnId: "turn-1",
          item: { type: "agentMessage", id: "msg-ignored", text: "wrong session bleed" },
        },
      }),
      JSON.stringify({
        method: "item/started",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "agentMessage", id: "msg-1", text: "kept" },
        },
      }),
      JSON.stringify({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: { type: "agentMessage", id: "msg-1", text: "kept" },
        },
      }),
    ].join("\n");

    const snapshot = buildCodexAppServerSessionSnapshot(raw, {
      agentName: "amplink",
      sessionId: "relay-amplink",
      cwd: "/repo",
    }, "thread-1");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.turns).toHaveLength(1);
    expect(snapshot?.turns[0]?.blocks).toHaveLength(1);
    expect(snapshot?.turns[0]?.blocks[0]?.block.type).toBe("text");
    expect(snapshot?.turns[0]?.blocks[0]?.block.type === "text" && snapshot.turns[0].blocks[0].block.text).toBe("kept");
  });

  test("includes user messages so local trace reflects both sides of the turn", () => {
    const raw = [
      JSON.stringify({
        id: "2",
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
          turn: { id: "turn-1", status: "inProgress", items: [] },
        },
      }),
      JSON.stringify({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "userMessage",
            id: "user-1",
            content: [{ type: "text", text: "ping from local codex chat" }],
          },
        },
      }),
      JSON.stringify({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "agentMessage",
            id: "msg-1",
            text: "pong",
          },
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
      agentName: "amplink",
      sessionId: "relay-amplink",
      cwd: "/repo",
    }, "thread-1");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.turns).toHaveLength(1);
    expect(snapshot?.turns[0]?.blocks).toHaveLength(2);
    expect(snapshot?.turns[0]?.blocks[0]?.block.type).toBe("text");
    expect(snapshot?.turns[0]?.blocks[0]?.block.type === "text" && snapshot.turns[0].blocks[0].block.text)
      .toBe("ping from local codex chat");
    expect(snapshot?.turns[0]?.blocks[1]?.block.type).toBe("text");
    expect(snapshot?.turns[0]?.blocks[1]?.block.type === "text" && snapshot.turns[0].blocks[1].block.text)
      .toBe("pong");
  });

  test("prefers the canonical rollout thread file when runtime state provides a thread path", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-codex-rollout-test-"));
    tempPaths.add(tempRoot);

    const runtimeDirectory = join(tempRoot, "runtime");
    const logsDirectory = join(tempRoot, "logs");
    mkdirSync(runtimeDirectory, { recursive: true });
    mkdirSync(logsDirectory, { recursive: true });

    const rolloutPath = join(tempRoot, "rollout-thread-1.jsonl");
    const rollout = [
      JSON.stringify({
        timestamp: "2026-04-17T01:54:38.000Z",
        type: "session_meta",
        payload: {
          id: "thread-1",
          cwd: "/repo",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-17T01:54:38.100Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-1",
          started_at: 1776390878,
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-17T01:54:38.200Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-1",
          cwd: "/repo",
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-17T01:54:38.300Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hello from the real thread" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-17T01:54:38.400Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "echo hi" }),
          call_id: "call-1",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-17T01:54:38.500Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "hi\n",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-17T01:54:38.600Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          completed_at: 1776390878,
        },
      }),
    ].join("\n");
    writeFileSync(rolloutPath, rollout, "utf8");

    writeFileSync(join(runtimeDirectory, "state.json"), JSON.stringify({
      threadId: "thread-1",
      threadPath: rolloutPath,
    }, null, 2));
    writeFileSync(join(runtimeDirectory, "codex-thread-id.txt"), "thread-1\n");
    writeFileSync(join(logsDirectory, "stdout.log"), [
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
          turn: { id: "turn-stale", status: "inProgress", items: [] },
        },
      }),
      JSON.stringify({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-stale",
          item: { type: "agentMessage", id: "msg-stale", text: "stale stdout log" },
        },
      }),
    ].join("\n"), "utf8");

    const snapshot = await getCodexAppServerAgentSnapshot({
      agentName: "codex-here",
      sessionId: "attached-codex-here",
      cwd: "/repo",
      systemPrompt: "unused",
      runtimeDirectory,
      logsDirectory,
      threadId: "thread-1",
      launchArgs: [],
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.session.providerMeta?.threadId).toBe("thread-1");
    expect(snapshot?.session.providerMeta?.threadPath).toBe(rolloutPath);
    expect(snapshot?.turns).toHaveLength(1);
    expect(snapshot?.turns[0]?.id).toBe("turn-1");
    expect(snapshot?.turns[0]?.blocks).toHaveLength(2);
    expect(snapshot?.turns[0]?.blocks[0]?.block.type).toBe("text");
    expect(snapshot?.turns[0]?.blocks[0]?.block.type === "text" && snapshot.turns[0].blocks[0].block.text).toBe("Hello from the real thread");
    expect(snapshot?.turns[0]?.blocks[1]?.block.type).toBe("action");
    if (snapshot?.turns[0]?.blocks[1]?.block.type === "action") {
      expect(snapshot.turns[0].blocks[1].block.action.toolName).toBe("exec_command");
      expect(snapshot.turns[0].blocks[1].block.action.output).toBe("hi\n");
    }
  });
});

describe("ensureCodexAppServerAgentOnline", () => {
  test("prefers standalone Codex CLI candidates before the bundled Codex app binary", () => {
    const candidates = resolveCodexExecutableCandidates({
      HOME: "/Users/tester",
      PATH: ["/custom/bin", "/opt/homebrew/bin"].join(delimiter),
    });

    expect(candidates.indexOf("/custom/bin/codex")).toBeGreaterThan(-1);
    expect(candidates.indexOf("/Applications/Codex.app/Contents/Resources/codex")).toBeGreaterThan(-1);
    expect(candidates.indexOf("/custom/bin/codex")).toBeLessThan(
      candidates.indexOf("/Applications/Codex.app/Contents/Resources/codex"),
    );
  });

  test("keeps explicit Codex binary overrides first", () => {
    expect(resolveCodexExecutableCandidates({
      HOME: "/Users/tester",
      PATH: "/custom/bin",
      OPENSCOUT_CODEX_BIN: "/explicit/codex",
      CODEX_BIN: "/fallback/codex",
    }).slice(0, 2)).toEqual([
      "/explicit/codex",
      "/fallback/codex",
    ]);
  });

  test("normalizes legacy model launch args for app-server sessions", () => {
    expect(normalizeCodexAppServerLaunchArgs(["--model", "gpt-5.4-mini"])).toEqual([
      "-c",
      "model=\"gpt-5.4-mini\"",
    ]);
  });

  test("passes launch args through to the spawned app-server process", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-codex-launch-args-test-"));
    tempPaths.add(tempRoot);
    const runtimeDirectory = join(tempRoot, "runtime");
    const logsDirectory = join(tempRoot, "logs");
    const { executablePath, argsPath } = writeArgCaptureFakeCodexExecutable(tempRoot);
    process.env.OPENSCOUT_CODEX_BIN = executablePath;

    const options = {
      agentName: "codex-launch-args",
      sessionId: "attached-codex-launch-args",
      cwd: process.cwd(),
      systemPrompt: "Resume the existing session without changing its identity or prior context.",
      runtimeDirectory,
      logsDirectory,
      threadId: "thread-launch-args-1",
      requireExistingThread: true,
      launchArgs: ["--model", "gpt-5.4-mini", "--config", "sandbox_workspace_write.enabled=true"],
    } as const;

    await ensureCodexAppServerAgentOnline(options);

    const argv = JSON.parse(readFileSync(argsPath, "utf8")) as string[];
    expect(argv).toContain("app-server");
    expect(argv).toContain("model=\"gpt-5.4-mini\"");
    expect(argv).toContain("--config");
    expect(argv).toContain("sandbox_workspace_write.enabled=true");
    expect(argv).not.toContain("--model");

    await shutdownCodexAppServerAgent(options);
  });

  test("resumes a requested thread id without starting a new thread", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-codex-attach-test-"));
    tempPaths.add(tempRoot);
    const runtimeDirectory = join(tempRoot, "runtime");
    const logsDirectory = join(tempRoot, "logs");
    process.env.OPENSCOUT_CODEX_BIN = writeFakeCodexExecutable(tempRoot);

    const threadId = "123e4567-e89b-12d3-a456-426614174000";
    const options = {
      agentName: "codex-here",
      sessionId: "attached-codex-here",
      cwd: process.cwd(),
      systemPrompt: "Resume the existing session without changing its identity or prior context.",
      runtimeDirectory,
      logsDirectory,
      threadId,
      requireExistingThread: true,
      launchArgs: [],
    } as const;

    const online = await ensureCodexAppServerAgentOnline(options);
    expect(online.threadId).toBe(threadId);

    const state = JSON.parse(readFileSync(join(runtimeDirectory, "state.json"), "utf8")) as {
      threadId?: string;
      requestedThreadId?: string | null;
      requireExistingThread?: boolean;
    };
    expect(state.threadId).toBe(threadId);
    expect(state.requestedThreadId).toBe(threadId);
    expect(state.requireExistingThread).toBe(true);

    const snapshot = await getCodexAppServerAgentSnapshot(options);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.session.providerMeta?.threadId).toBe(threadId);

    await shutdownCodexAppServerAgent(options);
  });

  test("steers the current turn instead of starting a second one", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-codex-steer-test-"));
    tempPaths.add(tempRoot);
    const runtimeDirectory = join(tempRoot, "runtime");
    const logsDirectory = join(tempRoot, "logs");
    process.env.OPENSCOUT_CODEX_BIN = writeSteerableFakeCodexExecutable(tempRoot);

    const options = {
      agentName: "codex-here",
      sessionId: "attached-codex-here",
      cwd: process.cwd(),
      systemPrompt: "Resume the existing session without changing its identity or prior context.",
      runtimeDirectory,
      logsDirectory,
      threadId: "thread-steer-1",
      requireExistingThread: true,
      launchArgs: [],
    } as const;

    await ensureCodexAppServerAgentOnline(options);
    const first = invokeCodexAppServerAgent({
      ...options,
      prompt: "first prompt",
      timeoutMs: 5_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = sendCodexAppServerAgent({
      ...options,
      prompt: "follow-up prompt",
      timeoutMs: 5_000,
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.output).toBe("Steered current session reply");
    expect(secondResult.output).toBe("Steered current session reply");

    await shutdownCodexAppServerAgent(options);
  });

  test("accepts a late completion that arrives shortly after the timeout deadline", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-codex-late-completion-test-"));
    tempPaths.add(tempRoot);
    const runtimeDirectory = join(tempRoot, "runtime");
    const logsDirectory = join(tempRoot, "logs");
    process.env.OPENSCOUT_CODEX_BIN = writeLateCompletionFakeCodexExecutable(tempRoot);
    process.env.OPENSCOUT_CODEX_COMPLETION_GRACE_MS = "400";

    const options = {
      agentName: "codex-late",
      sessionId: "attached-codex-late",
      cwd: process.cwd(),
      systemPrompt: "Resume the existing session without changing its identity or prior context.",
      runtimeDirectory,
      logsDirectory,
      threadId: "thread-late-1",
      requireExistingThread: true,
      launchArgs: [],
    } as const;

    const startedAt = Date.now();
    const result = await invokeCodexAppServerAgent({
      ...options,
      prompt: "late prompt",
      timeoutMs: 50,
    });

    expect(result.output).toBe("Late completion reply");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(125);

    await shutdownCodexAppServerAgent(options);
  });

  test("rejects unsupported dynamic tool calls with a valid JSON-RPC error", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-codex-dynamic-tool-test-"));
    tempPaths.add(tempRoot);
    const runtimeDirectory = join(tempRoot, "runtime");
    const logsDirectory = join(tempRoot, "logs");
    const { executablePath, responsePath } = writeDynamicToolFakeCodexExecutable(tempRoot);
    process.env.OPENSCOUT_CODEX_BIN = executablePath;

    const options = {
      agentName: "codex-here",
      sessionId: "attached-codex-here",
      cwd: process.cwd(),
      systemPrompt: "Resume the existing session without changing its identity or prior context.",
      runtimeDirectory,
      logsDirectory,
      threadId: "thread-dynamic-tool-1",
      requireExistingThread: true,
      launchArgs: [],
    } as const;

    const result = await invokeCodexAppServerAgent({
      ...options,
      prompt: "trigger a desktop-origin follow-up",
      timeoutMs: 5_000,
    });

    expect(result.output).toBe("Recovered after tool rejection");

    const response = JSON.parse(readFileSync(responsePath, "utf8")) as {
      id: string;
      error?: {
        code?: number;
        message?: string;
      };
    };
    expect(response.id).toBe("server-request-1");
    expect(response.error).toEqual({
      code: -32000,
      message: "dynamic tool call `read_thread_terminal` is not supported by openscout-runtime",
    });

    await shutdownCodexAppServerAgent(options);
  });

  test("writes per-turn Scout reply context for the long-lived MCP server", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "openscout-codex-reply-context-test-"));
    tempPaths.add(tempRoot);
    const runtimeDirectory = join(tempRoot, "runtime");
    const logsDirectory = join(tempRoot, "logs");
    const { executablePath, observedContextPath } = writeReplyContextFakeCodexExecutable(tempRoot);
    process.env.OPENSCOUT_CODEX_BIN = executablePath;

    const options = {
      agentName: "codex-here",
      sessionId: "attached-codex-reply-context",
      cwd: process.cwd(),
      systemPrompt: "Resume the existing session without changing its identity or prior context.",
      runtimeDirectory,
      logsDirectory,
      threadId: "thread-reply-context-1",
      requireExistingThread: true,
      launchArgs: [],
    } as const;

    const result = await invokeCodexAppServerAgent({
      ...options,
      prompt: "observe reply context",
      timeoutMs: 5_000,
      replyContext: {
        mode: "broker_reply",
        fromAgentId: "sender.agent",
        toAgentId: "codex-here",
        conversationId: "dm.sender.codex",
        messageId: "msg-original",
        replyToMessageId: "msg-original",
        replyPath: "mcp_reply",
        action: "consult",
      },
    });

    expect(result.output).toBe("Reply context observed");

    const observed = JSON.parse(readFileSync(observedContextPath, "utf8")) as {
      contextPath?: string;
      exists?: boolean;
      context?: {
        conversationId?: string;
        replyToMessageId?: string;
        replyPath?: string;
      } | null;
    };
    expect(observed.exists).toBe(true);
    expect(observed.contextPath).toBe(join(runtimeDirectory, "scout-reply-context.json"));
    expect(observed.context).toMatchObject({
      conversationId: "dm.sender.codex",
      replyToMessageId: "msg-original",
      replyPath: "mcp_reply",
    });

    await shutdownCodexAppServerAgent(options);
  });
});
