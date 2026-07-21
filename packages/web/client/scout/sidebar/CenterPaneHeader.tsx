/**
 * Shared center-pane header seam (SCO-085).
 *
 * Renders route breadcrumb + AREA_SUB_NAV strip above ScoutContent /
 * ScopeAppContent. One shell slot — do not hand-edit every screen.
 */
import { routeBreadcrumbForRoute } from "../route-breadcrumb.ts";
import {
  areaSubNavForRoute,
  type AreaSubNavItem,
} from "../nav-destinations.ts";
import { useScout } from "../Provider.tsx";
import type { Route } from "../../lib/types.ts";

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
 * Shell-owned header above center content: breadcrumb and/or area sub-nav.
 * Returns null when neither applies (keeps the center pane flush).
 */
export function CenterPaneHeader() {
  const { route, navigate } = useScout();
  const breadcrumb = routeBreadcrumbForRoute(route);
  const subNav = areaSubNavForRoute(route);

  if (!breadcrumb && !subNav) return null;

  return (
    <div className="scout-center-pane-header" data-scout-center-pane-header="">
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
    </div>
  );
}
