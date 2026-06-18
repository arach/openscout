import type { Route } from "../../lib/types.ts";
import type { useScout } from "../../scout/Provider.tsx";
import { TerminalScreen } from "./TerminalScreen.tsx";

type Navigate = ReturnType<typeof useScout>["navigate"];

export function TerminalContent({ route, navigate }: { route: Route; navigate: Navigate }) {
  if (route.view !== "terminal") return null;
  return (
    <TerminalScreen
      agentId={route.agentId}
      mode={route.mode}
      terminalSessionId={route.terminalSessionId}
      terminalSurfaceKey={route.terminalSurfaceKey}
      navigate={navigate}
    />
  );
}
