import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseAskCommandOptions } from "../options.ts";
import {
  askScoutQuestion,
  parseScoutHarness,
  resolveScoutAgentName,
  resolveScoutBrokerUrl,
  waitForScoutFlight,
} from "../../core/broker/service.ts";

export async function runAskCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseAskCommandOptions(args, defaultScoutContextDirectory(context));
  const result = await askScoutQuestion({
    senderId: resolveScoutAgentName(options.agentName),
    targetLabel: options.targetLabel,
    body: options.message,
    channel: options.channel,
    executionHarness: parseScoutHarness(options.harness),
    currentDirectory: options.currentDirectory,
  });

  if (!result.usedBroker) {
    throw new Error("broker is not reachable");
  }
  if (!result.flight) {
    throw new Error(`target ${options.targetLabel} is not currently routable`);
  }

  context.stderr(`asking ${result.flight.targetAgentId}... (flight ${result.flight.id})`);
  const completed = await waitForScoutFlight(
    resolveScoutBrokerUrl(),
    result.flight.id,
    {
      timeoutSeconds: options.timeoutSeconds,
      onUpdate: (_flight, detail) => context.stderr(detail),
    },
  );

  context.output.writeValue(
    {
      flight: completed,
      output: completed.output ?? completed.summary ?? "",
    },
    (value) => value.output,
  );
}
