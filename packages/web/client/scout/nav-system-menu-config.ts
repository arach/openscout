import type { Route } from "../lib/types.ts";

export type SystemMenuEntry = {
  key: string;
  label: string;
  route: Route;
  active: (route: Route) => boolean;
};

// Always present — the retrieval/ops-core surfaces that used to be lean top
// tabs or one go-shortcut away.
export const CORE_SYSTEM_MENU_ENTRIES: SystemMenuEntry[] = [
  {
    key: "search",
    label: "Search",
    route: { view: "search" },
    active: (route) => route.view === "search",
  },
  {
    key: "terminals",
    label: "Terminals",
    route: { view: "terminal" },
    active: (route) => route.view === "terminal",
  },
  {
    key: "tail",
    label: "Tail",
    route: { view: "ops", mode: "tail" },
    active: (route) => route.view === "ops" && route.mode === "tail",
  },
  {
    key: "dispatch",
    label: "Dispatch",
    route: { view: "broker" },
    active: (route) => route.view === "broker",
  },
];

// Power cluster — gated by `ops.control`, the same audience gate the old Ops
// top tab used. Mission Control remains here even though it is intentionally
// absent from the primary Home/Projects/Sessions/Chat navigation.
export const SYSTEM_OPS_ENTRIES: SystemMenuEntry[] = [
  {
    key: "control",
    label: "Mission Control",
    route: { view: "ops", mode: "mission" },
    active: (route) =>
      route.view === "ops" &&
      (route.mode === undefined || route.mode === "mission" || route.mode === "issues"),
  },
  {
    key: "lanes",
    label: "Lanes",
    route: { view: "ops", mode: "lanes" },
    active: (route) => route.view === "ops" && route.mode === "lanes",
  },
  {
    key: "repos",
    label: "Repos",
    route: { view: "repos" },
    active: (route) => route.view === "repos",
  },
  {
    key: "code",
    label: "Code",
    route: { view: "code" },
    active: (route) => route.view === "code",
  },
  {
    key: "providers",
    label: "Providers",
    route: { view: "harnesses" },
    active: (route) => route.view === "harnesses",
  },
  {
    key: "mesh",
    label: "Mesh",
    route: { view: "mesh" },
    active: (route) => route.view === "mesh",
  },
  {
    key: "runtime",
    label: "Runtime",
    route: { view: "ops", mode: "atop" },
    active: (route) => route.view === "ops" && route.mode === "atop",
  },
  {
    key: "plans",
    label: "Plans",
    route: { view: "ops", mode: "plan" },
    active: (route) => route.view === "ops" && route.mode === "plan",
  },
];
