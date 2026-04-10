import {
  createScoutDesktopAppInfo,
  loadScoutDesktopHomeState,
  loadScoutDesktopMessagesWorkspaceState,
  loadScoutDesktopServicesState,
  loadScoutDesktopShellState,
  loadScoutPhonePreparation,
  updateScoutPhonePreparation,
  type ScoutDesktopAppInfo,
  type ScoutDesktopHomeState,
  type ScoutDesktopMessagesWorkspaceState,
  type ScoutDesktopServicesState,
  type ScoutDesktopShellState,
  type ScoutPhonePreparationState,
  type UpdateScoutPhonePreparationInput,
} from "../desktop/index.ts";
import { getScoutElectronPairingState } from "./pairing.ts";
import type { ScoutHostVoiceState as ScoutElectronVoiceState } from "./voice.ts";

export type ScoutElectronServiceOptions = {
  currentDirectory?: string;
  appInfo?: ScoutDesktopAppInfo;
  voice?: ScoutElectronVoiceService;
};

export type ScoutElectronVoiceService = {
  getVoiceState?: () => Promise<ScoutElectronVoiceState> | ScoutElectronVoiceState;
  toggleVoiceCapture?: () => Promise<void> | void;
  setVoiceRepliesEnabled?: (enabled: boolean) => Promise<void> | void;
};

function resolveCurrentDirectory(input?: string): string {
  return input ?? process.cwd();
}

export function getScoutElectronAppInfo(input: {
  appVersion?: string;
  isPackaged?: boolean;
  platform?: string;
} = {}): ScoutDesktopAppInfo {
  return createScoutDesktopAppInfo({ ...input, surface: "electron" });
}

export async function getScoutElectronServicesState(
  options: ScoutElectronServiceOptions = {},
): Promise<ScoutDesktopServicesState> {
  const currentDirectory = resolveCurrentDirectory(options.currentDirectory);
  const [servicesState, pairingState] = await Promise.all([
    loadScoutDesktopServicesState(),
    getScoutElectronPairingState(currentDirectory),
  ]);

  const pairingService = {
    id: "pairing" as const,
    title: "Pairing",
    status: pairingState.isRunning
      ? pairingState.status === "error"
        ? "degraded" as const
        : "running" as const
      : "offline" as const,
    statusLabel: pairingState.isRunning
      ? pairingState.status === "error"
        ? "Degraded"
        : "Running"
      : "Offline",
    healthy: pairingState.isRunning && pairingState.status !== "error",
    reachable: pairingState.isRunning,
    detail: pairingState.statusDetail ?? pairingState.statusLabel,
    lastHeartbeatLabel: pairingState.lastUpdatedLabel,
    updatedAtLabel: pairingState.lastUpdatedLabel ?? servicesState.updatedAtLabel,
    url: pairingState.relay,
    nodeId: null,
  };
  const nextServices = [...servicesState.services, pairingService];
  const runningCount = nextServices.filter((service) => service.status === "running").length;

  return {
    ...servicesState,
    subtitle: `${runningCount}/${nextServices.length} running`,
    services: nextServices,
  };
}

export async function getScoutElectronHomeState(
  options: ScoutElectronServiceOptions = {},
): Promise<ScoutDesktopHomeState> {
  const currentDirectory = resolveCurrentDirectory(options.currentDirectory);
  return loadScoutDesktopHomeState({ currentDirectory });
}

async function applyScoutElectronVoiceToMessagesWorkspaceState(
  messagesWorkspaceState: ScoutDesktopMessagesWorkspaceState,
  voiceService?: ScoutElectronVoiceService,
): Promise<ScoutDesktopMessagesWorkspaceState> {
  if (!voiceService?.getVoiceState) {
    return messagesWorkspaceState;
  }

  const voice = await voiceService.getVoiceState();
  return {
    ...messagesWorkspaceState,
    relay: {
      ...messagesWorkspaceState.relay,
      voice,
    },
  };
}

export async function getScoutElectronMessagesWorkspaceState(
  options: ScoutElectronServiceOptions = {},
): Promise<ScoutDesktopMessagesWorkspaceState> {
  const currentDirectory = resolveCurrentDirectory(options.currentDirectory);
  const messagesWorkspaceState = await loadScoutDesktopMessagesWorkspaceState({ currentDirectory });
  return applyScoutElectronVoiceToMessagesWorkspaceState(messagesWorkspaceState, options.voice);
}

async function applyScoutElectronVoiceState(
  shellState: ScoutDesktopShellState,
  voiceService?: ScoutElectronVoiceService,
): Promise<ScoutDesktopShellState> {
  if (!voiceService?.getVoiceState) {
    return shellState;
  }

  const voice = await voiceService.getVoiceState();
  return {
    ...shellState,
    relay: {
      ...shellState.relay,
      voice,
    },
  };
}

export async function getScoutElectronShellState(
  options: ScoutElectronServiceOptions = {},
): Promise<ScoutDesktopShellState> {
  const currentDirectory = resolveCurrentDirectory(options.currentDirectory);
  const shellState = await loadScoutDesktopShellState({
    currentDirectory,
    appInfo: options.appInfo ?? createScoutDesktopAppInfo(),
  });
  return applyScoutElectronVoiceState(shellState, options.voice);
}

export async function refreshScoutElectronShellState(
  options: ScoutElectronServiceOptions = {},
): Promise<ScoutDesktopShellState> {
  return getScoutElectronShellState(options);
}

export async function getScoutElectronPhonePreparation(
  currentDirectory = process.cwd(),
): Promise<ScoutPhonePreparationState> {
  return loadScoutPhonePreparation(currentDirectory);
}

export async function updateScoutElectronPhonePreparation(
  input: UpdateScoutPhonePreparationInput,
  currentDirectory = process.cwd(),
): Promise<ScoutPhonePreparationState> {
  return updateScoutPhonePreparation(currentDirectory, input);
}

export async function toggleScoutElectronVoiceCapture(
  options: ScoutElectronServiceOptions = {},
): Promise<ScoutDesktopShellState> {
  if (!options.voice?.toggleVoiceCapture) {
    throw new Error("Scout voice capture is unavailable.");
  }

  await options.voice.toggleVoiceCapture();
  return refreshScoutElectronShellState(options);
}

export async function setScoutElectronVoiceRepliesEnabled(
  enabled: boolean,
  options: ScoutElectronServiceOptions = {},
): Promise<ScoutDesktopShellState> {
  if (!options.voice?.setVoiceRepliesEnabled) {
    throw new Error("Scout voice playback control is unavailable.");
  }

  await options.voice.setVoiceRepliesEnabled(enabled);
  return refreshScoutElectronShellState(options);
}
