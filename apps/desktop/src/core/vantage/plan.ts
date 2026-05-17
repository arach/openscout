import { readTmuxSessions, type TmuxSession } from "../../app/desktop/shell-probes.ts";
import { loadScoutBrokerContext, type ScoutBrokerContext } from "../broker/service.ts";
import {
  buildScoutVantagePlan,
  type ScoutVantagePlan,
} from "@openscout/runtime/vantage-plan";

export * from "@openscout/runtime/vantage-plan";

export type ScoutVantageEnvironmentInput = {
  currentDirectory: string;
  broker?: ScoutBrokerContext | null;
  tmuxSessions?: readonly TmuxSession[];
  focusAgentId?: string | null;
  now?: Date;
};

export async function buildScoutVantagePlanFromEnvironment(
  input: ScoutVantageEnvironmentInput,
): Promise<ScoutVantagePlan> {
  const broker = input.broker === undefined ? await loadScoutBrokerContext() : input.broker;
  const tmuxSessions = input.tmuxSessions ?? readTmuxSessions();
  return buildScoutVantagePlan({
    currentDirectory: input.currentDirectory,
    broker,
    tmuxSessions,
    focusAgentId: input.focusAgentId,
    now: input.now,
  });
}
