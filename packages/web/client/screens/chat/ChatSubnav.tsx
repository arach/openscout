import { SecondaryNav } from "../../components/SecondaryNav.tsx";
import type { Route } from "../../lib/types.ts";
import { CHAT_SECONDARY_NAV } from "../../scout/secondaryNavConfig.ts";

export function ChatSubnav({
  activeRoute,
  navigate,
}: {
  activeRoute: Route;
  navigate: (route: Route) => void;
}) {
  return (
    <SecondaryNav
      ariaLabel="Chat sections"
      activeRoute={activeRoute}
      groups={CHAT_SECONDARY_NAV}
      navigate={navigate}
    />
  );
}
