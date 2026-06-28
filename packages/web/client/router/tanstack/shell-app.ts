import type { HudsonApp } from "@hudsonkit";

let scoutShellApp: HudsonApp | null = null;

export function registerScoutShellApp(app: HudsonApp): void {
  scoutShellApp = app;
}

export function getScoutShellApp(): HudsonApp {
  if (!scoutShellApp) {
    throw new Error("Scout shell app not registered — call registerScoutShellApp() before rendering the router");
  }
  return scoutShellApp;
}