import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { OpenScoutAppShell } from "./OpenScoutAppShell.tsx";
import { createScoutApp } from "./scout";
import {
  applyScoutThemeToDocument,
  resolveScoutStartupTheme,
} from "./lib/theme.ts";
import { ScoutbotFxLab } from "./dev/ScoutbotFxLab.tsx";
import "./arc-tailwind.css";
import "./app.css";

const el = document.getElementById("root");
if (!el) {
  throw new Error("missing #root");
}

const initialTheme = resolveScoutStartupTheme();
applyScoutThemeToDocument(initialTheme);

const isScoutbotFxLab = window.location.pathname === "/dev/scoutbot-fx";

createRoot(el).render(
  <StrictMode>
    {isScoutbotFxLab ? <ScoutbotFxLab /> : <OpenScoutAppShell app={createScoutApp({ initialTheme })} />}
  </StrictMode>,
);
