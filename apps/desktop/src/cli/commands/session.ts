import { spawnSync } from "node:child_process";

import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { readCliInputFile } from "../input-file.ts";

const SESSION_HELP = `scout session — actions on a harness session

Usage:
  scout session fork <session-id> [prompt]   Fork a recorded session into a new one
  scout session fork --last [prompt]         Fork the most recent recorded session

Options (fork):
  --last                Fork the most recent session instead of naming an id
  --prompt-file <path>  Read the kickoff prompt from a file
  --all                 With no id, widen the picker beyond the current directory

Fork branches a session's context into a fresh run and leaves the original
untouched — hand the fork a prompt and it starts there with the full context
already loaded. It wraps the harness-native fork (today: codex fork) and opens
the forked session interactively. Deterministic when you pass an explicit
<session-id> (a codex session UUID).`;

export async function runSessionCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const action = args[0];
  if (!action || action === "help" || action === "--help" || action === "-h") {
    context.output.writeText(SESSION_HELP);
    return;
  }

  switch (action) {
    case "fork":
      await runSessionForkAction(context, args.slice(1));
      return;
    default:
      throw new ScoutCliError(
        `unknown session action: ${action} (try: scout session fork <session-id>)`,
      );
  }
}

async function runSessionForkAction(context: ScoutCommandContext, args: string[]): Promise<void> {
  let last = false;
  let all = false;
  let promptFile: string | undefined;
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--last") {
      last = true;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--prompt-file") {
      promptFile = args[index + 1];
      index += 1;
      if (!promptFile) {
        throw new ScoutCliError("--prompt-file needs a path");
      }
    } else if (arg === "--help" || arg === "-h") {
      context.output.writeText(SESSION_HELP);
      return;
    } else if (arg.startsWith("--")) {
      throw new ScoutCliError(`unknown option for session fork: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  // First positional is the session id (unless --last); the rest form the inline prompt.
  let sessionId: string | undefined;
  if (!last) {
    sessionId = positionals.shift();
    if (!sessionId) {
      throw new ScoutCliError(
        "session fork needs a <session-id> (or --last) — e.g. scout session fork <codex-session-uuid>",
      );
    }
  }

  const inlinePrompt = positionals.join(" ").trim();
  const prompt = promptFile ? await readCliInputFile(promptFile, "prompt") : inlinePrompt;

  // codex fork [--last] [--all] [<SESSION_ID>] [<PROMPT>]
  const codexArgs = ["fork"];
  if (last) codexArgs.push("--last");
  if (all) codexArgs.push("--all");
  if (sessionId) codexArgs.push(sessionId);
  if (prompt) codexArgs.push(prompt);

  context.stderr(`forking via codex: codex ${codexArgs.map(quoteForLog).join(" ")}`);

  // Inherit stdio: the forked session is interactive (a TUI), and lands the
  // operator straight in it. The source session is never modified.
  const result = spawnSync("codex", codexArgs, { stdio: "inherit", env: context.env });
  if (result.error) {
    const detail =
      (result.error as NodeJS.ErrnoException).code === "ENOENT"
        ? "codex CLI not found on PATH — install Codex, or run the fork on the machine that owns the session"
        : result.error.message;
    throw new ScoutCliError(`session fork failed: ${detail}`);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exitCode = result.status;
  }
}

function quoteForLog(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}
