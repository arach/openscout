import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

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
    {bootPreview ? <BootLoaderPreview /> : <App />}
  </StrictMode>
);

if (rootElement.hasChildNodes()) {
  hydrateRoot(rootElement, app);
} else {
  createRoot(rootElement).render(app);
}
