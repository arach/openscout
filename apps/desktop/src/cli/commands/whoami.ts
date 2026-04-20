import { findNearestProjectRoot } from "@openscout/runtime/setup";

import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseContextRootCommandOptions } from "../options.ts";
import {
  resolveScoutBrokerUrl,
  resolveScoutSenderId,
} from "../../core/broker/service.ts";

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

export async function runWhoAmICommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseContextRootCommandOptions("whoami", args, defaultScoutContextDirectory(context));
  const report = await loadScoutWhoAmIReport(context, options.currentDirectory);
  context.output.writeValue(report, renderScoutWhoAmIReport);
}
