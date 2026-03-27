import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rendererHost = process.env.OPENSCOUT_RENDERER_HOST?.trim() || "127.0.0.1";
const rendererPort = Number(process.env.OPENSCOUT_RENDERER_PORT?.trim() || "5173");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: rendererHost,
    port: rendererPort,
    strictPort: true,
  },
  preview: {
    host: rendererHost,
    port: rendererPort,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
