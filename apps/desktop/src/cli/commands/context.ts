import { resolve } from "node:path";

import {
  assembleContextPack,
  renderContextPackPrompt,
} from "@openscout/agent-sessions";
import { findNearestProjectRoot } from "@openscout/runtime/setup";

import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import {
  parseConstructiveCommandArgs,
  positiveInteger,
  readObservedSessionEvidence,
} from "../constructive-context.ts";
import { scoutAskHandler } from "../../core/broker/ask.ts";
import {
  listScoutContextBlocks,
  parseScoutHarness,
  recordScoutContextPack,
  resolveHumanAskSenderName,
  resolveScoutSenderId,
} from "../../core/broker/service.ts";

const HELP_FLAGS = new Set(["--help", "-h"]);

export function renderContextCommandHelp(): string {
  return [
    "Usage:",
    "  scout context preview --task <task> [--project <path>] [--harness <runtime>] [--from <session-file>] [--adapter <adapter>] [--max-tokens <n>]",
    "  scout context handoff --task <task> [--project <path>] [--harness <runtime>] [--from <session-file>] [--adapter <adapter>] [--max-tokens <n>]",
    "",
    "preview assembles a bounded context pack without dispatching work.",
    "handoff records the pack and starts a synthesized fork: a new execution session seeded with constructive context and explicit provenance.",
  ].join("\n");
}

export async function runContextCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  if (args.some((arg) => HELP_FLAGS.has(arg))) {
    context.output.writeText(renderContextCommandHelp());
    return;
  }
  const operation = args[0] ?? "preview";
  if (operation !== "preview" && operation !== "handoff") {
    throw new ScoutCliError(`unknown context operation: ${operation}`);
  }

  const parsed = parseConstructiveCommandArgs(args.slice(1));
  const task = (parsed.flags.get("--task") ?? parsed.positionals.join(" ")).trim();
  if (!task) throw new ScoutCliError(`context ${operation} requires --task <task>`);
  const requestedProject = parsed.flags.get("--project");
  const projectPath = requestedProject
    ? resolve(context.cwd, requestedProject)
    : await findNearestProjectRoot(context.cwd) ?? resolve(context.cwd);
  const harness = parsed.flags.get("--harness");
  const evidencePath = parsed.flags.get("--from");
  const evidence = evidencePath
    ? await readObservedSessionEvidence({
        path: evidencePath,
        adapterType: parsed.flags.get("--adapter"),
        cwd: context.cwd,
      })
    : undefined;
  const memories = await listScoutContextBlocks({
    kind: "memory",
    state: "active",
    limit: 500,
  });
  const pack = assembleContextPack({
    purpose: task,
    task,
    target: {
      projectPath,
      harness,
      sessionPolicy: operation === "handoff" ? "fork" : "new",
    },
    memories,
    evidence,
    createdById: "operator",
    maxTokens: positiveInteger(parsed.flags.get("--max-tokens"), 4_000),
    limitations: evidence?.limitations,
  });
  const prompt = renderContextPackPrompt(pack);

  if (operation === "preview") {
    context.output.writeValue({ pack, prompt }, (value) => value.prompt);
    return;
  }

  await recordScoutContextPack(pack);
  const senderId = await resolveScoutSenderId(
    resolveHumanAskSenderName(null, context.env),
    projectPath,
    context.env,
  );
  const receipt = await scoutAskHandler({
    senderId,
    projectPath,
    body: prompt,
    harness: parseScoutHarness(harness),
    session: "fork",
    forkFromStateId: pack.id,
    currentDirectory: projectPath,
    source: "scout-context-handoff",
  });
  if (!receipt.ok) {
    throw new ScoutCliError(receipt.error?.message ?? "context handoff was not accepted");
  }
  context.output.writeValue(
    { pack, receipt },
    (value) => [
      `Recorded context pack ${value.pack.id}.`,
      value.receipt.ids.flightId ? `Synthesized fork queued as flight ${value.receipt.ids.flightId}.` : "Synthesized fork queued.",
      value.receipt.ids.sessionAlias ? `Session alias: ${value.receipt.ids.sessionAlias}.` : "",
    ].filter(Boolean).join(" "),
  );
}
