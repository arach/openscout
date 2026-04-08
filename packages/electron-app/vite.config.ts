import type { ServerResponse } from "node:http";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DEFAULT_RENDERER_PORT } from "./scripts/dev-electron-lib.mjs";

const rendererHost = process.env.OPENSCOUT_RENDERER_HOST?.trim() || "127.0.0.1";
const rendererPort = Number(process.env.OPENSCOUT_RENDERER_PORT?.trim() || String(DEFAULT_RENDERER_PORT));
const webApiHost = process.env.SCOUT_WEB_HOST?.trim() || "127.0.0.1";
const webApiPort = Number(process.env.SCOUT_WEB_PORT?.trim() || "3200");
const webApiTarget = `http://${webApiHost}:${webApiPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: rendererHost,
    port: rendererPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: webApiTarget,
        changeOrigin: true,
        /** Shell state can wait on broker I/O; avoid proxy giving up early. */
        timeout: 180_000,
        proxyTimeout: 180_000,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            const code = err && typeof err === "object" && "code" in err ? String((err as NodeJS.ErrnoException).code) : "";
            const detail =
              code === "ECONNREFUSED"
                ? `Nothing is listening at ${webApiTarget}. Use npm run dev:web from packages/electron-app (starts Bun + Vite), or run cd apps/scout && bun run web with SCOUT_WEB_PORT matching SCOUT_WEB_PORT here.`
                : `Upstream closed the connection (${err.message}). Restart the Scout web process (bun run web) if it crashed.`;
            console.error(`[vite] /api proxy → ${webApiTarget}:`, detail);
            const outgoing = res as ServerResponse | undefined;
            if (outgoing && !outgoing.headersSent) {
              outgoing.writeHead(502, { "Content-Type": "application/json" });
              outgoing.end(JSON.stringify({ error: "Scout API unreachable", detail }));
            }
          });
        },
      },
    },
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
      "@openscout/runtime": path.resolve(__dirname, "../runtime/src"),
      "@openscout/protocol": path.resolve(__dirname, "../protocol/src"),
    },
  },
});
