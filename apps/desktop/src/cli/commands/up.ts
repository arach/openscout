import { resolve } from "node:path";

import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { parseScoutHarness } from "../../core/broker/service.ts";
import { upScoutAgent } from "../../core/agents/service.ts";
import { renderScoutUpResult } from "../../ui/terminal/agents.ts";

export async function runUpCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  let targetPath: string | null = null;
  let agentName: string | undefined;
  let harness: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index] ?? "";
    if (current === "--name") {
      const value = args[index + 1];
      if (!value) {
        throw new ScoutCliError("missing value for --name");
      }
      agentName = value;
      index += 1;
      continue;
    }
    if (current.startsWith("--name=")) {
      agentName = current.slice("--name=".length);
      continue;
    }
    if (current === "--harness") {
      const value = args[index + 1];
      if (!value) {
        throw new ScoutCliError("missing value for --harness");
      }
      harness = value;
      index += 1;
      continue;
    }
    if (current.startsWith("--harness=")) {
      harness = current.slice("--harness=".length);
      continue;
    }
    if (current.startsWith("--")) {
      throw new ScoutCliError(`unexpected argument for up: ${current}`);
    }
    if (targetPath) {
      throw new ScoutCliError(`unexpected arguments for up: ${args.join(" ")}`);
    }
    targetPath = current;
  }

  if (!targetPath) {
    throw new ScoutCliError("usage: scout up <path> [--name <alias>] [--harness <claude|codex>]");
  }

  const agent = await upScoutAgent({
    projectPath: resolve(targetPath),
    agentName,
    harness: parseScoutHarness(harness),
    currentDirectory: defaultScoutContextDirectory(context),
  });

  context.output.writeValue(agent, renderScoutUpResult);
}
