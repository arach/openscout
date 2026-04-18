import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@hudson/sdk/app-shell";

import { scoutApp } from "./scout";
import "./arc-tailwind.css";
import "./app.css";

const el = document.getElementById("root");
if (!el) {
  throw new Error("missing #root");
}

createRoot(el).render(
  <StrictMode>
    <AppShell app={scoutApp} />
  </StrictMode>,
);
