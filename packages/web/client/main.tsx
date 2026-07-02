import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterContextProvider, RouterProvider } from "@tanstack/react-router";

import { createScoutApp } from "./scout";
import { registerScoutShellApp } from "./router/tanstack/shell-app.ts";
import { scoutTanstackRouter } from "./router/tanstack/router.ts";
import { ObserveEmbedScreen } from "./screens/ObserveEmbedScreen.tsx";
import { RepoDiffEmbedScreen } from "./screens/RepoDiffEmbedScreen.tsx";
import { SessionEmbedScreen } from "./screens/sessions/SessionEmbedScreen.tsx";
import { TerminalEmbedScreen } from "./screens/terminal/TerminalEmbedScreen.tsx";
import { shouldBootstrapDiscoveredEmbed } from "./surfaces/embed-path.ts";

import {
  applyScoutThemeToDocument,
  resolveScoutStartupTheme,
} from "./lib/theme.ts";
import { ScoutbotFxLab } from "./dev/ScoutbotFxLab.tsx";
import { EmbeddableSurfacesLab } from "./dev/EmbeddableSurfacesLab.tsx";
import { DevErrorOverlay } from "./dev/DevErrorOverlay.tsx";
import "./styles/tokens.css";
import "./styles/primitives.css";
import "./arc-tailwind.css";
import "./app.css";
import "./scope/index.ts";
import { wireScopeOntoScout } from "./scope/shell-hooks.tsx";

const el = document.getElementById("root");
if (!el) {
  throw new Error("missing #root");
}

const initialTheme = resolveScoutStartupTheme();
applyScoutThemeToDocument(initialTheme);

const pathname = window.location.pathname;
const isScoutbotFxLab = pathname === "/dev/scoutbot-fx";
const isEmbeddableSurfacesLab = pathname === "/dev/embeddable-surfaces";
const observeEmbedMatch = pathname.match(/^\/embed\/observe\/([^/]+)$/);
const isRepoDiffEmbed = pathname === "/embed/repo-diff";
const isSessionEmbed = pathname === "/embed/session";
const isTerminalEmbed = pathname === "/embed/terminal";
const useDiscoveredEmbed = shouldBootstrapDiscoveredEmbed(pathname);

const scoutApp = createScoutApp({ initialTheme });
wireScopeOntoScout(scoutApp);
registerScoutShellApp(scoutApp);

function renderShell() {
  createRoot(el).render(
    <StrictMode>
      {isScoutbotFxLab ? (
        <ScoutbotFxLab />
      ) : isEmbeddableSurfacesLab ? (
        <EmbeddableSurfacesLab />
      ) : observeEmbedMatch ? (
        <RouterContextProvider router={scoutTanstackRouter}>
          <scoutApp.Provider>
            <ObserveEmbedScreen agentId={decodeURIComponent(observeEmbedMatch[1])} />
          </scoutApp.Provider>
        </RouterContextProvider>
      ) : isRepoDiffEmbed ? (
        <RouterContextProvider router={scoutTanstackRouter}>
          <scoutApp.Provider>
            <RepoDiffEmbedScreen />
          </scoutApp.Provider>
        </RouterContextProvider>
      ) : isSessionEmbed ? (
        <RouterContextProvider router={scoutTanstackRouter}>
          <scoutApp.Provider>
            <SessionEmbedScreen />
          </scoutApp.Provider>
        </RouterContextProvider>
      ) : isTerminalEmbed ? (
        <TerminalEmbedScreen />
      ) : (
        <RouterProvider router={scoutTanstackRouter} />
      )}
      {import.meta.env.DEV ? <DevErrorOverlay /> : null}
    </StrictMode>,
  );
}

function renderEmbedMiss(missingPath: string) {
  createRoot(el).render(
    <StrictMode>
      <div className="s-embed-miss" data-scout-theme>
        <h1>Embed surface unavailable</h1>
        <p>
          No registered surface for <code>{missingPath}</code>. Rebuild the web client and restart
          the Scout web server.
        </p>
      </div>
      {import.meta.env.DEV ? <DevErrorOverlay /> : null}
    </StrictMode>,
  );
}

if (useDiscoveredEmbed) {
  void import("./surfaces/embed-entry.tsx")
    .then(({ mountDiscoveredEmbed }) => {
      const mounted = mountDiscoveredEmbed(el, scoutApp);
      if (!mounted) {
        renderEmbedMiss(pathname);
      }
    })
    .catch((error) => {
      console.error("[openscout] embed bootstrap failed", error);
      renderEmbedMiss(pathname);
    });
} else {
  renderShell();
}