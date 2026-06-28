import { useEffect } from "react";
import { isScopePresentation, scopePresentationAttrs } from "./presentation.ts";
import { SCOPE_BRAND_LABEL } from "./paths.ts";

export function useScopePresentation(): boolean {
  return isScopePresentation();
}

export function useScopePresentationAttrs(): Record<string, boolean> | undefined {
  return scopePresentationAttrs(useScopePresentation());
}

/** Shell chrome: document marker + collapse side panels for the lean instrument view. */
export function useScopeShellChrome(options: {
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

  return { active, brandLabel: SCOPE_BRAND_LABEL };
}

export function isScopeOnboardingExempt(): boolean {
  return isScopePresentation();
}