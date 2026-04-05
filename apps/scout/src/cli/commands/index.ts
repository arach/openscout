import type { ScoutCommandContext } from "../context.ts";
import { runAskCommand } from "./ask.ts";
import { runBroadcastCommand } from "./broadcast.ts";
import { runCardCommand } from "./card.ts";
import { runDownCommand } from "./down.ts";
import { runDoctorCommand } from "./doctor.ts";
import { runEnrollCommand } from "./enroll.ts";
import { runEnvCommand } from "./env.ts";
import { runPairCommand } from "./pair.ts";
import { runPsCommand } from "./ps.ts";
import { runRestartCommand } from "./restart.ts";
import { runRuntimesCommand } from "./runtimes.ts";
import { runSendCommand } from "./send.ts";
import { runSetupCommand } from "./setup.ts";
import { runSpeakCommand } from "./speak.ts";
import { runTuiCommand } from "./tui.ts";
import { runUpCommand } from "./up.ts";
import { runWatchCommand } from "./watch.ts";
import { runWhoCommand } from "./who.ts";

export type ScoutCommandHandler = (context: ScoutCommandContext, args: string[]) => Promise<void>;

export const SCOUT_COMMAND_HANDLERS: Record<string, ScoutCommandHandler> = {
  ask: runAskCommand,
  broadcast: runBroadcastCommand,
  card: runCardCommand,
  down: runDownCommand,
  doctor: runDoctorCommand,
  enroll: runEnrollCommand,
  env: runEnvCommand,
  pair: runPairCommand,
  ps: runPsCommand,
  restart: runRestartCommand,
  runtimes: runRuntimesCommand,
  send: runSendCommand,
  setup: runSetupCommand,
  speak: runSpeakCommand,
  tui: runTuiCommand,
  up: runUpCommand,
  watch: runWatchCommand,
  who: runWhoCommand,
};

export type ScoutCommandName = keyof typeof SCOUT_COMMAND_HANDLERS;
