import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  buildScoutVantagePlan,
  type ScoutVantagePlan,
  type TmuxSession,
} from "@openscout/runtime/vantage-plan";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

import { loadScoutBrokerContext } from "./core/broker/service.ts";

const execFileAsync = promisify(execFile);

export type OpenScoutVantageHandoffInput = {
  currentDirectory: string;
  agentId?: string | null;
  launch?: boolean;
  now?: Date;
  broker?: Awaited<ReturnType<typeof loadScoutBrokerContext>>;
  tmuxSessions?: readonly TmuxSession[];
};

export type OpenScoutVantageHandoff = {
  ok: true;
  schema: "openscout.vantage.handoff.v1";
  handoffId: string;
  handoffPath: string;
  openUrl: string;
  plan: ScoutVantagePlan;
  launch: {
    attempted: boolean;
    ok: boolean;
    error: string | null;
  };
};

export async function createOpenScoutVantageHandoff(
  input: OpenScoutVantageHandoffInput,
): Promise<OpenScoutVantageHandoff> {
  const broker = input.broker === undefined ? await loadScoutBrokerContext() : input.broker;
  const tmuxSessions = input.tmuxSessions ?? readTmuxSessions();
  const plan = buildScoutVantagePlan({
    currentDirectory: input.currentDirectory,
    broker,
    tmuxSessions,
    focusAgentId: input.agentId,
    now: input.now,
  });
  const handoffId = `handoff-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const handoffPath = writeVantageHandoffFile({
    handoffId,
    plan,
    source: "scout-web",
  });
  const openUrl = buildVantageOpenUrl({ handoffId, handoffPath });
  const launch = input.launch === false
    ? { attempted: false, ok: false, error: null }
    : await launchVantageOpenUrl(openUrl);

  return {
    ok: true,
    schema: "openscout.vantage.handoff.v1",
    handoffId,
    handoffPath,
    openUrl,
    plan,
    launch,
  };
}

function readTmuxSessions(): TmuxSession[] {
  try {
    const stdout = execFileSync("tmux", ["ls", "-F", "#{session_name}\t#{session_created}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, createdAtRaw] = line.split("\t");
        return {
          name,
          createdAt: createdAtRaw ? Number.parseInt(createdAtRaw, 10) : null,
        };
      });
  } catch {
    return [];
  }
}

function writeVantageHandoffFile(input: {
  handoffId: string;
  plan: ScoutVantagePlan;
  source: "scout-web";
}): string {
  const handoffDirectory = join(resolveOpenScoutSupportPaths().supportDirectory, "vantage", "handoffs");
  mkdirSync(handoffDirectory, { recursive: true });
  const handoffPath = join(handoffDirectory, `${input.handoffId}.json`);
  writeFileSync(
    handoffPath,
    `${JSON.stringify({
      kind: "openscout.vantage.handoff",
      schemaVersion: 1,
      handoffId: input.handoffId,
      source: input.source,
      createdAt: input.plan.createdAt,
      currentDirectory: input.plan.currentDirectory,
      focus: input.plan.manifest.focus,
      manifest: input.plan.manifest,
      diagnostics: input.plan.diagnostics,
      plan: input.plan,
    }, null, 2)}\n`,
    "utf8",
  );
  return handoffPath;
}

function buildVantageOpenUrl(input: { handoffId: string; handoffPath: string }): string {
  const params = new URLSearchParams({
    id: input.handoffId,
    handoff: input.handoffPath,
  });
  return `openscout-vantage://handoff?${params.toString()}`;
}

async function launchVantageOpenUrl(openUrl: string): Promise<OpenScoutVantageHandoff["launch"]> {
  if (process.platform !== "darwin") {
    return {
      attempted: false,
      ok: false,
      error: "Native Vantage launch is only supported on macOS.",
    };
  }

  try {
    await execFileAsync("/usr/bin/open", [openUrl]);
    return { attempted: true, ok: true, error: null };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
