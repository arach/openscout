import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseEnrollCommandOptions } from "../options.ts";
import { buildScoutEnrollmentPrompt, resolveScoutAgentName } from "../../core/broker/service.ts";

export async function runEnrollCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseEnrollCommandOptions(args, defaultScoutContextDirectory(context));
  const prompt = buildScoutEnrollmentPrompt({
    agentId: resolveScoutAgentName(options.agentName),
    task: options.task,
  });

  context.output.writeValue(
    {
      agentId: resolveScoutAgentName(options.agentName),
      task: options.task ?? null,
      prompt,
    },
    (value) => value.prompt,
  );
}
