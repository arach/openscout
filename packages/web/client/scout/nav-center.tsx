import { createElement, type ReactNode } from "react";
import type { Route } from "../lib/types.ts";
import type { TopNavItem, TopNavKey } from "./topNavConfig.ts";

export type NavCenterConfig = {
  className?: string;
  brandTag?: string;
  items: TopNavItem[];
  activeKey: TopNavKey;
  breadcrumb?: string | null;
  navigate: (route: Route) => void;
};

export function renderNavCenter({
  className = "scout-nav-tabs",
  brandTag,
  items,
  activeKey,
  breadcrumb,
  navigate,
}: NavCenterConfig): ReactNode {
  return createElement("div", { className },
    brandTag && createElement("span", { className: "scout-nav-scope-tag" }, brandTag),
    items.map(({ key, label, route: tabRoute }) =>
      createElement("button", {
        key,
        className: `scout-nav-tab${activeKey === key ? " active" : ""}`,
        onClick: () => navigate(tabRoute),
      }, label),
    ),
    breadcrumb && createElement("span", { className: "scout-nav-slash" }, "/"),
    breadcrumb && createElement("span", { className: "scout-nav-crumb" }, breadcrumb),
  );
}