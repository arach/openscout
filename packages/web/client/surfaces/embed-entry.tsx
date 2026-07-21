import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { createScoutApp } from "../scout";
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
      <scoutApp.Provider>
        <DiscoveredEmbedHost surface={surface} />
      </scoutApp.Provider>
    </StrictMode>,
  );
  return true;
}