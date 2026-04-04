import { parseScoutArgv } from "./argv.ts";
import { createScoutCommandContext } from "./context.ts";
import { ScoutCliError } from "./errors.ts";
import { SCOUT_COMMAND_HANDLERS } from "./commands/index.ts";
import { renderScoutHelp } from "./help.ts";
import { SCOUT_APP_VERSION } from "../shared/product.ts";

async function main() {
  const input = parseScoutArgv(process.argv.slice(2));
  const context = createScoutCommandContext({ outputMode: input.outputMode });
  const command = input.command;

  if (input.versionRequested) {
    context.output.writeText(SCOUT_APP_VERSION);
    return;
  }

  if (input.helpRequested || !command) {
    context.output.writeText(renderScoutHelp(SCOUT_APP_VERSION));
    return;
  }

  const handler = SCOUT_COMMAND_HANDLERS[command as keyof typeof SCOUT_COMMAND_HANDLERS];
  if (!handler) {
    throw new ScoutCliError(`unknown command: ${command}`);
  }

  await handler(context, input.args);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
}
