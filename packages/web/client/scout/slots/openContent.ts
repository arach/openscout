import type { Route } from "../../lib/types.ts";
import { setNavReturn, type NavReturnSlot } from "../../lib/nav-return.ts";

const SLOT_BY_VIEW: Partial<Record<Route["view"], NavReturnSlot>> = {
  agents: "agents",
  conversation: "conversation",
  work: "work",
  terminal: "terminal",
  sessions: "sessions",
  "agent-info": "agent-info",
  channels: "channels",
};

function slotForRoute(route: Route): NavReturnSlot | null {
  return SLOT_BY_VIEW[route.view] ?? null;
}

type OpenContentOptions = {
  /** Where the back affordance on the target content view should return. */
  returnTo?: Route;
};

/**
 * Navigate to a content/detail route while recording a back destination
 * for that route's BackToPicker. If `returnTo` is omitted, no back state
 * is set (the target screen's fallback applies).
 */
export function openContent(
  navigate: (route: Route) => void,
  target: Route,
  options: OpenContentOptions = {},
): void {
  if (options.returnTo) {
    const slot = slotForRoute(target);
    if (slot) setNavReturn(slot, options.returnTo);
  }
  navigate(target);
}
