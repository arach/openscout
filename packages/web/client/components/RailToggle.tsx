/**
 * Edge chevron rail expand/collapse control (SCO-086).
 *
 * Pure app-owned control shared by the nav sidebar, side rail, and inspector.
 * Imports neither HudsonKit nor shadcn — shell/wrapper owns placement and
 * binding to collapse state.
 *
 * Renders ‹ / › at the rail boundary (callers position at header height).
 */
import type { CSSProperties, MouseEventHandler } from "react";

export type RailToggleSide = "left" | "right";

export function railToggleChevron(
  side: RailToggleSide,
  collapsed: boolean,
): "‹" | "›" {
  // Left rails expand rightward; right rails expand leftward.
  if (side === "left") return collapsed ? "›" : "‹";
  return collapsed ? "‹" : "›";
}

export function railToggleLabel(
  collapsed: boolean,
  panelLabel?: string,
): string {
  const name = panelLabel?.trim() || "panel";
  return collapsed ? `Expand ${name}` : `Collapse ${name}`;
}

export function RailToggle({
  side,
  collapsed,
  label,
  onToggle,
  className = "",
  style,
  onMouseDown,
}: {
  side: RailToggleSide;
  collapsed: boolean;
  /** Panel name used in title/aria-label (e.g. "Sidebar", "Context"). */
  label?: string;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
  onMouseDown?: MouseEventHandler<HTMLButtonElement>;
}) {
  const title = railToggleLabel(collapsed, label);
  const chevron = railToggleChevron(side, collapsed);

  return (
    <button
      type="button"
      data-scout-rail-toggle=""
      data-side={side}
      data-collapsed={collapsed ? "true" : "false"}
      aria-expanded={!collapsed}
      aria-label={title}
      title={title}
      className={`scout-rail-toggle${className ? ` ${className}` : ""}`}
      style={style}
      onClick={onToggle}
      onMouseDown={onMouseDown}
    >
      <span aria-hidden="true" className="scout-rail-toggle-glyph">
        {chevron}
      </span>
    </button>
  );
}
