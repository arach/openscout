import { getScoutDesktop } from "@/lib/desktop-bridge";
import type { DesktopAppInfo } from "@/lib/scout-desktop";

export type AppRuntime = "desktop" | "web";

export function getAppRuntime(): AppRuntime {
  return getScoutDesktop() ? "desktop" : "web";
}

export function isDesktopRuntime() {
  return getAppRuntime() === "desktop";
}

export async function getDesktopAppInfo(): Promise<DesktopAppInfo | null> {
  return (await getScoutDesktop()?.getAppInfo?.()) ?? null;
}
