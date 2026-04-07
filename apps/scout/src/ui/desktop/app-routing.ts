import { settingsPath, type SettingsSectionId } from "@/settings/settings-paths";
import type { AppView, ProductSurface } from "@/app-types";

export const PRODUCT_SURFACES = ["relay", "pairing"] as const satisfies readonly ProductSurface[];

export const APP_VIEW_IDS: readonly AppView[] = [
  "overview",
  "inbox",
  "activity",
  "machines",
  "plans",
  "sessions",
  "search",
  "messages",
  "relay",
  "inter-agent",
  "agents",
  "logs",
  "settings",
  "help",
];

export function isProductSurface(value: string | null): value is ProductSurface {
  return value !== null && (PRODUCT_SURFACES as readonly string[]).includes(value);
}

export function isAppView(value: string | null): value is AppView {
  return value !== null && (APP_VIEW_IDS as readonly string[]).includes(value);
}

export function parseRelayViewPath(pathname: string): AppView | null {
  if (pathname === "/") {
    return "overview";
  }

  const segment = pathname.slice(1).split("/")[0] ?? "";
  if (!segment || segment === "pairing" || segment === "settings") {
    return null;
  }

  return isAppView(segment) ? segment : null;
}

export function buildDesktopPath(surface: ProductSurface, view: AppView, settingsSection: SettingsSectionId): string {
  if (surface === "pairing") {
    return "/pairing";
  }

  if (view === "settings") {
    return settingsPath(settingsSection);
  }

  return view === "overview" ? "/" : `/${view}`;
}
