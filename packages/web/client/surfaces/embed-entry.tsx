import { FeatureFlagsProvider } from "hudsonkit/flags";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { createScoutApp } from "../scout";
import {
  SCOUT_AUDIENCE_ORDER,
  SCOUT_DEFAULT_AUDIENCE,
  SCOUT_FLAG_STORAGE_KEY,
  scoutFlagInitialLayers,
  scoutFlags,
} from "../lib/scout-flags.ts";
import { DiscoveredEmbedHost } from "./EmbedHost.tsx";
import { resolveEmbeddableSurface } from "./discover.ts";

export function mountDiscoveredEmbed(
  el: HTMLElement,
  scoutApp: ReturnType<typeof createScoutApp>,
): boolean {
  const surface = resolveEmbeddableSurface(window.location.pathname);
  if (!surface) return false;

  createRoot(el).render(
    <StrictMode>
      {/* Same flag stack as OpenScoutAppShell. Without it every embed read the
          hardcoded fallback instead of the registry default, so a surface that
          is gated — live voice — could never turn on inside a native host. */}
      <FeatureFlagsProvider
        registry={scoutFlags}
        audience={SCOUT_DEFAULT_AUDIENCE}
        audienceOrder={SCOUT_AUDIENCE_ORDER}
        storageKey={SCOUT_FLAG_STORAGE_KEY}
        initialLayers={scoutFlagInitialLayers()}
      >
        <scoutApp.Provider>
          <DiscoveredEmbedHost surface={surface} />
        </scoutApp.Provider>
      </FeatureFlagsProvider>
    </StrictMode>,
  );
  return true;
}