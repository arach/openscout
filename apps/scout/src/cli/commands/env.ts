import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseContextRootCommandOptions } from "../options.ts";
import { resolveScoutBrokerUrl } from "../../core/broker/service.ts";
import { resolveScoutAppRoot, resolveScoutWorkspaceRoot } from "../../shared/paths.ts";

type ScoutEnvReport = {
  executable: {
    command: string;
    fallbackCommand: string;
    scoutPath: string | null;
  };
  agent: {
    resolvedId: string;
    envAgent: string | null;
  };
  context: {
    cwd: string;
    currentDirectory: string;
    setupCwd: string | null;
    workspaceRoot: string;
    appRoot: string;
    binPath: string;
  };
  broker: {
    url: string;
  };
};

function resolveCommandOnPath(command: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? "";
  for (const directory of pathValue.split(":")) {
    const trimmed = directory.trim();
    if (!trimmed) {
      continue;
    }
    const candidate = join(trimmed, command);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function loadScoutEnvReport(
  context: ScoutCommandContext,
  currentDirectory: string,
): ScoutEnvReport {
  const workspaceRoot = resolveScoutWorkspaceRoot();
  const appRoot = resolveScoutAppRoot();
  const binPath = join(appRoot, "bin", "scout.ts");
  const scoutPath = resolveCommandOnPath("scout", context.env);
  const fallbackCommand = `bun ${binPath}`;

  return {
    executable: {
      command: scoutPath ? "scout" : fallbackCommand,
      fallbackCommand,
      scoutPath,
    },
    agent: {
      resolvedId: context.env.OPENSCOUT_AGENT?.trim() || "operator",
      envAgent: context.env.OPENSCOUT_AGENT?.trim() || null,
    },
    context: {
      cwd: context.cwd,
      currentDirectory,
      setupCwd: context.env.OPENSCOUT_SETUP_CWD?.trim() || null,
      workspaceRoot,
      appRoot,
      binPath,
    },
    broker: {
      url: resolveScoutBrokerUrl(),
    },
  };
}

function renderScoutEnvReport(report: ScoutEnvReport): string {
  return [
    `Command: ${report.executable.command}`,
    `Fallback: ${report.executable.fallbackCommand}`,
    `Agent: ${report.agent.resolvedId}`,
    `Current Directory: ${report.context.currentDirectory}`,
    `Broker: ${report.broker.url}`,
  ].join("\n");
}

export async function runEnvCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseContextRootCommandOptions("env", args, defaultScoutContextDirectory(context));
  const report = loadScoutEnvReport(context, options.currentDirectory);
  context.output.writeValue(report, renderScoutEnvReport);
}
