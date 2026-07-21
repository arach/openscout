/**
 * Shared center-pane header / page title bar (SCO-085 / SCO-086).
 *
 * Slim title bar above ScoutContent:
 * - Route breadcrumb (left)
 * - AREA_SUB_NAV strip (projects/sessions)
 * - OpsSubnav / ChatSubnav owned here when sidebar chrome is on
 * - Optional RIGHT-UTILITY slot for screen-level header actions
 *
 * Routes that intentionally return null (no title bar):
 * - Home landings: inbox (no crumb, no secondary strip)
 * - Other flush landings depend on breadcrumb + area projections;
 *   see routeBreadcrumbForRoute / areaSubNavForRoute / secondaryNavForRoute.
 *
 * One shell slot — do not hand-edit every screen for breadcrumb/subnav.
 */
import type { MouseEvent, ReactNode } from "react";
import { routeBreadcrumbForRoute } from "../route-breadcrumb.ts";
import {
  areaSubNavForRoute,
  type AreaSubNavItem,
} from "../nav-destinations.ts";
import { useScout } from "../Provider.tsx";
import type { Route } from "../../lib/types.ts";
import { OpsSubnav } from "../../screens/ops/OpsSubnav.tsx";
import { ChatSubnav } from "../../screens/chat/ChatSubnav.tsx";
import { secondaryNavKindForRoute } from "./center-pane-header-state.ts";

export { secondaryNavKindForRoute } from "./center-pane-header-state.ts";

export function AreaSubNavStrip({
  items,
  route,
  navigate,
  className = "",
}: {
  items: AreaSubNavItem[];
  route: Route;
  navigate: (route: Route) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav
      className={`scout-area-subnav${className ? ` ${className}` : ""}`}
      aria-label="Area sub-navigation"
      data-scout-area-subnav=""
    >
      {items.map((item) => {
        const active = item.active(route);
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? "page" : undefined}
            className={`scout-area-subnav-item${active ? " scout-area-subnav-item--active" : ""}`}
            onClick={() => navigate(item.route)}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Shell-owned page title bar: breadcrumb, area sub-nav, Ops/Chat strips,
 * optional right-utility actions.
 * Returns null when nothing applies (keeps the center pane flush).
 */
export function CenterPaneHeader({
  rightUtility,
  variant,
  onInteractiveMouseDown,
}: {
  /** Right-aligned utility slot for screen-level header actions. */
  rightUtility?: ReactNode;
  /**
   * "top-row" renders the header as the fixed app-wide top row (SCO-087):
   * always mounted, no sticky, sits inside a drag-region wrapper.
   */
  variant?: "top-row";
  /** Marks interactive groups no-drag when hosted inside a drag region. */
  onInteractiveMouseDown?: (event: MouseEvent) => void;
} = {}) {
  const { route, navigate } = useScout();
  const breadcrumb = routeBreadcrumbForRoute(route);
  const subNav = areaSubNavForRoute(route);
  const secondaryKind = secondaryNavKindForRoute(route);
  const isTopRow = variant === "top-row";

  // The top row is the app frame: it always mounts (it hosts machine scope +
  // utilities + the drag region), even on flush landings with no crumb/sub-nav.
  if (!isTopRow && !breadcrumb && !subNav && !secondaryKind && !rightUtility) {
    return null;
  }

  return (
    <div
      className={`scout-center-pane-header${isTopRow ? " scout-center-pane-header--top-row" : ""}`}
      data-scout-center-pane-header=""
      data-scout-top-row={isTopRow ? "" : undefined}
    >
      <div className="scout-center-pane-header-main" onMouseDown={onInteractiveMouseDown}>
        {breadcrumb ? (
          <div className="scout-center-pane-breadcrumb" data-scout-breadcrumb="">
            <span className="scout-nav-crumb">{breadcrumb}</span>
          </div>
        ) : null}
        {subNav ? (
          <AreaSubNavStrip
            items={subNav.items}
            route={route}
            navigate={navigate}
          />
        ) : null}
        {secondaryKind === "ops" ? (
          <div className="scout-center-pane-secondary" data-scout-secondary-nav="ops">
            <OpsSubnav activeRoute={route} navigate={navigate} />
          </div>
        ) : null}
        {secondaryKind === "chat" ? (
          <div className="scout-center-pane-secondary" data-scout-secondary-nav="chat">
            <ChatSubnav activeRoute={route} navigate={navigate} />
          </div>
        ) : null}
      </div>
      {rightUtility ? (
        <div
          className="scout-center-pane-header-utility"
          data-scout-header-utility=""
          onMouseDown={onInteractiveMouseDown}
        >
          {rightUtility}
        </div>
      ) : null}
    </div>
  );
}
