import { parseScoutArgv } from "./argv.ts";
import { createScoutCommandContext, defaultScoutContextDirectory } from "./context.ts";
import { ScoutCliError } from "./errors.ts";
import { runAskWithOptions } from "./commands/ask.ts";
import { SCOUT_COMMAND_HANDLERS } from "./commands/index.ts";
import { renderScoutHelp } from "./help.ts";
import { parseImplicitAskCommandOptions } from "./options.ts";
import { findScoutCommandRegistration } from "./registry.ts";
import { SCOUT_APP_VERSION } from "../shared/product.ts";

async function main() {
  const input = parseScoutArgv(process.argv.slice(2));
  const context = createScoutCommandContext({ outputMode: input.outputMode });
  let command = input.command;
  let commandArgs = input.args;

  if (input.versionRequested) {
    context.output.writeText(SCOUT_APP_VERSION);
    return;
  }

  if (input.helpRequested || !command) {
    context.output.writeText(renderScoutHelp(SCOUT_APP_VERSION));
    return;
  }

  if (command === "relay") {
    command = commandArgs[0] ?? null;
    commandArgs = commandArgs.slice(1);
    if (!command || command === "help" || command === "--help" || command === "-h") {
      context.output.writeText(renderScoutHelp(SCOUT_APP_VERSION));
      return;
    }
  }

  const registration = findScoutCommandRegistration(command);
  if (!registration) {
    const implicitPromptArgs = [command, ...commandArgs];
    try {
      const options = parseImplicitAskCommandOptions(implicitPromptArgs, defaultScoutContextDirectory(context));
      await runAskWithOptions(context, options);
      return;
    } catch (error) {
      if (error instanceof ScoutCliError && error.message.startsWith("implicit ask requires")) {
        throw new ScoutCliError(`unknown command: ${command}`);
      }
      throw error;
    }
  }

  if (registration.status === "deprecated" && registration.deprecationMessage) {
    context.stderr(`warning: ${registration.deprecationMessage}`);
  }

  const resolvedCommand = registration.canonicalName ?? registration.name;
  const handler = SCOUT_COMMAND_HANDLERS[resolvedCommand as keyof typeof SCOUT_COMMAND_HANDLERS];
  if (!handler) {
    throw new ScoutCliError(`unknown command: ${resolvedCommand}`);
  }

  await handler(context, commandArgs);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
}
