import { describe, expect, test } from "bun:test";

import {
  buildInteractiveTerminalEnvironment,
  buildInteractiveTerminalShellDirectives,
} from "./terminal-environment.js";

describe("buildInteractiveTerminalEnvironment", () => {
  test("does not leak supervisor no-color policy into an interactive PTY", () => {
    const env = buildInteractiveTerminalEnvironment({
      PATH: "/usr/bin",
      NO_COLOR: "1",
    });

    expect(env).toMatchObject({
      PATH: "/usr/bin",
      COLORTERM: "truecolor",
      FORCE_COLOR: "1",
    });
    expect(env.NO_COLOR).toBeUndefined();
  });

  test("preserves explicit interactive color capabilities", () => {
    const env = buildInteractiveTerminalEnvironment(
      { COLORTERM: "24bit", FORCE_COLOR: "2", NO_COLOR: "1" },
      { TERM: "xterm-256color" },
    );

    expect(env).toMatchObject({
      TERM: "xterm-256color",
      COLORTERM: "24bit",
      FORCE_COLOR: "2",
    });
    expect(env.NO_COLOR).toBeUndefined();
  });
});

describe("buildInteractiveTerminalShellDirectives", () => {
  test("removes an inherited color opt-out and preserves explicit capabilities", () => {
    expect(buildInteractiveTerminalShellDirectives()).toEqual([
      "unset NO_COLOR",
      'export COLORTERM="${COLORTERM:-truecolor}"',
      'export FORCE_COLOR="${FORCE_COLOR:-1}"',
    ]);
  });
});
