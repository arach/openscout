import type { Route } from "../lib/types.ts";

export type TopNavKey =
  | "home"
  | "agents"
  | "terminals"
  | "chat"
  | "search"
  | "ops"
  | "tail"
  | "dispatch"
  | "repos"
  | "lanes"
  | "sessions";

export type TopNavItem = {
  key: TopNavKey;
  label: string;
  route: Route;
};

// Full nav — today's default. Home · Projects · Terminals · Chat · Search · Ops, with the
// Ops cluster (Control/Dispatch/Repos/Mesh/Tail/Runtime/Plans) one level down.
export const TOP_NAV_ITEMS: TopNavItem[] = [
  { key: "home", label: "Home", route: { view: "inbox" } },
  { key: "agents", label: "Projects", route: { view: "agents-v2" } },
  { key: "terminals", label: "Terminals", route: { view: "terminal" } },
  { key: "chat", label: "Chat", route: { view: "messages" } },
  { key: "search", label: "Search", route: { view: "search" } },
  { key: "ops", label: "Ops", route: { view: "ops" } },
];

// Clean / lean launch nav — the three retrieval jobs (agent/session/terminal)
// plus Home, Tail, and Dispatch. Home · Projects · Sessions · Terminals · Chat ·
// Tail · Dispatch. Sessions holds a primary slot because find-my-session is a
// core job; Repos drops off the bar (⌘K palette + jump dock) along with Search
// and the rest of Ops (Control/Mesh/Runtime/Plans). Gated by the `nav.clean` flag.
export const CLEAN_TOP_NAV_ITEMS: TopNavItem[] = [
  { key: "home", label: "Home", route: { view: "inbox" } },
  { key: "agents", label: "Projects", route: { view: "agents-v2" } },
  { key: "sessions", label: "Sessions", route: { view: "sessions" } },
  { key: "terminals", label: "Terminals", route: { view: "terminal" } },
  { key: "chat", label: "Chat", route: { view: "messages" } },
  { key: "tail", label: "Tail", route: { view: "ops", mode: "tail" } },
  { key: "dispatch", label: "Dispatch", route: { view: "broker" } },
];

export const TOP_NAV_VIEW_LABELS: Record<string, string> = {
  inbox: "Home",
  conversation: "Conversation",
  "agent-info": "Agent",
  agents: "Agents .deprecated",
  "agents-v2": "Projects",
  fleet: "Home",
  conversations: "Chat",
  messages: "Chat",
  sessions: "Sessions",
  terminal: "Terminals",
  repos: "Repos",
  harnesses: "Providers",
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
    case "agents-v2":
    case "agents":
    case "agent-info":
      return "agents";
    case "sessions":
      // Sessions is a primary tab in the lean nav; in the full nav it lives
      // under the Agents subnav.
      return cleanNav ? "sessions" : "agents";
    case "terminal":
      return "terminals";
    case "conversation":
    case "conversations":
    case "messages":
    case "channels":
      return "chat";
    case "search":
      return cleanNav ? "home" : "search";
    case "broker":
      return cleanNav ? "dispatch" : opsEnabled ? "ops" : "home";
    case "repos":
      return cleanNav ? "home" : opsEnabled ? "ops" : "home";
    case "harnesses":
      return cleanNav ? "home" : opsEnabled ? "ops" : "home";
    case "ops":
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
