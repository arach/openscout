import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "@/app";
import BootLoaderPreview from "@/boot-loader-preview";
import "@/styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found.");
}

const bootPreview =
  import.meta.env.DEV
  && typeof window !== "undefined"
  && new URLSearchParams(window.location.search).has("boot-preview");

const app = (
  <StrictMode>
    <BrowserRouter>
      {bootPreview ? <BootLoaderPreview /> : <App />}
    </BrowserRouter>
  </StrictMode>
);

const hasServerRender =
  typeof window !== "undefined"
  && Object.prototype.hasOwnProperty.call(window, "__INITIAL_STATE__");

if (hasServerRender) {
  hydrateRoot(rootElement, app);
} else {
  createRoot(rootElement).render(app);
}
