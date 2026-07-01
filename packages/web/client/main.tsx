import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { createScoutApp } from "./scout";
import { ScoutProvider } from "./scout/Provider.tsx";
import { registerScoutShellApp } from "./router/tanstack/shell-app.ts";
import { scoutTanstackRouter } from "./router/tanstack/router.ts";
import { ObserveEmbedScreen } from "./screens/ObserveEmbedScreen.tsx";
import { RepoDiffEmbedScreen } from "./screens/RepoDiffEmbedScreen.tsx";
import { AgentLanesEmbedScreen } from "./screens/ops/AgentLanesEmbedScreen.tsx";
import { BrokerEmbedScreen } from "./screens/broker/BrokerEmbedScreen.tsx";
import { SessionEmbedScreen } from "./screens/sessions/SessionEmbedScreen.tsx";

import {
  applyScoutThemeToDocument,
  resolveScoutStartupTheme,
} from "./lib/theme.ts";
import { ScoutbotFxLab } from "./dev/ScoutbotFxLab.tsx";
import { DevErrorOverlay } from "./dev/DevErrorOverlay.tsx";
import type { Route } from "./lib/types.ts";
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

const isScoutbotFxLab = window.location.pathname === "/dev/scoutbot-fx";
const observeEmbedMatch = window.location.pathname.match(/^\/embed\/observe\/([^/]+)$/);
// Standalone embeddable diff viewer (macOS WKWebView bottom sheet) — chrome-free,
// reads `?path=<abs>` from the query string. See screens/RepoDiffEmbedScreen.tsx.
const isRepoDiffEmbed = window.location.pathname === "/embed/repo-diff";
// Standalone session viewer (macOS WKWebView bottom sheet from a tail row) —
// chrome-free, reads `?ref=<sessionId>`. See screens/SessionEmbedScreen.tsx.
const isSessionEmbed = window.location.pathname === "/embed/session";
// Content-only agent lanes embed for the HUD Tail content area. `/embed/traces`
// keeps compatibility with the older root-level trace embed shape.
const isAgentLanesEmbed = window.location.pathname === "/ops/lanes/embed"
  || window.location.pathname === "/embed/lanes"
  || window.location.pathname === "/embed/traces";
// Chrome-free dispatch (broker) ledger for the macOS "Dispatch" section.
// See screens/broker/BrokerEmbedScreen.tsx.
const isBrokerEmbed = window.location.pathname === "/embed/broker";
const scoutApp = createScoutApp({ initialTheme });
wireScopeOntoScout(scoutApp);
registerScoutShellApp(scoutApp);

function renderEmbed(children: ReactNode, initialRoute?: Route) {
  return (
    <ScoutProvider initialTheme={initialTheme} embedded initialRoute={initialRoute}>
      {children}
    </ScoutProvider>
  );
}

createRoot(el).render(
  <StrictMode>
    {isScoutbotFxLab ? (
      <ScoutbotFxLab />
    ) : observeEmbedMatch ? (
      renderEmbed(<ObserveEmbedScreen agentId={decodeURIComponent(observeEmbedMatch[1])} />)
    ) : isRepoDiffEmbed ? (
      renderEmbed(<RepoDiffEmbedScreen />)
    ) : isSessionEmbed ? (
      renderEmbed(<SessionEmbedScreen />, { view: "sessions" })
    ) : isAgentLanesEmbed ? (
      renderEmbed(<AgentLanesEmbedScreen />, { view: "ops", mode: "lanes" })
    ) : isBrokerEmbed ? (
      renderEmbed(<BrokerEmbedScreen />, { view: "broker" })
    ) : (
      <RouterProvider router={scoutTanstackRouter} />
    )}
    {/* dev-only runtime-issue HUD — captures uncaught errors, rejections, and
        console/React errors (e.g. duplicate-key warnings) into a clean, copyable
        surface. Tree-shaken out of production builds. */}
    {import.meta.env.DEV ? <DevErrorOverlay /> : null}
  </StrictMode>,
);
