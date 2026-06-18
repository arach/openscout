import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { OpenScoutAppShell } from "./OpenScoutAppShell.tsx";
import { createScoutApp } from "./scout";
import { ObserveEmbedScreen } from "./screens/ObserveEmbedScreen.tsx";
import { RepoDiffEmbedScreen } from "./screens/RepoDiffEmbedScreen.tsx";
import { SessionEmbedScreen } from "./screens/sessions/SessionEmbedScreen.tsx";
import {
  applyScoutThemeToDocument,
  resolveScoutStartupTheme,
} from "./lib/theme.ts";
import { ScoutbotFxLab } from "./dev/ScoutbotFxLab.tsx";
import "./styles/tokens.css";
import "./styles/primitives.css";
import "./arc-tailwind.css";
import "./app.css";

const el = document.getElementById("root");
if (!el) {
  throw new Error("missing #root");
}

const initialTheme = resolveScoutStartupTheme();
applyScoutThemeToDocument(initialTheme);

const isScoutbotFxLab = window.location.pathname === "/dev/scoutbot-fx";
const observeEmbedMatch = window.location.pathname.match(/^\/embed\/observe\/([^/]+)$/);
// Standalone embeddable diff viewer (macOS WKWebView bottom sheet) — chrome-free,
// reads `?path=<abs>` from the query string. See screens/RepoDiffEmbedScreen.tsx.
const isRepoDiffEmbed = window.location.pathname === "/embed/repo-diff";
// Standalone session viewer (macOS WKWebView bottom sheet from a tail row) —
// chrome-free, reads `?ref=<sessionId>`. See screens/SessionEmbedScreen.tsx.
const isSessionEmbed = window.location.pathname === "/embed/session";
const scoutApp = createScoutApp({ initialTheme });

createRoot(el).render(
  <StrictMode>
    {isScoutbotFxLab ? (
      <ScoutbotFxLab />
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
    ) : (
      <OpenScoutAppShell app={scoutApp} />
    )}
  </StrictMode>,
);
