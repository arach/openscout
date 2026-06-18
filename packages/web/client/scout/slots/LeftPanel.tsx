import { useScout } from "../Provider.tsx";
import { GlobalJumpDock } from "./GlobalJumpDock.tsx";
import { resolveLeftPane } from "../../screens/resolve-panes.tsx";

export function ScoutLeftPanel() {
  const { route } = useScout();

  return (
    <div className="scout-left-shell">
      <div className="scout-left-shell-rail">{resolveLeftPane(route)}</div>
      <GlobalJumpDock />
    </div>
  );
}
