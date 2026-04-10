import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { parseCardCreateCommandOptions } from "../options.ts";
import { createScoutAgentCard } from "../../core/agents/service.ts";
import { parseScoutHarness, resolveScoutAgentName } from "../../core/broker/service.ts";
import { renderRelayAgentCard } from "../../ui/terminal/cards.ts";

export async function runCardCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  if (subcommand !== "create") {
    throw new ScoutCliError("usage: scout card create [path] [--name <alias>] [--harness <claude|codex>] [--as <requester>] [--path <path>]");
  }

  const options = parseCardCreateCommandOptions(args.slice(1), defaultScoutContextDirectory(context));
  const card = await createScoutAgentCard({
    projectPath: options.projectPath,
    agentName: options.agentName,
    harness: parseScoutHarness(options.harness),
    currentDirectory: options.currentDirectory,
    createdById: resolveScoutAgentName(options.requesterId),
  });

  context.output.writeValue(card, renderRelayAgentCard);
}
