import type { SecondaryNavGroup } from "../components/SecondaryNav.tsx";

// Agents is a top-level tab (Projects); its only remaining sub-page is the
// configuration surface. Directory (.deprecated) and Sessions left the subnav —
// the route stays alive, the nav entry does not.
export const AGENTS_SECONDARY_NAV: SecondaryNavGroup[] = [
  {
    items: [
      {
        id: "config",
        label: "Config",
        route: { view: "settings", section: "agents" },
        active: (route) => route.view === "settings" && route.section === "agents",
      },
    ],
  },
];

export const CHAT_SECONDARY_NAV: SecondaryNavGroup[] = [
  {
    items: [
      {
        id: "messages",
        label: "Messages",
        route: { view: "messages" },
        active: (route) =>
          route.view === "messages" ||
          route.view === "conversations" ||
          route.view === "conversation",
      },
      {
        id: "channels",
        label: "Channels",
        route: { view: "channels" },
        active: (route) => route.view === "channels",
      },
    ],
  },
];

export const SEARCH_SECONDARY_NAV: SecondaryNavGroup[] = [
  {
    items: [
      {
        id: "knowledge",
        label: "Knowledge",
        route: { view: "search", mode: "knowledge" },
        active: (route) => route.view === "search" && (route.mode === undefined || route.mode === "knowledge"),
      },
      {
        id: "indexer",
        label: "Indexer",
        route: { view: "search", mode: "indexer" },
        active: (route) => route.view === "search" && route.mode === "indexer",
      },
    ],
  },
];

export const OPS_SECONDARY_NAV: SecondaryNavGroup[] = [
  {
    items: [
      {
        id: "lanes",
        label: "Lanes",
        route: { view: "ops", mode: "lanes" },
        active: (route) => route.view === "ops" && route.mode === "lanes",
      },
      {
        id: "control",
        label: "Control",
        route: { view: "ops", mode: "mission" },
        active: (route) =>
          route.view === "ops" &&
          (route.mode === undefined || route.mode === "mission" || route.mode === "issues"),
      },
      {
        id: "dispatch",
        label: "Dispatch",
        route: { view: "broker" },
        active: (route) => route.view === "broker",
      },
      {
        id: "repos",
        label: "Repos",
        route: { view: "repos" },
        active: (route) => route.view === "repos",
      },
      {
        id: "code",
        label: "Code",
        route: { view: "code" },
        active: (route) => route.view === "code",
      },
      {
        id: "harnesses",
        label: "Providers",
        route: { view: "harnesses" },
        active: (route) => route.view === "harnesses",
      },
      {
        id: "mesh",
        label: "Mesh",
        route: { view: "mesh" },
        active: (route) => route.view === "mesh",
      },
      {
        id: "tail",
        label: "Tail",
        route: { view: "ops", mode: "tail" },
        active: (route) => route.view === "ops" && route.mode === "tail",
      },
      {
        id: "runtime",
        label: "Runtime",
        route: { view: "ops", mode: "atop" },
        active: (route) => route.view === "ops" && route.mode === "atop",
      },
      {
        id: "plans",
        label: "Plans",
        route: { view: "ops", mode: "plan" },
        active: (route) => route.view === "ops" && route.mode === "plan",
      },
    ],
  },
];
