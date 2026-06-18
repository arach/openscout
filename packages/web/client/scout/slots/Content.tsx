import type { ReactNode } from "react";
import { useScout } from "../Provider.tsx";
import { resolveContentPane } from "../../screens/resolve-panes.tsx";

export function ScoutContent() {
  const { route, navigate } = useScout();
  return <ScoutSurface>{resolveContentPane(route, navigate)}</ScoutSurface>;
}

/** Paints the Scout content area background (since Hudson's Frame renders
 *  black chrome behind everything and doesn't read our theme tokens). */
function ScoutSurface({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--bg)",
        color: "var(--ink)",
        minHeight: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="scout-surface-body">
        {children}
      </div>
    </div>
  );
}
