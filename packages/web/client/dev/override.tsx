import { useSyncExternalStore, type ReactNode } from "react";

/**
 * DevOverride — a dev-only, named override point in the live app.
 *
 * Production: `import.meta.env.DEV` is statically `false`, so DevOverride
 * collapses to a pure passthrough (`children`). The resolver, the registry, and
 * every override registered against it are dead-code-eliminated — nothing
 * studio/fixture-shaped ships. The only thing a production component takes on is
 * a generic no-op wrapper with an id, the same way it already takes on a
 * feature-flag wrapper from `hudsonkit/flags`.
 *
 * Dev: an override can be registered against an id from a dev-only manifest
 * (client/dev/studio-overrides.tsx). Overrides are opt-in per page load via the
 * `?override=<id>` (or `?override=all`) URL param, so the real UI stays the
 * default even in dev — you ask for the override explicitly.
 *
 * This is a local prototype of a primitive intended to graduate into
 * `hudsonkit/dev` (HudPage / HudSection overrides), so the live-app skeleton can
 * be overridden from the studio without the production bundle ever knowing.
 *
 * v1 scope (deliberately minimal): replace-only, page granularity, opt-in.
 */

export type OverrideRender = (children: ReactNode) => ReactNode;

const registry = new Map<string, OverrideRender>();
const listeners = new Set<() => void>();
let version = 0;

/** Register a dev override for an id. Dev-only; has no importer in prod. */
export function registerDevOverride(id: string, render: OverrideRender): void {
  registry.set(id, render);
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

function overrideEnabled(id: string): boolean {
  if (typeof window === "undefined") return false;
  const raw = new URLSearchParams(window.location.search).get("override");
  if (!raw) return false;
  const ids = raw.split(",").map((value) => value.trim());
  return ids.includes("all") || ids.includes(id);
}

export function DevOverride({ id, children }: { id: string; children: ReactNode }) {
  if (!import.meta.env.DEV) return <>{children}</>;
  return <DevOverrideResolver id={id}>{children}</DevOverrideResolver>;
}

function DevOverrideResolver({ id, children }: { id: string; children: ReactNode }) {
  // Re-render when overrides register (the dev manifest loads asynchronously).
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const render = registry.get(id);
  if (render && overrideEnabled(id)) {
    return <>{render(children)}</>;
  }
  return <>{children}</>;
}
