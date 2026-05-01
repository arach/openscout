import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeSource } from "./claude-source.js";
import { CodexSource } from "./codex-source.js";
import type { DiscoveredProcess, DiscoveredTranscript, TailContext } from "./types.js";

const originalClaudeRoot = process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT;
const originalCodexRoot = process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT;
const originalWindow = process.env.OPENSCOUT_TAIL_DISCOVERY_WINDOW_MS;
const originalLimit = process.env.OPENSCOUT_TAIL_DISCOVERY_LIMIT;

let tempRoot = "";

function restoreEnv(): void {
  if (originalClaudeRoot === undefined) delete process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT;
  else process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT = originalClaudeRoot;
  if (originalCodexRoot === undefined) delete process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT;
  else process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT = originalCodexRoot;
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
});
