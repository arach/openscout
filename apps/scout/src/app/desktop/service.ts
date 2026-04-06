import { readOpenScoutSettings, writeOpenScoutSettings } from "@openscout/runtime/setup";

import { SCOUT_APP_VERSION, SCOUT_PRODUCT_NAME } from "../../shared/product.ts";
import type {
  ScoutDesktopAppInfo,
  ScoutDesktopHomeState,
  ScoutDesktopServicesState,
  ScoutDesktopFeatureFlags,
  ScoutDesktopShellPatch,
  ScoutDesktopShellState,
  ScoutPhonePreparationState,
  UpdateScoutPhonePreparationInput,
} from "./state.ts";
import {
  composeScoutDesktopHomeState,
  composeScoutDesktopRelayShellPatch,
  composeScoutDesktopServicesState,
  composeScoutDesktopShellState,
} from "./shell.ts";

export function createScoutDesktopFeatureFlags(input: Partial<ScoutDesktopFeatureFlags> = {}): ScoutDesktopFeatureFlags {
  const enableAll = input.enableAll ?? false;

  return {
    enableAll,
    overview: input.overview ?? true,
    relay: input.relay ?? true,
    pairing: input.pairing ?? true,
    interAgent: input.interAgent ?? true,
    agents: input.agents ?? true,
    settings: input.settings ?? true,
    logs: input.logs ?? true,
    activity: input.activity ?? enableAll,
    machines: input.machines ?? enableAll,
    plans: input.plans ?? enableAll,
    sessions: input.sessions ?? true,
    search: input.search ?? true,
    telegram: input.telegram ?? enableAll,
    voice: input.voice ?? enableAll,
    monitor: input.monitor ?? true,
    phonePreparation: input.phonePreparation ?? true,
  };
}

export function createScoutDesktopAppInfo(input: {
  productName?: string;
  appVersion?: string;
  isPackaged?: boolean;
  platform?: string;
  features?: Partial<ScoutDesktopFeatureFlags>;
} = {}): ScoutDesktopAppInfo {
  const configuredProductName = process.env.SCOUT_PRODUCT_NAME?.trim();
  const configuredAppVersion = process.env.SCOUT_APP_VERSION?.trim();

  return {
    productName: input.productName ?? configuredProductName ?? SCOUT_PRODUCT_NAME,
    appVersion: input.appVersion ?? configuredAppVersion ?? SCOUT_APP_VERSION,
    isPackaged: input.isPackaged ?? false,
    platform: input.platform ?? process.platform,
    features: createScoutDesktopFeatureFlags(input.features),
  };
}

export async function loadScoutPhonePreparation(currentDirectory: string): Promise<ScoutPhonePreparationState> {
  const settings = await readOpenScoutSettings({ currentDirectory });
  return {
    favorites: [...settings.phone.favorites],
    quickHits: [...settings.phone.quickHits],
    preparedAt: settings.phone.preparedAt,
  };
}

export async function updateScoutPhonePreparation(
  currentDirectory: string,
  input: UpdateScoutPhonePreparationInput,
): Promise<ScoutPhonePreparationState> {
  await writeOpenScoutSettings({
    phone: {
      favorites: [...input.favorites],
      quickHits: [...input.quickHits],
      preparedAt: input.preparedAt,
    },
  }, {
    currentDirectory,
  });

  return loadScoutPhonePreparation(currentDirectory);
}

export async function loadScoutDesktopShellState(input: {
  appInfo?: ScoutDesktopAppInfo;
  currentDirectory: string;
}): Promise<ScoutDesktopShellState> {
  const appInfo = input.appInfo ?? createScoutDesktopAppInfo();
  return composeScoutDesktopShellState({
    appInfo,
    currentDirectory: input.currentDirectory,
  });
}

export async function loadScoutDesktopServicesState(): Promise<ScoutDesktopServicesState> {
  return composeScoutDesktopServicesState();
}

export async function loadScoutDesktopHomeState(input: {
  currentDirectory: string;
}): Promise<ScoutDesktopHomeState> {
  return composeScoutDesktopHomeState({
    currentDirectory: input.currentDirectory,
  });
}

export async function loadScoutDesktopRelayShellPatch(input: {
  currentDirectory: string;
}): Promise<ScoutDesktopShellPatch> {
  return composeScoutDesktopRelayShellPatch({
    currentDirectory: input.currentDirectory,
  });
}
