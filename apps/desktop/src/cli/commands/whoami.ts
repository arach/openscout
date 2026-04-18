import { findNearestProjectRoot } from "@openscout/runtime/setup";

import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseContextRootCommandOptions } from "../options.ts";
import {
  resolveScoutAgentName,
  resolveScoutBrokerUrl,
  resolveScoutSenderId,
} from "../../core/broker/service.ts";

type ScoutWhoAmIReport = {
  askWatchId: string;
  sendSpeakId: string;
  envAgent: string | null;
  currentDirectory: string;
  projectRoot: string | null;
  brokerUrl: string;
};

async function loadScoutWhoAmIReport(
  context: ScoutCommandContext,
  currentDirectory: string,
): Promise<ScoutWhoAmIReport> {
  const askWatchId = resolveScoutAgentName(null);
  const sendSpeakId = await resolveScoutSenderId(null, currentDirectory);
  const projectRoot = await findNearestProjectRoot(currentDirectory);

  return {
    askWatchId,
    sendSpeakId,
    envAgent: context.env.OPENSCOUT_AGENT?.trim() || null,
    currentDirectory,
    projectRoot,
    brokerUrl: resolveScoutBrokerUrl(),
  };
}

function renderScoutWhoAmIReport(report: ScoutWhoAmIReport): string {
  const lines = [
    `Ask/Watch: ${report.askWatchId}`,
    `Send/Speak: ${report.sendSpeakId}`,
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
