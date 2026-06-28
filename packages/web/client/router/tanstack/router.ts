import { createRouter } from "@tanstack/react-router";
import { scoutRouteTree } from "./route-tree.ts";

export const scoutTanstackRouter = createRouter({
  routeTree: scoutRouteTree,
  defaultPreload: false,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof scoutTanstackRouter;
  }
}