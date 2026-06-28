import { OpenScoutAppShell } from "../../OpenScoutAppShell.tsx";
import { getScoutShellApp } from "./shell-app.ts";

/** Root layout — pane rendering stays on the Scout Route model, not TanStack outlets. */
export function ScoutAppRoot() {
  return <OpenScoutAppShell app={getScoutShellApp()} />;
}