import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { OpenScoutAppShell } from "./OpenScoutAppShell.tsx";
import { createScoutApp } from "./scout";
import { ObserveEmbedScreen } from "./screens/ObserveEmbedScreen.tsx";
import {
  applyScoutThemeToDocument,
  resolveScoutStartupTheme,
} from "./lib/theme.ts";
import { initAppearance } from "./lib/appearance.ts";
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
// Apply saved look-and-feel prefs (theme / density / accent / motion) before
// first paint, and keep "system" theme synced to the OS.
initAppearance();

const isScoutbotFxLab = window.location.pathname === "/dev/scoutbot-fx";
const observeEmbedMatch = window.location.pathname.match(/^\/embed\/observe\/([^/]+)$/);
const scoutApp = createScoutApp({ initialTheme });

createRoot(el).render(
  <StrictMode>
    {isScoutbotFxLab ? (
      <ScoutbotFxLab />
    ) : observeEmbedMatch ? (
      <scoutApp.Provider>
        <ObserveEmbedScreen agentId={decodeURIComponent(observeEmbedMatch[1])} />
      </scoutApp.Provider>
    ) : (
      <OpenScoutAppShell app={scoutApp} />
    )}
  </StrictMode>,
);
