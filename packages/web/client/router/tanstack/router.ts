import { createRouter } from "@tanstack/react-router";
import {
  notifyScoutLocationChanged,
  registerScoutNavigationAdapter,
  scoutRouteFromLocation,
} from "../../lib/router.ts";
import { EXPECTED_SCOUT_VIEW_BY_ROUTE_ID, scoutRouteTree } from "./route-tree.ts";

export const scoutTanstackRouter = createRouter({
  routeTree: scoutRouteTree,
  defaultPreload: false,
  scrollRestoration: true,
});

// Hand-rolled navigate() calls flow through TanStack's history so the router
// store updates natively.
registerScoutNavigationAdapter((href, replace) => {
  if (replace) {
    scoutTanstackRouter.history.replace(href);
  } else {
    scoutTanstackRouter.history.push(href);
  }
});

// Pane rendering still reads the canonical Scout Route from ScoutProvider. Keep
// that legacy route state synchronized with every TanStack-resolved location,
// including URL changes initiated outside lib/router.navigate().
scoutTanstackRouter.subscribe("onResolved", () => {
  notifyScoutLocationChanged();
});

// Dev parity oracle: whenever TanStack resolves a location matched by an
// explicitly adopted Scout route, the canonical parser must agree on the view.
// Drift here means route-tree.ts and routeFromUrl() have diverged — fix the
// route tree (the parser is the source of truth during adoption).
if (import.meta.env.DEV) {
  scoutTanstackRouter.subscribe("onResolved", () => {
    const location = scoutTanstackRouter.state.location;
    for (const match of scoutTanstackRouter.state.matches) {
      const expectedView = EXPECTED_SCOUT_VIEW_BY_ROUTE_ID[match.routeId];
      if (!expectedView) continue;
      const parsed = scoutRouteFromLocation(location.pathname, location.searchStr);
      if (parsed.view !== expectedView) {
        console.error(
          `[scout-router] parity drift: TanStack matched ${match.routeId} but routeFromUrl parsed view "${parsed.view}" (expected "${expectedView}") at ${location.href}`,
        );
      }
    }
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof scoutTanstackRouter;
  }
}
