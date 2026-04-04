import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DEFAULT_RENDERER_PORT } from "./scripts/dev-electron-lib.mjs";

const rendererHost = process.env.OPENSCOUT_RENDERER_HOST?.trim() || "127.0.0.1";
const rendererPort = Number(process.env.OPENSCOUT_RENDERER_PORT?.trim() || String(DEFAULT_RENDERER_PORT));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: rendererHost,
    port: rendererPort,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
  preview: {
    host: rendererHost,
    port: rendererPort,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../apps/scout/src/ui/desktop"),
    },
  },
});
