import { describe, expect, test } from "bun:test";

import {
  buildHerdrAttachCommand,
  buildHerdrCreateAttachCommand,
  buildHerdrStartServerCommand,
  buildHerdrWorkspaceCreateCommand,
  herdrProbeKey,
  parseHerdrAgentList,
  parseHerdrSessionListJson,
} from "./herdr.js";

describe("herdr session helpers", () => {
  test("parses herdr session list JSON", () => {
    expect(parseHerdrSessionListJson(JSON.stringify({
      sessions: [
        {
          default: true,
          name: "default",
          running: true,
          session_dir: "/Users/art/.config/herdr",
          socket_path: "/Users/art/.config/herdr/herdr.sock",
        },
        {
          default: false,
          name: "scout-local-1",
          running: false,
        },
      ],
    }))).toEqual([
      { name: "default", isDefault: true, running: true, sessionDir: "/Users/art/.config/herdr" },
      { name: "scout-local-1", isDefault: false, running: false, sessionDir: null },
    ]);
  });

  test("survives an unavailable or unparseable herdr", () => {
    expect(parseHerdrSessionListJson("")).toEqual([]);
    expect(parseHerdrSessionListJson("not json")).toEqual([]);
    expect(parseHerdrSessionListJson(JSON.stringify({ sessions: [{ running: true }] }))).toEqual([]);
  });

  test("builds attach commands without socket paths", () => {
    expect(buildHerdrAttachCommand({ name: "default", isDefault: true })).toEqual(["herdr"]);
    expect(buildHerdrAttachCommand({ name: "scout-local-1", isDefault: false })).toEqual([
      "herdr",
      "session",
      "attach",
      "scout-local-1",
    ]);
    expect(buildHerdrCreateAttachCommand("scout-main-1")).toEqual(["herdr", "--session", "scout-main-1"]);
    expect(buildHerdrCreateAttachCommand("  ")).toEqual(["herdr"]);
  });

  test("never keys the probe on caller-supplied input", () => {
    expect(herdrProbeKey({ env: { HOME: "/tmp" } as NodeJS.ProcessEnv })).toBe("default");
    expect(herdrProbeKey(null)).toBe("default");
  });
});

describe("herdr session creation argv", () => {
  test("starts a named session headlessly rather than launching a client", () => {
    // `herdr --session <name>` needs a TTY; the server half does not.
    expect(buildHerdrStartServerCommand("scout-desk-1")).toEqual(["herdr", "--session", "scout-desk-1", "server"]);
    expect(buildHerdrStartServerCommand("  ")).toEqual(["herdr", "server"]);
  });

  test("creates the first workspace without stealing focus", () => {
    expect(buildHerdrWorkspaceCreateCommand("scout-desk-1", { cwd: "/repo", label: "Scout" }))
      .toEqual(["herdr", "--session", "scout-desk-1", "workspace", "create", "--cwd", "/repo", "--label", "Scout", "--no-focus"]);
    expect(buildHerdrWorkspaceCreateCommand("scout-desk-1"))
      .toEqual(["herdr", "--session", "scout-desk-1", "workspace", "create", "--no-focus"]);
  });
});

describe("parseHerdrAgentList", () => {
  test("reads host-reported agent state from the socket API JSON", () => {
    expect(parseHerdrAgentList(JSON.stringify({
      id: "cli:agent:list",
      result: {
        type: "agent_list",
        agents: [
          { agent_status: "working", cwd: "/repo", name: "claude", pane_id: "w1:p2", terminal_id: "term_a" },
          { agent_status: "idle", name: "codex", pane_id: "w1:p3" },
          { agent_status: "spinning", name: "scratch", terminal_id: "term_c" },
        ],
      },
    }))).toEqual([
      { target: "w1:p2", name: "claude", status: "working", cwd: "/repo" },
      { target: "w1:p3", name: "codex", status: "idle", cwd: null },
      // A status the schema grows later reads as unknown, never as a guess.
      { target: "term_c", name: "scratch", status: "unknown", cwd: null },
    ]);
  });

  test("is empty when the session server is not running", () => {
    expect(parseHerdrAgentList("")).toEqual([]);
    expect(parseHerdrAgentList("Error: Connection refused")).toEqual([]);
    expect(parseHerdrAgentList(JSON.stringify({ result: { agents: [] } }))).toEqual([]);
  });
});
