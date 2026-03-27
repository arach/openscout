import {
  getOpenScoutDesktop,
  type OpenScoutDesktopAppInfo,
} from "@/lib/electron";

export type AppRuntime = "electron" | "web";

export function getAppRuntime(): AppRuntime {
  return getOpenScoutDesktop() ? "electron" : "web";
}

export function isDesktopRuntime() {
  return getAppRuntime() === "electron";
}

export async function getDesktopAppInfo(): Promise<OpenScoutDesktopAppInfo | null> {
  return (await getOpenScoutDesktop()?.getAppInfo?.()) ?? null;
}
