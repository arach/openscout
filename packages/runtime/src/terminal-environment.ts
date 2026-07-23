/**
 * Build an environment for an interactive terminal process.
 *
 * OpenScout's supervisors may intentionally run with NO_COLOR for their own
 * logs. That setting must not leak into a PTY-backed application: it suppresses
 * the application's ANSI output before a terminal client ever sees it.
 */
export function buildInteractiveTerminalEnvironment(
  base: NodeJS.ProcessEnv = process.env,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    ...overrides,
    COLORTERM: overrides.COLORTERM || base.COLORTERM || "truecolor",
    FORCE_COLOR: overrides.FORCE_COLOR || base.FORCE_COLOR || "1",
  };
  delete env.NO_COLOR;
  return env;
}

/**
 * Apply the same interactive color contract inside a managed launch script.
 *
 * A long-lived tmux server keeps its own global environment, so changing the
 * environment of the `tmux new-session` client is not enough to remove an old
 * NO_COLOR value from the process launched in the new pane. These directives
 * establish the contract at the final process boundary while preserving any
 * explicit color capability selected by the user.
 */
export function buildInteractiveTerminalShellDirectives(): string[] {
  return [
    "unset NO_COLOR",
    'export COLORTERM="${COLORTERM:-truecolor}"',
    'export FORCE_COLOR="${FORCE_COLOR:-1}"',
  ];
}
