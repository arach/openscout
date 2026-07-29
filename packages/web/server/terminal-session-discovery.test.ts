import { describe, expect, test } from "bun:test";

import {
  parseHerdrSessionList,
  parseTmuxSessionList,
  parseZellijSessionList,
  terminalSurfaceKey,
} from "./terminal-session-discovery.ts";
import { resolvePreferredDurableBackend } from "./preferred-terminal-backend.ts";

describe("terminal session discovery", () => {
  test("parses tmux session inventory", () => {
    expect(parseTmuxSessionList("relay-claude|1|0|claude|/Users/art/dev/openscout\nlattices-c36f74\t2\t1\tzsh\t/Users/art\n")).toEqual([
      { name: "relay-claude", windows: 1, attached: 0, currentCommand: "claude", currentPath: "/Users/art/dev/openscout" },
      { name: "lattices-c36f74", windows: 2, attached: 1, currentCommand: "zsh", currentPath: "/Users/art" },
    ]);
  });


  test("keeps delimiters inside tmux current paths", () => {
    expect(parseTmuxSessionList("dev|2|1|zsh|/Users/art/dev/foo|bar\n")).toEqual([
      { name: "dev", windows: 2, attached: 1, currentCommand: "zsh", currentPath: "/Users/art/dev/foo|bar" },
    ]);
  });

  test("parses colorized zellij session inventory", () => {
    expect(parseZellijSessionList(
      "\x1B[32;1mscout-zj-final-7e55c009\x1B[m [Created \x1B[35;1m13h\x1B[m ago] (\x1B[31;1mEXITED\x1B[m - attach to resurrect)\n",
    )).toEqual([{
      name: "scout-zj-final-7e55c009",
      state: "exited",
      raw: "scout-zj-final-7e55c009 [Created 13h ago] (EXITED - attach to resurrect)",
    }]);
  });

  test("parses herdr session inventory JSON", () => {
    expect(parseHerdrSessionList(JSON.stringify({
      sessions: [
        { default: true, name: "default", running: true, session_dir: "/Users/art/.config/herdr" },
        { default: false, name: "scout-local-1", running: false },
      ],
    }))).toEqual([
      { name: "default", isDefault: true, running: true, sessionDir: "/Users/art/.config/herdr" },
      { name: "scout-local-1", isDefault: false, running: false, sessionDir: null },
    ]);
  });

  test("keys backend surfaces by backend and session name", () => {
    expect(terminalSurfaceKey("tmux", "relay-claude")).toBe("tmux:relay-claude");
    expect(terminalSurfaceKey("herdr", "default")).toBe("herdr:default");
  });

  test("prefers herdr for durable backends when available", () => {
    expect(resolvePreferredDurableBackend({ herdr: true, tmux: true, zellij: true })).toBe("herdr");
    expect(resolvePreferredDurableBackend({ herdr: false, tmux: true, zellij: true })).toBe("tmux");
    expect(resolvePreferredDurableBackend({ herdr: false, tmux: false, zellij: true })).toBe("zellij");
    expect(resolvePreferredDurableBackend({})).toBe("pty");
  });
});
