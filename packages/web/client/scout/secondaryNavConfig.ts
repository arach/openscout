import type { SecondaryNavGroup } from "../components/SecondaryNav.tsx";

export const AGENTS_SECONDARY_NAV: SecondaryNavGroup[] = [
  {
    items: [
      {
        id: "directory",
        label: "Directory",
        route: { view: "agents" },
        active: (route) => route.view === "agents" || route.view === "agent-info",
      },
      {
        id: "registry-v2",
        label: "Registry",
        route: { view: "agents-v2" },
        active: (route) => route.view === "agents-v2",
      },
      {
        id: "sessions",
        label: "Sessions",
        route: { view: "sessions" },
        active: (route) => route.view === "sessions" || route.view === "terminal",
        hideInLean: true,
      },
      {
        id: "config",
        label: "Config",
        route: { view: "settings", section: "agents" },
        active: (route) => route.view === "settings" && route.section === "agents",
        hideInLean: true,
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
        // Lean view is one unified conversations area — no DM/channel split.
        hideInLean: true,
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

// In the lean view the ops surfaces (Tail/Dispatch/Repos promoted to the top
// nav; Control/Mesh/Providers/Runtime/Plans tucked behind the palette) are all
// one level — so every item is `hideInLean`. The bar collapses to nothing and
// `.s-ops-header:empty` drops the empty chrome. The full bar returns in max-pro.
export const OPS_SECONDARY_NAV: SecondaryNavGroup[] = [
  {
    items: [
      {
        id: "lanes",
        label: "Lanes",
        route: { view: "ops", mode: "lanes" },
        active: (route) => route.view === "ops" && route.mode === "lanes",
        hideInLean: true,
      },
      {
        id: "control",
        label: "Control",
        route: { view: "ops", mode: "mission" },
        active: (route) =>
          route.view === "ops" &&
          (route.mode === undefined || route.mode === "mission" || route.mode === "issues"),
        hideInLean: true,
      },
      {
        id: "dispatch",
        label: "Dispatch",
        route: { view: "broker" },
        active: (route) => route.view === "broker",
        hideInLean: true,
      },
      {
        id: "repos",
        label: "Repos",
        route: { view: "repos" },
        active: (route) => route.view === "repos",
        hideInLean: true,
      },
      {
        id: "harnesses",
        label: "Providers",
        route: { view: "harnesses" },
        active: (route) => route.view === "harnesses",
        hideInLean: true,
      },
      {
        id: "mesh",
        label: "Mesh",
        route: { view: "mesh" },
        active: (route) => route.view === "mesh",
        hideInLean: true,
      },
      {
        id: "tail",
        label: "Tail",
        route: { view: "ops", mode: "tail" },
        active: (route) => route.view === "ops" && route.mode === "tail",
        hideInLean: true,
      },
      {
        id: "runtime",
        label: "Runtime",
        route: { view: "ops", mode: "atop" },
        active: (route) => route.view === "ops" && route.mode === "atop",
        hideInLean: true,
      },
      {
        id: "plans",
        label: "Plans",
        route: { view: "ops", mode: "plan" },
        active: (route) => route.view === "ops" && route.mode === "plan",
        hideInLean: true,
      },
    ],
  },
];
