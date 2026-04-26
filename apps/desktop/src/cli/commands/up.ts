import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { resolveLocalAgentByName } from "@openscout/runtime/local-agents";

import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { parseScoutHarness } from "../../core/broker/service.ts";
import { upScoutAgent } from "../../core/agents/service.ts";
import { renderScoutUpResult } from "../../ui/terminal/agents.ts";

function looksLikePath(value: string): boolean {
  return value.includes("/") || value.startsWith(".") || value.startsWith("~");
}

export async function runUpCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  let target: string | null = null;
  let agentName: string | undefined;
  let harness: string | undefined;
  let model: string | undefined;

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
    if (current === "--model") {
      const value = args[index + 1];
      if (!value) {
        throw new ScoutCliError("missing value for --model");
      }
      model = value;
      index += 1;
      continue;
    }
    if (current.startsWith("--model=")) {
      model = current.slice("--model=".length);
      continue;
    }
    if (current.startsWith("--")) {
      throw new ScoutCliError(`unexpected argument for up: ${current}`);
    }
    if (target) {
      throw new ScoutCliError(`unexpected arguments for up: ${args.join(" ")}`);
    }
    target = current;
  }

  if (!target) {
    throw new ScoutCliError("usage: scout up <name|path> [--name <alias>] [--harness <claude|codex>] [--model <model>]");
  }

  let projectPath: string;

  if (looksLikePath(target) || existsSync(resolve(target))) {
    projectPath = resolve(target);
  } else {
    const resolved = await resolveLocalAgentByName(target);
    if (!resolved) {
      const projectMatch = await resolveLocalAgentByName(target, { matchProjectName: true });
      if (projectMatch) {
        throw new ScoutCliError(
          `unknown agent "${target}" — that matches project "${projectMatch.projectRoot}", `
            + `but the registered agent is "${projectMatch.agentId}". `
            + `Use \`scout up ${projectMatch.agentId}\` or \`scout up "${projectMatch.projectRoot}"\`.`,
        );
      }
      throw new ScoutCliError(`unknown agent "${target}" — not a registered agent name or valid path`);
    }
    projectPath = resolved.projectRoot;
    agentName ??= resolved.definitionId;
  }

  const agent = await upScoutAgent({
    projectPath,
    agentName,
    harness: parseScoutHarness(harness),
    model,
    currentDirectory: defaultScoutContextDirectory(context),
  });

  context.output.writeValue(agent, renderScoutUpResult);
}
