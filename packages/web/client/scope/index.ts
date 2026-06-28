/**
 * Scope — namespaced product surface on Scout infra.
 *
 * Canonical URLs: /scope (lanes default), /scope/tail, /scope/sessions,
 * /scope/agents. Legacy /scout/* links parse and canonicalize to /scope.
 * Scout routes (/ops/lanes, /inbox, …) are unchanged unless the browser is
 * already on /scope/*. Path strings live in shared/scope-integration.js.
 * Route mapping lives in scope/paths.ts. Touchpoints outside this tree:
 *   1. main.tsx           → import "./scope/index.ts"
 *   2. lib/router.ts      → parseScopeRouteFromUrl + scopeRoutePath
 *   3. lib/scout-flags.ts → scope flag registry + bundle layer
 *   4. scout/topNavConfig.ts → SCOPE_TOP_NAV_ITEMS
 *   5. scout/hooks.ts     → scope nav chrome when on /scope/*
 *
 * Enable via /scope path, flag bundle, or deploy env — see SCOPE_ENABLE_HINTS.
 */

import "./presentation.css";

export { SCOPE_ENABLE_HINTS } from "./config.ts";

export {
  SCOPE_BRAND_LABEL,
  SCOPE_FLAG_BUNDLE,
  SCOPE_FLAG_KEY,
  SCOPE_LEGACY_FLAG_BUNDLE,
  SCOPE_LEGACY_FLAG_KEY,
  SCOPE_LEGACY_PATH_PREFIX,
  SCOPE_LEGACY_PATH_SEGMENT,
  SCOPE_LANE_DECK_PROFILE,
  SCOPE_PATH_PREFIX,
  SCOPE_PATH_SEGMENT,
  SCOPE_ROUTE_SEGMENTS,
  canonicalizeScopePathname,
} from "./paths.ts";

export {
  buildScopePath,
  buildScopeRoutePath,
  isScopePath,
  parseScopeRouteFromUrl,
  preserveLocationSearch,
  routeToScopeSegment,
  segmentToRoute,
} from "./paths.ts";

export { scopeStorageKey, SCOPE_STORAGE_PREFIX } from "../../shared/scope-integration.js";

export {
  isScopePresentation,
  scopeLaneDeckProfileId,
  scopePresentationAttrs,
  routeBelongsInScopeNamespace,
  scopeRoutePath,
  scopeViewSegment,
} from "./presentation.ts";

export { SCOPE_TOP_NAV_ITEMS, scopePresentationTitle, scopeTopNavKeyForRoute } from "./nav.ts";

export {
  SCOPE_FLAG_BUNDLE_ALIASES,
  SCOPE_FLAG_REGISTRY_KEY,
  scopeInstrumentBundleLayer,
  scopeSurfaceFlagDefinition,
} from "./flags.ts";

export {
  isScopeOnboardingExempt,
  useScopePresentation,
  useScopePresentationAttrs,
  useScopeShellChrome,
} from "./hooks.ts";

export { ScopeLanesView } from "./views/ScopeLanesView.tsx";
export { ScopeDirView } from "./views/ScopeDirView.tsx";
export { ScopeLaneDetailView } from "./views/ScopeLaneDetailView.tsx";
export { ScopeLaneTraceSheet } from "./views/ScopeLaneTraceSheet.tsx";
export { ScopeLaneColumn } from "./views/ScopeLaneColumn.tsx";
export { ScopeLanesBar } from "./views/ScopeLanesBar.tsx";
