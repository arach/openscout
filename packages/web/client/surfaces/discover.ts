import { buildSurfaceRegistry, type SurfaceModule } from "./discover-build.ts";
import type { RegisteredSurface } from "./types.ts";

const screenModules = import.meta.glob<SurfaceModule>("../screens/**/*.tsx", {
  eager: true,
});

const { surfaces, embedByPath } = buildSurfaceRegistry(screenModules);

/** Every screen that exported `scoutSurface` with an `embed` block. */
export const scoutSurfaces: readonly RegisteredSurface[] = surfaces;

/** Screens that can render in a chrome-free embed host. */
export const embeddableSurfaces: readonly RegisteredSurface[] = surfaces;

export function resolveEmbeddableSurface(pathname: string): RegisteredSurface | null {
  return embedByPath.get(pathname) ?? null;
}

export function listEmbeddableSurfaceSummaries() {
  return embeddableSurfaces.map((surface) => ({
    id: surface.id,
    label: surface.label,
    webPath: surface.webPath,
    embedPath: surface.embedPath,
    embedAliases: surface.embed?.aliases ?? [],
    profile: surface.embed?.profile ?? `macos.${surface.id}`,
    route: surface.route,
    modulePath: surface.modulePath,
    screen: surface.screen,
    macosHost: surface.embed?.hosts?.macos ?? true,
  }));
}