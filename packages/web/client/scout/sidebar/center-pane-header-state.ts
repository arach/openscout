/**
 * Pure title-bar projections for CenterPaneHeader (SCO-086).
 * Free of React so unit tests do not load chrome modules.
 */
import type { Route } from "../../lib/types.ts";
import { primaryAreaForRoute } from "../primary-areas.ts";

/**
 * Which secondary-nav strip (Ops / Chat) the title bar owns for a route.
 * Null when the area has no in-title secondary strip.
 */
export function secondaryNavKindForRoute(
  route: Route,
): "ops" | "chat" | null {
  const areaId = primaryAreaForRoute(route);
  if (areaId === "ops") return "ops";
  if (areaId === "chat") return "chat";
  return null;
}
