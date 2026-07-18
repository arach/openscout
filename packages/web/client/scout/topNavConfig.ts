import type { Route } from "../lib/types.ts";

export type TopNavKey =
  | "home"
  | "agents"
  | "chat"
  | "sessions"
  | "system";

export type TopNavItem = {
  key: TopNavKey;
  label: string;
  route: Route;
};

// Single-personality nav (Model B · Work nouns): Home · Projects · Sessions ·
// Chat. The ops/retrieval cluster (Search, Terminals, Tail, Dispatch, and the
// ops surfaces) lives one level down in the System dropdown
// (nav-system-menu.tsx). There is no lean/full switch — `nav.clean` is gone.
export const TOP_NAV_ITEMS: TopNavItem[] = [
  { key: "home", label: "Home", route: { view: "inbox" } },
  { key: "agents", label: "Projects", route: { view: "agents-v2" } },
  { key: "sessions", label: "Sessions", route: { view: "sessions" } },
  { key: "chat", label: "Chat", route: { view: "messages" } },
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
  ops: "System",
};

const SYSTEM_VIEWS = new Set<Route["view"]>([
  "ops",
  "broker",
  "repos",
  "harnesses",
  "mesh",
  "terminal",
  "search",
  "code",
  "work",
  "follow",
  "settings",
]);

/** True for the chrome/ops surfaces that live under the System dropdown. */
export function isSystemRoute(route: Route): boolean {
  if (route.view === "settings" && route.section === "agents") return false;
  return SYSTEM_VIEWS.has(route.view);
}

export function topNavItems(): TopNavItem[] {
  return TOP_NAV_ITEMS;
}

export function topNavKeyForRoute(route: Route): TopNavKey {
  if (route.view === "settings" && route.section === "agents") {
    return "agents";
  }
  switch (route.view) {
    case "agents-v2":
    case "agents":
    case "agent-info":
      return "agents";
    case "sessions":
      return "sessions";
    case "conversation":
    case "conversations":
    case "messages":
    case "channels":
      return "chat";
    case "ops":
    case "broker":
    case "repos":
    case "harnesses":
    case "mesh":
    case "terminal":
    case "search":
    case "code":
    case "work":
    case "follow":
    case "settings":
      return "system";
    case "inbox":
    case "fleet":
    case "activity":
    case "briefings":
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
