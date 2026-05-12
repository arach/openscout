import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { OpenScoutAppShell } from "./OpenScoutAppShell.tsx";
import { createScoutApp } from "./scout";
import {
  applyScoutThemeToDocument,
  resolveScoutStartupTheme,
} from "./lib/theme.ts";
import { RangerFxLab } from "./dev/RangerFxLab.tsx";
import "./arc-tailwind.css";
import "./app.css";

const el = document.getElementById("root");
if (!el) {
  throw new Error("missing #root");
}

const initialTheme = resolveScoutStartupTheme();
applyScoutThemeToDocument(initialTheme);

const isRangerFxLab = window.location.pathname === "/dev/ranger-fx";

createRoot(el).render(
  <StrictMode>
    {isRangerFxLab ? <RangerFxLab /> : <OpenScoutAppShell app={createScoutApp({ initialTheme })} />}
  </StrictMode>,
);
