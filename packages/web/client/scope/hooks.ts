import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import type { Route } from "../lib/types.ts";
import { isScopePath } from "./paths.ts";
import { isScopePresentation, scopePresentationAttrs } from "./presentation.ts";
import { SCOPE_BRAND_LABEL } from "./paths.ts";
import { scopePresentationTitle } from "./nav.ts";

export function useScopePresentation(): boolean {
  const { pathname } = useLocation();
  return isScopePath(pathname);
}

export function useScopePresentationAttrs(): Record<string, boolean> | undefined {
  return scopePresentationAttrs(useScopePresentation());
}

/** Shell chrome: document marker + collapse side panels for the lean instrument view. */
export function useScopeShellChrome(options: {
  route: Route;
  setLeftCollapsed: (value: boolean | ((current: boolean) => boolean)) => void;
  setRightCollapsed: (value: boolean | ((current: boolean) => boolean)) => void;
}): { active: boolean; brandLabel: string } {
  const active = useScopePresentation();

  useEffect(() => {
    if (active) {
      document.documentElement.setAttribute("data-scope-presentation", "");
      options.setLeftCollapsed(true);
      options.setRightCollapsed(true);
    } else {
      document.documentElement.removeAttribute("data-scope-presentation");
    }
    return () => document.documentElement.removeAttribute("data-scope-presentation");
  }, [active, options.setLeftCollapsed, options.setRightCollapsed]);

  return {
    active,
    brandLabel: active ? scopePresentationTitle(options.route) : SCOPE_BRAND_LABEL,
  };
}

export function isScopeOnboardingExempt(): boolean {
  return isScopePath(typeof window !== "undefined" ? window.location.pathname : "");
}