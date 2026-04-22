import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { parseScoutArgv } from "./argv.ts";
import { createScoutCommandContext, defaultScoutContextDirectory } from "./context.ts";
import { ScoutCliError } from "./errors.ts";
import { runAskWithOptions } from "./commands/ask.ts";
import { loadScoutCommandHandler } from "./commands/index.ts";
import { renderScoutHelp } from "./help.ts";
import { parseImplicitAskCommandOptions } from "./options.ts";
import { findScoutCommandRegistration } from "./registry.ts";
import { SCOUT_APP_VERSION } from "../shared/product.ts";

async function main() {
  const input = parseScoutArgv(process.argv.slice(2));
  const context = createScoutCommandContext({ outputMode: input.outputMode });
  let command = input.command;
  let commandArgs = input.args;

  // Restart broker if CLI was updated since last run
  await ensureBrokerUptodate();

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
  const handler = await loadScoutCommandHandler(resolvedCommand as Parameters<typeof loadScoutCommandHandler>[0]);
  await handler(context, commandArgs);
}

/**
 * Detects if the CLI binary was updated (newer mtime than our checkpoint)
 * and silently restarts the broker to pick up the fresh runtime.
 */
async function ensureBrokerUptodate(): Promise<void> {
  try {
    // Bun scripts: process.execPath is the bun binary, not the shim.
    // Find the actual scout shim whose mtime updates on `bun add -g`.
    const scoutBin = spawnSync("which", ["scout"], { encoding: "utf8" }).stdout.trim();
    const mtime = statSync(scoutBin).mtimeMs;
    const checkpointDir = join(homedir(), ".scout");
    const mtimePath = join(checkpointDir, "cli-mtime");

    const lastMtime = existsSync(mtimePath) ? Number(readFileSync(mtimePath, "utf8").trim()) : 0;

    if (mtime > lastMtime) {
      // CLI was updated — bounce the broker
      const uid = process.getuid();
      const plistPath = join(homedir(), "Library", "LaunchAgents", "dev.openscout.broker.plist");
      spawnSync("launchctl", ["bootout", `gui/${uid}/dev.openscout.broker`], { stdio: "ignore" });
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      spawnSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath], { stdio: "ignore" });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    }

    // Update checkpoint on every run
    if (!existsSync(checkpointDir)) {
      mkdirSync(checkpointDir, { recursive: true });
    }
    writeFileSync(mtimePath, String(Math.floor(mtime)), { encoding: "utf8", flag: "w" });
  } catch {
    // Non-fatal: don't block command execution if broker check fails
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
}
