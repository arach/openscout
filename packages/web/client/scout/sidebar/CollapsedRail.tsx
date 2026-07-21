/**
 * OpenScout-owned collapsed rail wrapper (SCO-086).
 *
 * HudsonKit SidePanel collapses to a 0-width floating button — not a rail.
 * Sidebar chrome needs a real ~48px collapsed strip that hosts the shared
 * RailToggle (+ optional minimal glyph). Distinct from HIDDEN (0px, no rail).
 */
import type { CSSProperties, ReactNode } from "react";
import { RailToggle, type RailToggleSide } from "../../components/RailToggle.tsx";
import { RAIL_COLLAPSED_WIDTH } from "./sidebar-collapse-state.ts";

export function CollapsedRail({
  side,
  title,
  onToggle,
  /** Distance from the viewport edge this rail attaches to (px). */
  edgeOffset = 0,
  top = 0,
  width = RAIL_COLLAPSED_WIDTH,
  glyph,
  style,
  className = "",
}: {
  side: RailToggleSide;
  title: string;
  onToggle: () => void;
  edgeOffset?: number;
  top?: number;
  width?: number;
  /** Optional minimal state glyph below the toggle. */
  glyph?: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <aside
      data-scout-collapsed-rail=""
      data-side={side}
      data-pane={side === "left" ? "side-rail-collapsed" : "inspector-collapsed"}
      className={`scout-collapsed-rail${className ? ` ${className}` : ""}`}
      style={{
        position: "fixed",
        top,
        bottom: 28,
        width,
        zIndex: 40,
        ...(side === "left" ? { left: edgeOffset } : { right: edgeOffset }),
        ...style,
      }}
      aria-label={`${title} (collapsed)`}
    >
      <div className="scout-collapsed-rail-header">
        <RailToggle
          side={side}
          collapsed
          label={title}
          onToggle={onToggle}
        />
      </div>
      {glyph ? (
        <div className="scout-collapsed-rail-glyph" aria-hidden="true">
          {glyph}
        </div>
      ) : null}
    </aside>
  );
}
