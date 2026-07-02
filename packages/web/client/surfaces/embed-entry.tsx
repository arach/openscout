import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterContextProvider } from "@tanstack/react-router";
import type { createScoutApp } from "../scout";
import { scoutTanstackRouter } from "../router/tanstack/router.ts";
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
      <RouterContextProvider router={scoutTanstackRouter}>
        <scoutApp.Provider>
          <DiscoveredEmbedHost surface={surface} />
        </scoutApp.Provider>
      </RouterContextProvider>
    </StrictMode>,
  );
  return true;
}