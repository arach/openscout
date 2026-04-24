import { createInterface } from "node:readline";

import { resolveLocalAgentIdentity } from "@openscout/runtime/local-agents";

import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { parseCardCreateCommandOptions } from "../options.ts";
import { createScoutAgentCard } from "../../core/agents/service.ts";
import { parseScoutHarness, resolveScoutAgentName } from "../../core/broker/service.ts";
import { renderScoutAgentCard } from "../../ui/terminal/cards.ts";

const HELP_FLAGS = new Set(["help", "--help", "-h"]);

export function renderCardCommandHelp(): string {
  return [
    "Usage: scout card create [path] [--name <alias>] [--display-name <name>] [--harness <claude|codex>] [--model <model>] [--as <requester>] [--no-input] [--path <path>]",
    "",
    "Create a dedicated Scout agent card with a reply-ready return address.",
    "",
    "Use this when another agent should get back to you on a fresh project-scoped inbox,",
    "or when a worktree needs its own obvious handle instead of reusing a shared project agent.",
    "",
    "Examples:",
    "  scout card create",
    '  scout card create ~/dev/openscout-worktrees/shell-fix --name shellfix --harness claude --model claude-sonnet-4-6',
  ].join("\n");
}

function promptWithDefault(question: string, defaultValue: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`  ${question} [${defaultValue}]: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

export async function runCardCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  if (!subcommand || HELP_FLAGS.has(subcommand)) {
    context.output.writeText(renderCardCommandHelp());
    return;
  }
  if (subcommand !== "create") {
    throw new ScoutCliError(renderCardCommandHelp());
  }
  if (args.slice(1).some((arg) => HELP_FLAGS.has(arg))) {
    context.output.writeText(renderCardCommandHelp());
    return;
  }

  const options = parseCardCreateCommandOptions(args.slice(1), defaultScoutContextDirectory(context));

  let agentName = options.agentName;
  let displayName = options.displayName;

  const shouldPrompt = context.isTty && !options.noInput && !options.agentName && !options.displayName;

  if (shouldPrompt) {
    const identity = await resolveLocalAgentIdentity({
      projectPath: options.projectPath,
      agentName: options.agentName,
      displayName: options.displayName,
      harness: parseScoutHarness(options.harness),
      currentDirectory: options.currentDirectory,
    });

    context.stderr("");
    context.stderr("  Proposed agent card:");
    context.stderr(`    Alias:   ${identity.definitionId}`);
    context.stderr(`    Display: ${identity.displayName}`);
    if (identity.branch) {
      context.stderr(`    Branch:  ${identity.branch}`);
    }
    context.stderr(`    Node:    ${identity.nodeQualifier}`);
    context.stderr(`    Harness: ${identity.harness}`);
    context.stderr(`    Source:  ${identity.source === "config" ? "project config" : identity.source === "existing" ? "existing agent" : "auto-detected"}`);
    context.stderr("");

    const confirmedAlias = await promptWithDefault("Alias", identity.definitionId);
    const confirmedDisplayName = await promptWithDefault("Display name", identity.displayName);
    context.stderr("");

    if (confirmedAlias !== identity.definitionId) {
      agentName = confirmedAlias;
    }
    if (confirmedDisplayName !== identity.displayName) {
      displayName = confirmedDisplayName;
    }
  }

  const card = await createScoutAgentCard({
    projectPath: options.projectPath,
    agentName: agentName,
    displayName: displayName,
    harness: parseScoutHarness(options.harness),
    model: options.model,
    currentDirectory: options.currentDirectory,
    createdById: resolveScoutAgentName(options.requesterId),
  });

  context.output.writeValue(card, renderScoutAgentCard);
}
