export {
  buildScoutVoiceHealthCommand,
  buildScoutVoiceSetRepliesEnabledCommand,
  buildScoutVoiceShutdownCommand,
  buildScoutVoiceSpeakCommand,
  buildScoutVoiceStopSpeakingCommand,
  buildScoutVoiceToggleCaptureCommand,
  createScoutVoiceBridgeStatus as createScoutElectronVoiceBridgeStatus,
  createScoutVoiceState as createScoutElectronVoiceState,
  isScoutVoiceCaptureActive as isScoutElectronVoiceCaptureActive,
  normalizeScoutVoiceCaptureState as normalizeScoutElectronVoiceCaptureState,
  scoutVoiceCaptureTitle as scoutElectronVoiceCaptureTitle,
  selectScoutVoicePlaybackMessage as selectScoutElectronVoicePlaybackMessage,
  type ScoutVoiceBridgeCommand as ScoutElectronVoiceBridgeCommand,
  type ScoutVoiceBridgeStatus as ScoutElectronVoiceBridgeStatus,
  type ScoutVoiceCaptureState as ScoutElectronVoiceCaptureState,
  type ScoutVoicePlaybackInput as ScoutElectronVoicePlaybackInput,
  type ScoutVoicePlaybackSelection as ScoutElectronVoicePlaybackSelection,
  type ScoutVoiceState as ScoutElectronVoiceState,
} from "../../core/voice/index.ts";

import {
  normalizeScoutVoiceCaptureState,
  scoutVoiceCaptureTitle,
  type ScoutVoiceState,
} from "../../core/voice/index.ts";

export function normalizeScoutElectronVoiceState(
  input: Partial<Omit<ScoutVoiceState, "captureState">> & { captureState?: string } = {},
): ScoutVoiceState {
  const captureState = normalizeScoutVoiceCaptureState(input.captureState);
  const repliesEnabled = Boolean(input.repliesEnabled);

  return {
    captureState,
    captureTitle: typeof input.captureTitle === "string" && input.captureTitle.trim().length > 0
      ? input.captureTitle
      : scoutVoiceCaptureTitle(captureState),
    repliesEnabled,
    detail: typeof input.detail === "string"
      ? input.detail
      : repliesEnabled
        ? "Playback ready."
        : "Voice playback is off.",
    isCapturing: Boolean(input.isCapturing),
    speaking: Boolean(input.speaking),
  };
}
