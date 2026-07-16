import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { useOptionalFlag } from "hudsonkit/flags";
import type { Route } from "../lib/types.ts";
import { useScout } from "./Provider.tsx";
import { isSystemRoute } from "./topNavConfig.ts";
import "./nav-system-menu.css";

type SystemMenuEntry = {
  key: string;
  label: string;
  route: Route;
  active: (route: Route) => boolean;
};

// Always present — the retrieval/ops-core surfaces that used to be lean top
// tabs or one go-shortcut away.
const CORE_ENTRIES: SystemMenuEntry[] = [
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
// top tab used.
const OPS_ENTRIES: SystemMenuEntry[] = [
  {
    key: "control",
    label: "Control",
    route: { view: "ops" },
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

/** `system ▾` dropdown in the nav actions — home of the ops/retrieval cluster. */
export function SystemMenu(): ReactNode {
  const { route, navigate } = useScout();
  const opsEnabled = useOptionalFlag("ops.control", true);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClickOutside, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onClickOutside, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const renderEntry = (entry: SystemMenuEntry) =>
    createElement("button", {
      key: entry.key,
      type: "button",
      role: "menuitem",
      className: `scout-nav-system-item${entry.active(route) ? " active" : ""}`,
      onClick: () => {
        setOpen(false);
        navigate(entry.route);
      },
    }, entry.label);

  return createElement("div", { className: "scout-nav-system", ref: rootRef },
    createElement("button", {
      type: "button",
      className: `scout-nav-action scout-nav-action--system${isSystemRoute(route) ? " active" : ""}`,
      "aria-haspopup": "menu",
      "aria-expanded": open,
      title: "System",
      onClick: () => setOpen((current) => !current),
    },
      createElement("span", null, "System"),
      createElement("span", { className: "scout-nav-system-caret", "aria-hidden": true }, "▾"),
    ),
    open && createElement("div", { className: "scout-nav-system-menu", role: "menu" },
      CORE_ENTRIES.map(renderEntry),
      opsEnabled && createElement("div", { className: "scout-nav-system-divider", role: "separator" }),
      opsEnabled && OPS_ENTRIES.map(renderEntry),
    ),
  );
}
