// OpenScout's feature-flag registry, built on the HudsonKit flags primitive
// (`hudsonkit/flags`). This is the single source of truth for which web
// surfaces are gated and how.
//
// Two tiers, per docs/eng/web-launch-surface-triage.md:
//   • surface.*  tier "everyone", default OFF — pure declutter for the lean
//                launch. Flipped on per-deploy/per-user as a surface matures.
//   • ops.*      tier "power", default ON but audience-gated — the ops /
//                observability cluster. Visible to power audiences, hidden for
//                a clean public launch. "Gated by who you are", not a URL flag.
// Core surfaces (Agents · Chat · Tail · Dispatch · Repos + Home/Settings) carry
// no flag — they always render.
//
// Slice 1 wires only the `ops.control` gate (replacing the old `isOpsEnabled()`
// URL boolean) and preserves today's behavior via a default "power" audience.
// The remaining keys are declared so the dev panel + registry are complete; the
// nav restructure that makes them bite is slice 2.

import {
  createFlagRegistry,
  createFlagResolver,
  parseFeatureFlagUrl,
  readFeatureFlagLocalState,
  type FeatureFlagAudience,
  type FeatureFlagLayerInput,
  type FeatureFlagLayers,
} from "@hudsonkit";

export const SCOUT_AUDIENCE_ORDER = ["everyone", "internal", "power"] as const;
export type ScoutAudienceTier = (typeof SCOUT_AUDIENCE_ORDER)[number];

// localStorage / cookie key the Provider reads & writes local overrides under.
// Distinct from HudsonKit's default ("hudson.flags") so OpenScout owns its own
// override namespace.
export const SCOUT_FLAG_STORAGE_KEY = "openscout.flags";

// Default audience. "power" keeps the full ops surface visible, matching the
// pre-flag behavior where ops was on by default. Slice 2 flips this to
// "everyone" for the lean launch, at which point ops.* become audience-denied
// for the default operator and only power audiences (or local overrides) see
// them.
export const SCOUT_DEFAULT_AUDIENCE: FeatureFlagAudience<ScoutAudienceTier> = {
  tier: "power",
};

export const scoutFlags = createFlagRegistry({
  // ── ops.* — power surfaces, audience-gated ────────────────────────────
  "ops.control": {
    label: "Ops · Control",
    description: "Mission control, issues, and the Ops section shell.",
    defaultEnabled: true,
    tier: "power",
    owner: "scout-web",
    tags: ["ops", "nav"],
  },
  "ops.mesh": {
    label: "Ops · Mesh",
    description: "Mesh topology and peer status.",
    defaultEnabled: true,
    tier: "power",
    owner: "scout-web",
    tags: ["ops"],
  },
  "ops.runtime": {
    label: "Ops · Runtime",
    description: "Runtime / atop process telemetry.",
    defaultEnabled: true,
    tier: "power",
    owner: "scout-web",
    tags: ["ops"],
  },
  "ops.plans": {
    label: "Ops · Plans",
    description: "Plan documents and plan-mode review.",
    defaultEnabled: true,
    tier: "power",
    owner: "scout-web",
    tags: ["ops"],
  },
  "ops.terminal": {
    label: "Ops · Terminal",
    description: "Observe / takeover terminal sessions.",
    defaultEnabled: true,
    tier: "power",
    owner: "scout-web",
    tags: ["ops"],
  },

  // ── surface.* — entry declutter, default off ──────────────────────────
  "surface.search": {
    label: "Surface · Search",
    description: "Knowledge + indexer search as a top-level nav entry.",
    defaultEnabled: false,
    tier: "everyone",
    owner: "scout-web",
    tags: ["surface", "nav"],
  },
  "surface.sessions": {
    label: "Surface · Sessions",
    description: "Standalone top-level Sessions entry (still reachable under Agents).",
    defaultEnabled: false,
    tier: "everyone",
    owner: "scout-web",
    tags: ["surface", "nav"],
  },
  "surface.briefings": {
    label: "Surface · Briefings",
    description: "Briefings list + detail.",
    defaultEnabled: false,
    tier: "everyone",
    owner: "scout-web",
    tags: ["surface"],
  },
  "surface.work": {
    label: "Surface · Work",
    description: "Work item detail.",
    defaultEnabled: false,
    tier: "everyone",
    owner: "scout-web",
    tags: ["surface"],
  },
  "surface.activity": {
    label: "Surface · Activity",
    description: "Activity stream.",
    defaultEnabled: false,
    tier: "everyone",
    owner: "scout-web",
    tags: ["surface"],
  },
  "surface.follow": {
    label: "Surface · Follow",
    description: "Follow view.",
    defaultEnabled: false,
    tier: "everyone",
    owner: "scout-web",
    tags: ["surface"],
  },
});

export type ScoutFlagKey = keyof typeof scoutFlags;

// ── URL layer ───────────────────────────────────────────────────────────
// `?ff.<key>=on|off` overrides + `?ffAudience=<tier>`. Also honors the legacy
// `?no-ops` shortcut by mapping it to `ops.control=off` so existing bookmarks
// keep working.
function scoutUrlLayer(): FeatureFlagLayerInput<ScoutAudienceTier> {
  const layer = parseFeatureFlagUrl<ScoutAudienceTier>(window.location.href);
  if (new URLSearchParams(window.location.search).has("no-ops")) {
    layer.flags = { ...(layer.flags ?? {}), "ops.control": false };
  }
  return layer;
}

// ── Local layer ───────────────────────────────────────────────────────────
// Reads the same `{ version, audience, flags }` state the Provider writes,
// using HudsonKit's published storage helper (re-exported from the bare
// `@hudsonkit` entry as of 0.2.1), so the non-React shim stays consistent with
// the React tree. `readFeatureFlagLocalState` is SSR-safe (returns empty off-window).
function scoutLocalLayer(): FeatureFlagLayerInput<ScoutAudienceTier> {
  const state = readFeatureFlagLocalState<ScoutAudienceTier>(SCOUT_FLAG_STORAGE_KEY);
  return { flags: state.flags, audience: state.audience ?? undefined };
}

// Initial layers for `<FeatureFlagsProvider>`. The Provider rehydrates the
// local layer from storage itself in an effect; we seed the url layer here so
// `?ff.*` overrides take on the very first render.
export function scoutFlagInitialLayers(): FeatureFlagLayers<ScoutAudienceTier> {
  if (typeof window === "undefined") return {};
  return { url: scoutUrlLayer() };
}

// ── Non-React resolver shim ───────────────────────────────────────────────
// For route resolution / navigation guards (`lib/router.ts`) and anything else
// outside the React tree. Mirrors the Provider's resolution (url + local +
// registry defaults + audience); env/sharedConfig layers are slice-2 work.
export function isScoutFlagEnabled(key: ScoutFlagKey | string): boolean {
  const layers: FeatureFlagLayers<ScoutAudienceTier> =
    typeof window === "undefined"
      ? {}
      : { url: scoutUrlLayer(), local: scoutLocalLayer() };
  const resolver = createFlagResolver({
    registry: scoutFlags,
    audience: SCOUT_DEFAULT_AUDIENCE,
    audienceOrder: SCOUT_AUDIENCE_ORDER,
    layers,
    warnOnUnknown: false,
  });
  return resolver.isEnabled(key);
}
