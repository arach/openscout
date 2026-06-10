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
import {
  normalizeCliBinaryMtimeMs,
  shouldEnsureBrokerUptodateForCommand,
  shouldRestartBrokerForCliMtime,
} from "./uptodate.ts";
import { SCOUT_APP_VERSION } from "../shared/product.ts";
import {
  resolveBrokerServiceConfig,
  type BrokerServiceMode,
} from "@openscout/runtime/broker-process-manager";

async function main() {
  const input = parseScoutArgv(process.argv.slice(2));
  const context = createScoutCommandContext({ outputMode: input.outputMode });
  let command = input.command;
  let commandArgs = input.args;

  // MCP stdio hosts expect the protocol handshake immediately; broker
  // maintenance here can leave the host terminal waiting with input disabled.
  if (shouldEnsureBrokerUptodateForCommand(command)) {
    // Restart broker if CLI was updated since last run
    await ensureBrokerUptodate((message) => context.stderr(message));
  }

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

/** Cached scout shim path — resolved once per process. */
let _scoutBinPath: string | null = null;

function getScoutBinPath(): string {
  if (_scoutBinPath) return _scoutBinPath;
  // Bun scripts: process.execPath is the bun binary, not the shim.
  // The shim is always at ~/.bun/bin/scout on macOS.
  _scoutBinPath = join(homedir(), ".bun", "bin", "scout");
  if (!existsSync(_scoutBinPath)) {
    // Fallback: resolve via $PATH
    _scoutBinPath = spawnSync("which", ["scout"], { encoding: "utf8" }).stdout.trim();
  }
  return _scoutBinPath;
}

/**
 * Returns the legacy launchd service label for a given service mode.
 *
 * Mirrors crates/scoutd/src/main.rs `legacy_service_label` (~line 805) — keep in sync.
 */
function legacyBrokerServiceLabel(mode: BrokerServiceMode): string {
  switch (mode) {
    case "prod":
      return "com.openscout.broker";
    case "custom":
      return "com.openscout.broker.custom";
    case "dev":
    default:
      return "dev.openscout.broker";
  }
}

/**
 * Detects if the CLI binary was updated (newer mtime than our checkpoint)
 * and silently restarts the broker to pick up the fresh runtime.
 */
async function ensureBrokerUptodate(report: (message: string) => void = () => undefined): Promise<void> {
  try {
    const mtime = normalizeCliBinaryMtimeMs(statSync(getScoutBinPath()).mtimeMs);
    const checkpointDir = join(homedir(), ".scout");
    const mtimePath = join(checkpointDir, "cli-mtime");

    const lastMtime = existsSync(mtimePath) ? Number(readFileSync(mtimePath, "utf8").trim()) : 0;

    if (shouldRestartBrokerForCliMtime(mtime, lastMtime)) {
      // CLI was updated — bounce the broker
      const config = resolveBrokerServiceConfig();
      const uid = config.uid;
      if (!uid) {
        return;
      }
      report("Scout CLI changed on disk; restarting the broker service to load the updated runtime.");
      const legacyLabel = legacyBrokerServiceLabel(config.mode);
      spawnSync("launchctl", ["bootout", `gui/${uid}/${legacyLabel}`], { stdio: "ignore" });
      spawnSync("launchctl", ["bootout", `gui/${uid}/${config.label}`], { stdio: "ignore" });
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      spawnSync("launchctl", ["bootstrap", `gui/${uid}`, config.launchAgentPath], { stdio: "ignore" });
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    }

    // Update checkpoint on every run
    if (!existsSync(checkpointDir)) {
      mkdirSync(checkpointDir, { recursive: true });
    }
    writeFileSync(mtimePath, String(mtime), { encoding: "utf8", flag: "w" });
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
