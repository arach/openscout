import { describe, expect, test } from "bun:test";

import {
  buildHerdrAttachCommand,
  buildHerdrCreateAttachCommand,
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

describe("parseHerdrAgentList", () => {
  test("reads host-reported agent state and refuses to guess", () => {
    expect(parseHerdrAgentList([
      "TARGET      NAME        STATUS",
      "terminal_1  claude      working",
      "terminal_2  codex       idle",
      "terminal_3  scratch     spinning",
    ].join("\n"))).toEqual([
      { target: "terminal_1", name: "claude", status: "working" },
      { target: "terminal_2", name: "codex", status: "idle" },
      { target: "terminal_3", name: "scratch", status: "unknown" },
    ]);
  });

  test("is empty when the session server is not running", () => {
    expect(parseHerdrAgentList("")).toEqual([]);
  });
});
