import { describe, expect, test } from "bun:test";

import {
  parseTmuxSessionList,
  parseZellijSessionList,
  terminalSurfaceKey,
} from "./terminal-session-discovery.ts";

describe("terminal session discovery", () => {
  test("parses tmux session inventory", () => {
    expect(parseTmuxSessionList("relay-claude|1|0|claude|/Users/art/dev/openscout\nlattices-c36f74\t2\t1\tzsh\t/Users/art\n")).toEqual([
      { name: "relay-claude", windows: 1, attached: 0, currentCommand: "claude", currentPath: "/Users/art/dev/openscout" },
      { name: "lattices-c36f74", windows: 2, attached: 1, currentCommand: "zsh", currentPath: "/Users/art" },
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

  test("keys backend surfaces by backend and session name", () => {
    expect(terminalSurfaceKey("tmux", "relay-claude")).toBe("tmux:relay-claude");
  });
});
