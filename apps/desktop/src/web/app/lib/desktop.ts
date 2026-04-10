import { getScoutDesktop } from "@/lib/electron";
import type { DesktopAppInfo } from "@/lib/scout-desktop";

export type AppRuntime = "electron" | "web";

export function getAppRuntime(): AppRuntime {
  return getScoutDesktop() ? "electron" : "web";
}

export function isDesktopRuntime() {
  return getAppRuntime() === "electron";
}

export async function getDesktopAppInfo(): Promise<DesktopAppInfo | null> {
  return (await getScoutDesktop()?.getAppInfo?.()) ?? null;
}
