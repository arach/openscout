import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseSendCommandOptions } from "../options.ts";
import {
  acquireScoutOnAir,
  getScoutVoiceForChannel,
  loadScoutRelayConfig,
  parseScoutHarness,
  releaseScoutOnAir,
  resolveScoutAgentName,
  sendScoutMessage,
  speakScoutText,
  stripScoutAgentSelectorLabels,
} from "../../core/broker/service.ts";
import { renderScoutMessagePostResult } from "../../ui/terminal/broker.ts";

export async function runSpeakCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseSendCommandOptions(args, defaultScoutContextDirectory(context));
  const senderId = resolveScoutAgentName(options.agentName);
  const config = await loadScoutRelayConfig();
  const voice = getScoutVoiceForChannel(config, "voice");

  await acquireScoutOnAir(senderId);
  try {
    const clean = stripScoutAgentSelectorLabels(options.message);
    if (clean) {
      await speakScoutText(clean, voice);
    }
  } finally {
    await releaseScoutOnAir();
  }

  const result = await sendScoutMessage({
    senderId,
    body: options.message,
    channel: "voice",
    shouldSpeak: true,
    executionHarness: parseScoutHarness(options.harness),
    currentDirectory: options.currentDirectory,
  });

  if (!result.usedBroker) {
    throw new Error("broker is not reachable");
  }

  context.output.writeValue(
    {
      message: options.message,
      invokedTargets: result.invokedTargets,
      unresolvedTargets: result.unresolvedTargets,
    },
    renderScoutMessagePostResult,
  );
}
