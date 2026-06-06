import { SecondaryNav } from "../components/SecondaryNav.tsx";
import type { Route } from "../lib/types.ts";
import { SEARCH_SECONDARY_NAV } from "../scout/secondaryNavConfig.ts";

export function SearchSubnav({
  activeRoute,
  navigate,
}: {
  activeRoute: Route;
  navigate: (route: Route) => void;
}) {
  return (
    <SecondaryNav
      ariaLabel="Search sections"
      activeRoute={activeRoute}
      groups={SEARCH_SECONDARY_NAV}
      navigate={navigate}
    />
  );
}
