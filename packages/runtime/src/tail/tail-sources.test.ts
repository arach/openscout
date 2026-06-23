import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeSource } from "./claude-source.js";
import { CodexSource } from "./codex-source.js";
import { CursorSource } from "./cursor-source.js";
import { GrokSource } from "./grok-source.js";
import { OpenCodeSource } from "./opencode-source.js";
import type { DiscoveredProcess, DiscoveredTranscript, TailContext } from "./types.js";

const originalClaudeRoot = process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT;
const originalCodexRoot = process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT;
const originalCursorRoot = process.env.OPENSCOUT_TAIL_CURSOR_PROCESS_MONITOR_ROOT;
const originalGrokRoot = process.env.OPENSCOUT_TAIL_GROK_SESSIONS_ROOT;
const originalOpenCodeRoot = process.env.OPENSCOUT_TAIL_OPENCODE_STORAGE_ROOT;
const originalOpenCodeMessages = process.env.OPENSCOUT_TAIL_OPENCODE_MESSAGES_PER_SESSION;
const originalWindow = process.env.OPENSCOUT_TAIL_DISCOVERY_WINDOW_MS;
const originalLimit = process.env.OPENSCOUT_TAIL_DISCOVERY_LIMIT;

let tempRoot = "";

function restoreEnv(): void {
  if (originalClaudeRoot === undefined) delete process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT;
  else process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT = originalClaudeRoot;
  if (originalCodexRoot === undefined) delete process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT;
  else process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT = originalCodexRoot;
  if (originalCursorRoot === undefined) delete process.env.OPENSCOUT_TAIL_CURSOR_PROCESS_MONITOR_ROOT;
  else process.env.OPENSCOUT_TAIL_CURSOR_PROCESS_MONITOR_ROOT = originalCursorRoot;
  if (originalGrokRoot === undefined) delete process.env.OPENSCOUT_TAIL_GROK_SESSIONS_ROOT;
  else process.env.OPENSCOUT_TAIL_GROK_SESSIONS_ROOT = originalGrokRoot;
  if (originalOpenCodeRoot === undefined) delete process.env.OPENSCOUT_TAIL_OPENCODE_STORAGE_ROOT;
  else process.env.OPENSCOUT_TAIL_OPENCODE_STORAGE_ROOT = originalOpenCodeRoot;
  if (originalOpenCodeMessages === undefined) delete process.env.OPENSCOUT_TAIL_OPENCODE_MESSAGES_PER_SESSION;
  else process.env.OPENSCOUT_TAIL_OPENCODE_MESSAGES_PER_SESSION = originalOpenCodeMessages;
  if (originalWindow === undefined) delete process.env.OPENSCOUT_TAIL_DISCOVERY_WINDOW_MS;
  else process.env.OPENSCOUT_TAIL_DISCOVERY_WINDOW_MS = originalWindow;
  if (originalLimit === undefined) delete process.env.OPENSCOUT_TAIL_DISCOVERY_LIMIT;
  else process.env.OPENSCOUT_TAIL_DISCOVERY_LIMIT = originalLimit;
}

function makeProcess(source: string, cwd: string): DiscoveredProcess {
  return {
    pid: 123,
    ppid: 1,
    command: `${source} app-server`,
    etime: "01:00",
    cwd,
    harness: "scout-managed",
    parentChain: [],
    source,
  };
}

function makeContext(source: string, transcript: DiscoveredTranscript): TailContext {
  return {
    process: makeProcess(source, transcript.cwd ?? "/tmp/project"),
    transcript,
    transcriptPath: transcript.transcriptPath,
    lineOffset: 7,
  };
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "openscout-tail-sources-"));
  process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT = join(tempRoot, "claude-projects");
  process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT = join(tempRoot, "codex-sessions");
  process.env.OPENSCOUT_TAIL_CURSOR_PROCESS_MONITOR_ROOT = join(tempRoot, "cursor-process-monitor");
  process.env.OPENSCOUT_TAIL_GROK_SESSIONS_ROOT = join(tempRoot, "grok-sessions");
  process.env.OPENSCOUT_TAIL_OPENCODE_STORAGE_ROOT = join(tempRoot, "opencode-storage");
  process.env.OPENSCOUT_TAIL_OPENCODE_MESSAGES_PER_SESSION = "10";
  process.env.OPENSCOUT_TAIL_DISCOVERY_WINDOW_MS = String(60 * 60 * 1000);
  process.env.OPENSCOUT_TAIL_DISCOVERY_LIMIT = "20";
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
  restoreEnv();
});

describe("tail transcript sources", () => {
  test("discovers and parses Claude transcript files without process discovery", () => {
    const projectDir = join(process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT!, "-Users-arach-dev-openscout");
    mkdirSync(projectDir, { recursive: true });
    const transcriptPath = join(projectDir, "claude-session.jsonl");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: "system",
          timestamp: "2026-04-27T15:00:00.000Z",
          session_id: "claude-session",
          cwd: "/Users/arach/dev/openscout",
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-04-27T15:00:01.000Z",
          message: { content: [{ type: "text", text: "hello from claude" }] },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const transcripts = ClaudeSource.discoverTranscripts([]);
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]?.cwd).toBe("/Users/arach/dev/openscout");
    expect(transcripts[0]?.sessionId).toBe("claude-session");

    const event = ClaudeSource.parseLine(
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-04-27T15:00:01.000Z",
        message: { id: "msg-1", content: [{ type: "text", text: "hello from claude" }] },
      }),
      makeContext("claude", transcripts[0]!),
    );
    expect(event?.source).toBe("claude");
    expect(event?.sessionId).toBe("claude-session");
    expect(event?.kind).toBe("assistant");
    expect(event?.summary).toBe("hello from claude");
  });

  test("drops Claude lines without a parseable timestamp during replay", () => {
    const transcript = {
      source: "claude" as const,
      transcriptPath: "/tmp/claude/no-ts.jsonl",
      sessionId: "claude-no-ts",
      cwd: "/Users/arach/dev/openscout",
      project: "openscout",
      harness: "unattributed" as const,
      mtimeMs: Date.now(),
      size: 100,
    };
    const event = ClaudeSource.parseLine(
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ghost" }] } }),
      makeContext("claude", transcript),
    );
    expect(event).toBeNull();
  });

  test("does not turn Claude workflow journals into session transcripts", () => {
    const projectDir = join(process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT!, "-Users-arach-dev-openscout");
    const workflowDir = join(projectDir, "claude-session", "subagents", "workflows", "wf_fixture");
    mkdirSync(workflowDir, { recursive: true });
    const transcriptPath = join(projectDir, "claude-session.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: "system",
        timestamp: "2026-04-27T15:00:00.000Z",
        session_id: "claude-session",
        cwd: "/Users/arach/dev/openscout",
      }) + "\n",
      "utf8",
    );
    writeFileSync(
      join(workflowDir, "journal.jsonl"),
      [
        JSON.stringify({ type: "started", agentId: "a111" }),
        JSON.stringify({ type: "result", agentId: "a111", result: { ok: true } }),
      ].join("\n") + "\n",
      "utf8",
    );

    const transcripts = ClaudeSource.discoverTranscripts([]);
    expect(transcripts.map((transcript) => transcript.sessionId)).toEqual(["claude-session"]);
    expect(transcripts.some((transcript) => transcript.transcriptPath.endsWith("journal.jsonl"))).toBe(false);
  });

  test("discovers and parses Codex rollout files without process discovery", () => {
    const sessionDir = join(process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT!, "2026", "04", "27");
    mkdirSync(sessionDir, { recursive: true });
    const transcriptPath = join(sessionDir, "rollout-2026-04-27T11-15-09-019dcf82-3383-71c1-a23d-49947b6b4b04.jsonl");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: "2026-04-27T15:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "019dcf82-3383-71c1-a23d-49947b6b4b04",
            cwd: "/Users/arach/dev/openscout",
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-27T15:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "hello from codex" }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const transcripts = CodexSource.discoverTranscripts([]);
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]?.cwd).toBe("/Users/arach/dev/openscout");
    expect(transcripts[0]?.sessionId).toBe("019dcf82-3383-71c1-a23d-49947b6b4b04");

    const event = CodexSource.parseLine(
      JSON.stringify({
        timestamp: "2026-04-27T15:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello from codex" }],
        },
      }),
      makeContext("codex", transcripts[0]!),
    );
    expect(event?.source).toBe("codex");
    expect(event?.kind).toBe("assistant");
    expect(event?.summary).toBe("hello from codex");
  });

  test("joins Codex tool results to their tool calls by call_id", () => {
    const transcript = {
      source: "codex" as const,
      transcriptPath: "/tmp/codex/rollout-019dcf82-tool-join.jsonl",
      sessionId: "019dcf82-tool-join",
      cwd: "/Users/arach/dev/openscout",
      project: "openscout",
      harness: "unattributed" as const,
      mtimeMs: Date.now(),
      size: 100,
    };
    const ctx = {
      ...makeContext("codex", transcript),
      state: {} as Record<string, unknown>,
    };

    const call = CodexSource.parseLine(
      JSON.stringify({
        timestamp: "2026-04-27T15:00:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: "sed -n '1,70p' crates/scoutd/src/main.rs",
            workdir: "/Users/arach/dev/openscout",
          }),
          call_id: "call-sed-main",
        },
      }),
      ctx,
    );
    const result = CodexSource.parseLine(
      JSON.stringify({
        timestamp: "2026-04-27T15:00:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-sed-main",
          output: [
            "Chunk ID: abc123",
            "Wall time: 0.0100 seconds",
            "Process exited with code 0",
            "Output:",
            "use std::env;",
            "use std::fs;",
            "fn main() {",
            "  println!(\"scoutd\");",
            "}",
          ].join("\n"),
        },
      }),
      { ...ctx, lineOffset: 8 },
    );

    expect(call?.summary).toBe("sed -n '1,70p' crates/scoutd/src/main.rs");
    expect(result?.kind).toBe("tool-result");
    expect(result?.summary).toBe(
      "sed -n '1,70p' crates/scoutd/src/main.rs -> res: use std::env; use std::fs; fn main() { println!(\"scoutd\"); (5 lines)",
    );
  });

  test("uses stable Codex response item ids across repeated transcript offsets", () => {
    const transcript = {
      source: "codex" as const,
      transcriptPath: "/tmp/codex/rollout-019dcf82-stable-id.jsonl",
      sessionId: "019dcf82-stable-id",
      cwd: "/Users/arach/dev/openscout",
      project: "openscout",
      harness: "unattributed" as const,
      mtimeMs: Date.now(),
      size: 100,
    };
    const line = JSON.stringify({
      timestamp: "2026-04-27T15:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "msg_same",
        role: "assistant",
        content: [{ type: "output_text", text: "same visible line" }],
      },
    });

    const first = CodexSource.parseLine(line, {
      ...makeContext("codex", transcript),
      lineOffset: 7,
    });
    const second = CodexSource.parseLine(line, {
      ...makeContext("codex", transcript),
      lineOffset: 42,
    });

    expect(first?.id).toBe("codex:019dcf82-stable-id:response:message:msg_same");
    expect(second?.id).toBe(first?.id);
  });

  test("falls back to a result preview when a Codex output has no matching call in the parsed window", () => {
    const transcript = {
      source: "codex" as const,
      transcriptPath: "/tmp/codex/rollout-019dcf82-tool-miss.jsonl",
      sessionId: "019dcf82-tool-miss",
      cwd: "/Users/arach/dev/openscout",
      project: "openscout",
      harness: "unattributed" as const,
      mtimeMs: Date.now(),
      size: 100,
    };
    const event = CodexSource.parseLine(
      JSON.stringify({
        timestamp: "2026-04-27T15:00:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-missing",
          output: "alpha\nbeta\n",
        },
      }),
      {
        ...makeContext("codex", transcript),
        state: {},
      },
    );

    expect(event?.summary).toBe("res: alpha beta (2 lines)");
  });

  test("discovers and parses Grok event logs without process discovery", () => {
    const projectDir = join(
      process.env.OPENSCOUT_TAIL_GROK_SESSIONS_ROOT!,
      encodeURIComponent("/Users/art/dev/openscout"),
    );
    const sessionDir = join(projectDir, "019edd6b-fc26-7a53-a4a0-dd36c5378515");
    mkdirSync(sessionDir, { recursive: true });
    const transcriptPath = join(sessionDir, "events.jsonl");
    writeFileSync(
      join(sessionDir, "summary.json"),
      JSON.stringify({
        info: {
          id: "019edd6b-fc26-7a53-a4a0-dd36c5378515",
          cwd: "/Users/art/dev/openscout",
        },
        current_model_id: "grok-composer-2.5-fast",
      }),
      "utf8",
    );
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          ts: "2026-04-27T15:00:00.000Z",
          type: "turn_started",
          session_id: "019edd6b-fc26-7a53-a4a0-dd36c5378515",
          turn_number: 0,
          model_id: "grok-composer-2.5-fast",
        }),
        JSON.stringify({
          ts: "2026-04-27T15:00:01.000Z",
          type: "tool_started",
          session_id: "019edd6b-fc26-7a53-a4a0-dd36c5378515",
          tool_name: "Read",
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const transcripts = GrokSource.discoverTranscripts([]);
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]?.source).toBe("grok");
    expect(transcripts[0]?.cwd).toBe("/Users/art/dev/openscout");
    expect(transcripts[0]?.sessionId).toBe("019edd6b-fc26-7a53-a4a0-dd36c5378515");

    const event = GrokSource.parseLine(
      JSON.stringify({
        ts: "2026-04-27T15:00:02.000Z",
        type: "tool_completed",
        session_id: "019edd6b-fc26-7a53-a4a0-dd36c5378515",
        tool_name: "Read",
        outcome: "success",
      }),
      makeContext("grok", transcripts[0]!),
    );
    expect(event?.source).toBe("grok");
    expect(event?.kind).toBe("tool-result");
    expect(event?.summary).toBe("Read completed · success");

    const phaseEvent = GrokSource.parseLine(
      JSON.stringify({
        ts: "2026-04-27T15:00:03.000Z",
        type: "phase_changed",
        session_id: "019edd6b-fc26-7a53-a4a0-dd36c5378515",
        phase: "tool_execution",
      }),
      makeContext("grok", transcripts[0]!),
    );
    expect(phaseEvent?.kind).toBe("system");
    expect(phaseEvent?.summary).toBe("phase · tool_execution");
  });

  test("enriches Grok shell tool events with commands from updates.jsonl", () => {
    const projectDir = join(
      process.env.OPENSCOUT_TAIL_GROK_SESSIONS_ROOT!,
      encodeURIComponent("/Users/art/dev/openscout"),
    );
    const sessionDir = join(projectDir, "019edd6b-shell-enrich");
    mkdirSync(sessionDir, { recursive: true });
    const transcriptPath = join(sessionDir, "events.jsonl");
    const shellCommand = "curl -s http://127.0.0.1:5180/api/session-ref/test";
    writeFileSync(
      join(sessionDir, "summary.json"),
      JSON.stringify({
        info: {
          id: "019edd6b-shell-enrich",
          cwd: "/Users/art/dev/openscout",
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(sessionDir, "updates.jsonl"),
      `${JSON.stringify({
        timestamp: Date.parse("2026-04-27T15:00:01.000Z") / 1000,
        method: "session/update",
        params: {
          sessionId: "019edd6b-shell-enrich",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call-shell-fixture",
            title: "Shell",
            rawInput: { command: shellCommand },
          },
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          ts: "2026-04-27T15:00:01.000Z",
          type: "tool_started",
          session_id: "019edd6b-shell-enrich",
          tool_name: "Shell",
        }),
        JSON.stringify({
          ts: "2026-04-27T15:00:02.000Z",
          type: "tool_completed",
          session_id: "019edd6b-shell-enrich",
          tool_name: "Shell",
          outcome: "success",
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const transcripts = GrokSource.discoverTranscripts([]);
    const transcript = transcripts.find((entry) => entry.sessionId === "019edd6b-shell-enrich");
    expect(transcript).toBeDefined();

    const ctx = makeContext("grok", transcript!);
    const started = GrokSource.parseLine(
      JSON.stringify({
        ts: "2026-04-27T15:00:01.000Z",
        type: "tool_started",
        session_id: "019edd6b-shell-enrich",
        tool_name: "Shell",
      }),
      { ...ctx, lineOffset: 0 },
    );
    const completed = GrokSource.parseLine(
      JSON.stringify({
        ts: "2026-04-27T15:00:02.000Z",
        type: "tool_completed",
        session_id: "019edd6b-shell-enrich",
        tool_name: "Shell",
        outcome: "success",
      }),
      { ...ctx, lineOffset: 1 },
    );

    expect(started?.summary).toBe(`Shell · ${shellCommand}`);
    expect(completed?.summary).toBe(`Shell · ${shellCommand} · success`);
  });

  test("discovers and parses OpenCode sessions from message and part storage", () => {
    const storageRoot = process.env.OPENSCOUT_TAIL_OPENCODE_STORAGE_ROOT!;
    const sessionPath = join(storageRoot, "session", "global", "ses_fixture.json");
    const messageDir = join(storageRoot, "message", "ses_fixture");
    const userPartDir = join(storageRoot, "part", "msg_user");
    const assistantPartDir = join(storageRoot, "part", "msg_assistant");
    mkdirSync(join(storageRoot, "session", "global"), { recursive: true });
    mkdirSync(messageDir, { recursive: true });
    mkdirSync(userPartDir, { recursive: true });
    mkdirSync(assistantPartDir, { recursive: true });
    writeFileSync(
      sessionPath,
      JSON.stringify({
        id: "ses_fixture",
        directory: "/Users/art/dev/openscout",
        title: "OpenScout fixture",
        time: { created: 1771000000000, updated: 1771000002000 },
      }, null, 2),
      "utf8",
    );
    writeFileSync(
      join(messageDir, "msg_user.json"),
      JSON.stringify({
        id: "msg_user",
        sessionID: "ses_fixture",
        role: "user",
        time: { created: 1771000000000 },
        agent: "build",
      }, null, 2),
      "utf8",
    );
    writeFileSync(
      join(userPartDir, "prt_user.json"),
      JSON.stringify({
        id: "prt_user",
        sessionID: "ses_fixture",
        messageID: "msg_user",
        type: "text",
        text: "Check the repo status",
      }, null, 2),
      "utf8",
    );
    writeFileSync(
      join(messageDir, "msg_assistant.json"),
      JSON.stringify({
        id: "msg_assistant",
        sessionID: "ses_fixture",
        role: "assistant",
        time: { created: 1771000001000, completed: 1771000002000 },
        path: { cwd: "/Users/art/dev/openscout", root: "/Users/art/dev/openscout" },
        modelID: "minimax-m2.5-free",
      }, null, 2),
      "utf8",
    );
    writeFileSync(
      join(assistantPartDir, "prt_assistant.json"),
      JSON.stringify({
        id: "prt_assistant",
        sessionID: "ses_fixture",
        messageID: "msg_assistant",
        type: "text",
        text: "Repo is clean enough to proceed",
      }, null, 2),
      "utf8",
    );

    const transcripts = OpenCodeSource.discoverTranscripts([]);
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]?.source).toBe("opencode");
    expect(transcripts[0]?.cwd).toBe("/Users/art/dev/openscout");
    expect(transcripts[0]?.sessionId).toBe("ses_fixture");

    const parsed = OpenCodeSource.parseFile?.(
      readFileSync(sessionPath, "utf8"),
      makeContext("opencode", transcripts[0]!),
    );
    const events = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe("user");
    expect(events[0]?.summary).toBe("Check the repo status");
    expect(events[1]?.kind).toBe("assistant");
    expect(events[1]?.summary).toBe("Repo is clean enough to proceed");
  });

  test("discovers and parses Cursor process-monitor logs without process discovery", () => {
    const root = process.env.OPENSCOUT_TAIL_CURSOR_PROCESS_MONITOR_ROOT!;
    mkdirSync(root, { recursive: true });
    const transcriptPath = join(root, "1781827200000.log");
    const line = JSON.stringify({
      sampleStart: 1781827200000,
      sampleEnd: 1781827200500,
      sessionId: "cursor-session",
      rows: [
        {
          processName: "Cursor Helper (Plugin): extension-host (agent-exec) openscout [2-6]",
        },
      ],
    });
    writeFileSync(transcriptPath, `${line}\n`, "utf8");

    const transcripts = CursorSource.discoverTranscripts([]);
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]?.source).toBe("cursor");
    expect(transcripts[0]?.sessionId).toBe("cursor-session");
    expect(transcripts[0]?.project).toBe("openscout");

    const event = CursorSource.parseLine(line, makeContext("cursor", transcripts[0]!));
    expect(event?.source).toBe("cursor");
    expect(event?.kind).toBe("system");
    expect(event?.summary).toBe("process sample · openscout");
  });
});
