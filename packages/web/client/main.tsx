import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { createScoutApp } from "./scout";
import { OpenScoutAppShell } from "./OpenScoutAppShell.tsx";
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

class ScoutBootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; componentStack: string }
> {
  state = { error: null as Error | null, componentStack: "" };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[openscout] app render failed", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ padding: "24px", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
        <h1 style={{ fontSize: "16px" }}>Scout could not render this view</h1>
        <pre style={{ whiteSpace: "pre-wrap", color: "#e8993d" }}>{this.state.error.message}</pre>
        {this.state.componentStack ? (
          <pre style={{ whiteSpace: "pre-wrap", color: "#9fa4ad" }}>{this.state.componentStack}</pre>
        ) : null}
      </main>
    );
  }
}

function renderShell() {
  createRoot(el).render(
    <StrictMode>
      <ScoutBootErrorBoundary>
        {isScoutbotFxLab ? (
          <ScoutbotFxLab />
        ) : isEmbeddableSurfacesLab ? (
          <EmbeddableSurfacesLab />
        ) : observeEmbedMatch ? (
          <scoutApp.Provider>
            <ObserveEmbedScreen agentId={decodeURIComponent(observeEmbedMatch[1])} />
          </scoutApp.Provider>
        ) : isRepoDiffEmbed ? (
          <scoutApp.Provider>
            <RepoDiffEmbedScreen />
          </scoutApp.Provider>
        ) : isSessionEmbed ? (
          <scoutApp.Provider>
            <SessionEmbedScreen />
          </scoutApp.Provider>
        ) : isTerminalEmbed ? (
          <TerminalEmbedScreen />
        ) : (
          <OpenScoutAppShell app={scoutApp} />
        )}
      </ScoutBootErrorBoundary>
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
