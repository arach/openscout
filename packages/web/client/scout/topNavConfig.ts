import type { Route } from "../lib/types.ts";

export type TopNavKey = "home" | "agents" | "chat" | "search" | "ops";

export type TopNavItem = {
  key: TopNavKey;
  label: string;
  route: Route;
};

export const TOP_NAV_ITEMS: TopNavItem[] = [
  { key: "home", label: "Home", route: { view: "inbox" } },
  { key: "agents", label: "Agents", route: { view: "agents" } },
  { key: "chat", label: "Chat", route: { view: "messages" } },
  { key: "search", label: "Search", route: { view: "search" } },
  { key: "ops", label: "Ops", route: { view: "ops" } },
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
  search: "Search",
  channels: "Channels",
  activity: "Activity",
  mesh: "Mesh",
  broker: "Dispatch",
  settings: "Settings",
  work: "Work",
  harnesses: "Harnesses",
  ops: "Ops",
};

export function topNavItems(opsEnabled: boolean): TopNavItem[] {
  return opsEnabled
    ? TOP_NAV_ITEMS
    : TOP_NAV_ITEMS.filter((item) => item.key !== "ops");
}

export function topNavKeyForRoute(route: Route, opsEnabled: boolean): TopNavKey {
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
      return "search";
    case "mesh":
    case "broker":
    case "harnesses":
    case "ops":
    case "work":
    case "follow":
      return opsEnabled ? "ops" : "home";
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
    case "channels":
    case "mesh":
    case "broker":
    case "harnesses":
    case "work":
      return TOP_NAV_VIEW_LABELS[route.view] ?? route.view;
    default:
      return null;
  }
}
