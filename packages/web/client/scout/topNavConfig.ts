import type { Route } from "../lib/types.ts";

export type TopNavKey =
  | "home"
  | "agents"
  | "chat"
  | "search"
  | "ops"
  | "tail"
  | "dispatch"
  | "repos";

export type TopNavItem = {
  key: TopNavKey;
  label: string;
  route: Route;
};

// Full nav — today's default. Home · Agents · Chat · Search · Ops, with the
// Ops cluster (Control/Dispatch/Repos/Mesh/Tail/Runtime/Plans) one level down.
export const TOP_NAV_ITEMS: TopNavItem[] = [
  { key: "home", label: "Home", route: { view: "inbox" } },
  { key: "agents", label: "Agents", route: { view: "agents" } },
  { key: "chat", label: "Chat", route: { view: "messages" } },
  { key: "search", label: "Search", route: { view: "search" } },
  { key: "ops", label: "Ops", route: { view: "ops" } },
];

// Clean / lean launch nav — mirrors the macOS core. Home · Agents · Chat ·
// Tail · Dispatch · Repos. Tail/Dispatch/Repos are promoted out of the Ops
// cluster to the primary bar; Search + the rest of Ops (Control/Mesh/Runtime/
// Plans) drop off the bar and stay reachable via the Ops subnav + ⌘K palette.
// Gated by the `nav.clean` flag.
export const CLEAN_TOP_NAV_ITEMS: TopNavItem[] = [
  { key: "home", label: "Home", route: { view: "inbox" } },
  { key: "agents", label: "Agents", route: { view: "agents" } },
  { key: "chat", label: "Chat", route: { view: "messages" } },
  { key: "tail", label: "Tail", route: { view: "ops", mode: "tail" } },
  { key: "dispatch", label: "Dispatch", route: { view: "broker" } },
  { key: "repos", label: "Repos", route: { view: "repos" } },
];

export const TOP_NAV_VIEW_LABELS: Record<string, string> = {
  inbox: "Home",
  conversation: "Conversation",
  "agent-info": "Agent",
  agents: "Agents",
  fleet: "Home",
  conversations: "Chat",
  messages: "Chat",
  sessions: "Sessions",
  repos: "Repos",
  harnesses: "Harnesses",
  search: "Search",
  channels: "Channels",
  activity: "Activity",
  mesh: "Mesh",
  broker: "Dispatch",
  settings: "Settings",
  work: "Work",
  ops: "Ops",
};

export function topNavItems(opsEnabled: boolean, cleanNav = false): TopNavItem[] {
  // Clean nav is its own fixed layout — the lean core always shows, and there
  // is no Ops top-level entry (ops.control still governs the Ops subnav/routes).
  if (cleanNav) return CLEAN_TOP_NAV_ITEMS;
  return opsEnabled
    ? TOP_NAV_ITEMS
    : TOP_NAV_ITEMS.filter((item) => item.key !== "ops");
}

export function topNavKeyForRoute(
  route: Route,
  opsEnabled: boolean,
  cleanNav = false,
): TopNavKey {
  if (route.view === "settings" && route.section === "agents") {
    return "agents";
  }
  switch (route.view) {
    case "agents":
    case "agent-info":
    case "sessions":
    case "terminal":
      return "agents";
    case "conversation":
    case "conversations":
    case "messages":
    case "channels":
      return "chat";
    case "search":
      // Search is a primary tab only in the full nav; in clean nav it's reached
      // via the palette and highlights nothing of its own.
      return cleanNav ? "home" : "search";
    case "broker":
      return cleanNav ? "dispatch" : opsEnabled ? "ops" : "home";
    case "repos":
      return cleanNav ? "repos" : opsEnabled ? "ops" : "home";
    case "harnesses":
      return cleanNav ? "home" : opsEnabled ? "ops" : "home";
    case "ops":
      // In clean nav only Tail (ops?mode=tail) has its own primary tab; the
      // other Ops modes (Control/Runtime/Plans) live under the Tail subnav.
      if (cleanNav) return route.mode === "tail" ? "tail" : "home";
      return opsEnabled ? "ops" : "home";
    case "mesh":
    case "work":
    case "follow":
      return cleanNav ? "home" : opsEnabled ? "ops" : "home";
    case "inbox":
    case "fleet":
    case "activity":
    default:
      return "home";
  }
}

export function topNavBreadcrumbForRoute(route: Route): string | null {
  if (route.view === "settings" && route.section === "agents") {
    return "Configuration";
  }
  switch (route.view) {
    case "conversation":
    case "agent-info":
    case "sessions":
    case "repos":
    case "harnesses":
    case "channels":
    case "mesh":
    case "broker":
    case "work":
      return TOP_NAV_VIEW_LABELS[route.view] ?? route.view;
    default:
      return null;
  }
}
