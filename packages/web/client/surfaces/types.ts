import type { ComponentType } from "react";
import type { Route } from "../lib/types.ts";
import type { SurfaceChrome } from "../scout/surface-chrome.ts";

/** Props every embed-capable screen accepts at minimum. */
export type EmbedScreenProps = {
  navigate: (route: Route) => void;
  embedded?: boolean;
};

export type ScoutSurfaceEmbed = {
  /** Embed pathname; defaults to `/embed/{id}`. */
  path?: string;
  /** Legacy or alias paths that should resolve to this surface. */
  aliases?: readonly string[];
  /** Native host profile query param (`?profile=macos.dispatch`). */
  profile?: string;
  /** Wrapper class on the embed root (e.g. `s-agent-lanes-embed`). */
  rootClassName?: string;
  chrome?: Partial<SurfaceChrome>;
  /** Extra props parsed from the embed URL query string. */
  resolveEmbedProps?: (params: URLSearchParams) => Record<string, unknown>;
  hosts?: {
    macos?: boolean;
  };
};

export type ScoutSurfaceDefinition = {
  id: string;
  label: string;
  route: Route;
  /** Full web shell path (e.g. `/broker`). */
  webPath: string;
  /** Named export on the same module that renders this surface. */
  screen: string;
  embed?: ScoutSurfaceEmbed;
};

export type RegisteredSurface = ScoutSurfaceDefinition & {
  modulePath: string;
  Screen: ComponentType<EmbedScreenProps & Record<string, unknown>>;
  embedPath: string;
  embedPaths: readonly string[];
};

/** Identity helper — screens export a `scoutSurface` blob beside the component. */
export function defineSurface<const T extends ScoutSurfaceDefinition>(definition: T): T {
  return definition;
}

export function defaultEmbedPath(surfaceId: string): string {
  return `/embed/${surfaceId}`;
}

export function resolveEmbedChrome(embed: ScoutSurfaceEmbed | undefined): SurfaceChrome {
  return {
    showSecondaryNav: embed?.chrome?.showSecondaryNav ?? false,
    showPageStatusBar: embed?.chrome?.showPageStatusBar ?? false,
  };
}