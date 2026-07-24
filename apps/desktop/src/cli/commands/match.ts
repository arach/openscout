import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  SCOUT_RENDEZVOUS_MAX_WAIT_MS,
  type ScoutRendezvousResponse,
} from "@openscout/protocol";
import { findNearestProjectRoot } from "@openscout/runtime/setup";

import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import {
  matchScoutRendezvous,
  resolveScoutSenderId,
} from "../../core/broker/service.ts";

const HELP_FLAGS = new Set(["help", "--help", "-h"]);

type MatchCommandOptions = {
  agentName: string | null;
  projectPath: string | null;
  topic: string;
  waitMs: number;
};

export function renderMatchCommandHelp(): string {
  return [
    "Usage: scout match [--as <agent>] [--project <path>] [--wait <seconds>] <topic>",
    "",
    "Rendezvous with one other live Scout participant using a shared project-scoped phrase.",
    "The topic is temporary: it is not a channel, room, alias, or durable conversation.",
    "",
    "The first participant waits briefly. The second participant using the same topic",
    "in the same project resolves the match. A third participant is told to choose",
    "a more specific topic instead of being silently cross-connected.",
    "",
    "Examples:",
    '  scout match "review the parser"',
    '  scout match --as codex.parser --wait 10 "review the parser"',
    '  scout match --project ../talkie "compare auth"',
    '  scout match --wait 0 "release handoff" --json',
  ].join("\n");
}

export function parseMatchCommandOptions(args: string[]): MatchCommandOptions {
  let agentName: string | null = null;
  let projectPath: string | null = null;
  let waitMs = SCOUT_RENDEZVOUS_MAX_WAIT_MS;
  const topicParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--as" || arg.startsWith("--as=")) {
      const parsed = flagValue(args, index, "--as");
      agentName = parsed.value;
      index = parsed.index;
      continue;
    }
    if (arg === "--project" || arg.startsWith("--project=")) {
      const parsed = flagValue(args, index, "--project");
      projectPath = parsed.value;
      index = parsed.index;
      continue;
    }
    if (arg === "--wait" || arg.startsWith("--wait=")) {
      const parsed = flagValue(args, index, "--wait");
      const seconds = Number(parsed.value);
      if (
        !Number.isFinite(seconds)
        || seconds < 0
        || seconds * 1_000 > SCOUT_RENDEZVOUS_MAX_WAIT_MS
      ) {
        throw new ScoutCliError(
          `--wait must be between 0 and ${SCOUT_RENDEZVOUS_MAX_WAIT_MS / 1_000} seconds`,
        );
      }
      waitMs = Math.round(seconds * 1_000);
      index = parsed.index;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new ScoutCliError(`unexpected argument for match: ${arg}`);
    }
    topicParts.push(arg);
  }

  const topic = topicParts.join(" ").trim();
  if (!topic) {
    throw new ScoutCliError(renderMatchCommandHelp());
  }
  return { agentName, projectPath, topic, waitMs };
}

export async function runMatchCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  if (args.some((arg) => HELP_FLAGS.has(arg))) {
    context.output.writeText(renderMatchCommandHelp());
    return;
  }
  const options = parseMatchCommandOptions(args);
  const contextDirectory = defaultScoutContextDirectory(context);
  const projectRoot = await resolveMatchProjectRoot(options.projectPath, contextDirectory);
  const participantId = await resolveScoutSenderId(
    options.agentName,
    projectRoot,
    context.env,
  );

  if (context.output.mode === "plain" && options.waitMs > 0) {
    context.stderr(
      `Waiting for another Scout participant on "${options.topic}" in ${basename(projectRoot)}…`,
    );
  }

  const response = await matchScoutRendezvous({
    topic: options.topic,
    projectRoot,
    participantId,
    waitMs: options.waitMs,
  });
  context.output.writeValue(response, renderMatchResponse);
}

async function resolveMatchProjectRoot(
  projectPath: string | null,
  currentDirectory: string,
): Promise<string> {
  if (projectPath) {
    try {
      return await realpath(resolve(currentDirectory, projectPath));
    } catch {
      throw new ScoutCliError(`match project path does not exist: ${projectPath}`);
    }
  }
  const nearest = await findNearestProjectRoot(currentDirectory);
  if (!nearest) {
    throw new ScoutCliError(
      "scout match requires a project scope; run inside a project or pass --project <path>",
    );
  }
  try {
    return await realpath(nearest);
  } catch {
    return resolve(nearest);
  }
}

function renderMatchResponse(response: ScoutRendezvousResponse): string {
  const projectName = basename(response.projectRoot);
  if (response.status === "matched") {
    const peers = response.peerParticipantIds.join(", ");
    return [
      `Matched with ${peers} in ${projectName}.`,
      `Temporary handoff: ${response.matchId}`,
      `Continue: scout send --to ${peers} "<message>"`,
    ].join("\n");
  }
  if (response.status === "topic_busy") {
    return `That topic already has a two-participant match in ${projectName}. Use a more specific topic.`;
  }
  const seconds = Math.max(0, Math.ceil((response.expiresAt - Date.now()) / 1_000));
  return `Still waiting on "${response.topic}" in ${projectName}. Presence expires in ${seconds}s; run the same command again to keep waiting.`;
}

function flagValue(
  args: string[],
  index: number,
  flag: string,
): { value: string; index: number } {
  const current = args[index] ?? "";
  if (current.startsWith(`${flag}=`)) {
    const value = current.slice(flag.length + 1).trim();
    if (!value) throw new ScoutCliError(`missing value for ${flag}`);
    return { value, index };
  }
  const value = args[index + 1]?.trim();
  if (!value) throw new ScoutCliError(`missing value for ${flag}`);
  return { value, index: index + 1 };
}
