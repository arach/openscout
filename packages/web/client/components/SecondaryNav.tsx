import { useOptionalFlag } from "hudsonkit/flags";
import type { Route } from "../lib/types.ts";
import "./secondary-nav.css";

export type SecondaryNavItem = {
  id: string;
  label: string;
  route: Route;
  active: (route: Route) => boolean;
  // Dropped from the lean view (`nav.clean`). The page stays reachable via the
  // command palette; it just isn't a sub-nav tab when we're decluttering.
  hideInLean?: boolean;
};

export type SecondaryNavGroup = {
  label?: string;
  items: SecondaryNavItem[];
};

export function SecondaryNav({
  ariaLabel,
  activeRoute,
  groups,
  navigate,
  className = "",
}: {
  ariaLabel: string;
  activeRoute: Route;
  groups: SecondaryNavGroup[];
  navigate: (route: Route) => void;
  className?: string;
}) {
  const cleanNav = useOptionalFlag("nav.clean", false);
  const visibleGroups = cleanNav
    ? groups
        .map((group) => ({ ...group, items: group.items.filter((item) => !item.hideInLean) }))
        .filter((group) => group.items.length > 0)
    : groups;

  // A sub-nav that's collapsed to a single page is just a lonely tab — in the
  // lean view we drop the whole bar and let the page stand on its own.
  const totalItems = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);
  if (cleanNav && totalItems <= 1) return null;

  return (
    <nav className={`s-secondary-nav${className ? ` ${className}` : ""}`} aria-label={ariaLabel}>
      {visibleGroups.map((group, index) => (
        <div key={group.label ?? index} className="s-secondary-nav-group">
          {group.label && <span className="s-secondary-nav-label">{group.label}</span>}
          <div className="s-secondary-nav-switch">
            {group.items.map((item) => {
              const active = item.active(activeRoute);
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  className={`s-secondary-nav-button${active ? " s-secondary-nav-button--active" : ""}`}
                  onClick={() => navigate(item.route)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
