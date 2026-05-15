import { findNearestProjectRoot } from "@openscout/runtime/setup";

import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseContextRootCommandOptions } from "../options.ts";
import {
  resolveScoutBrokerUrl,
  resolveScoutSenderId,
} from "../../core/broker/service.ts";

const HELP_FLAGS = new Set(["--help", "-h"]);

type ScoutWhoAmIReport = {
  defaultSenderId: string;
  envAgent: string | null;
  currentDirectory: string;
  projectRoot: string | null;
  brokerUrl: string;
};

async function loadScoutWhoAmIReport(
  context: ScoutCommandContext,
  currentDirectory: string,
): Promise<ScoutWhoAmIReport> {
  const defaultSenderId = await resolveScoutSenderId(null, currentDirectory, context.env);
  const projectRoot = await findNearestProjectRoot(currentDirectory);

  return {
    defaultSenderId,
    envAgent: context.env.OPENSCOUT_AGENT?.trim() || null,
    currentDirectory,
    projectRoot,
    brokerUrl: resolveScoutBrokerUrl(),
  };
}

function renderScoutWhoAmIReport(report: ScoutWhoAmIReport): string {
  const lines = [
    `Default Sender: ${report.defaultSenderId}`,
    `Current Directory: ${report.currentDirectory}`,
    `Broker: ${report.brokerUrl}`,
  ];

  if (report.projectRoot) {
    lines.splice(3, 0, `Project Root: ${report.projectRoot}`);
  }

  if (report.envAgent) {
    lines.splice(2, 0, `OPENSCOUT_AGENT: ${report.envAgent}`);
  }

  return lines.join("\n");
}

export function renderWhoAmICommandHelp(): string {
  return [
    "Usage: scout whoami [--context-root <path>] [--json]",
    "",
    "Show the current Scout sender and broker context.",
    "",
    "The report includes the default sender id, current directory, nearest Scout project root when found,",
    "OPENSCOUT_AGENT when it overrides the sender, and the broker URL the CLI will contact.",
    "",
    "Examples:",
    "  scout whoami",
    "  scout whoami --context-root ~/dev/openscout --json",
  ].join("\n");
}

export async function runWhoAmICommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  if (args.some((arg) => HELP_FLAGS.has(arg))) {
    context.output.writeText(renderWhoAmICommandHelp());
    return;
  }

  const options = parseContextRootCommandOptions("whoami", args, defaultScoutContextDirectory(context));
  const report = await loadScoutWhoAmIReport(context, options.currentDirectory);
  context.output.writeValue(report, renderScoutWhoAmIReport);
}
