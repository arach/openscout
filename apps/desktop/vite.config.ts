import type { ServerResponse } from "node:http";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DEFAULT_RENDERER_PORT = 43173;
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
        // Shell state can wait on broker I/O; avoid proxy giving up early.
        timeout: 180_000,
        proxyTimeout: 180_000,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            const code = err && typeof err === "object" && "code" in err
              ? String((err as NodeJS.ErrnoException).code)
              : "";
            const detail = code === "ECONNREFUSED"
              ? `Nothing is listening at ${webApiTarget}. Run \`bun run --cwd apps/desktop web\`, or start \`bun run --cwd apps/desktop dev:web\` to boot both the Bun server and Vite.`
              : `Upstream closed the connection (${err.message}). Restart the Scout web process if it crashed.`;
            console.error(`[vite] /api proxy -> ${webApiTarget}:`, detail);
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
      allow: [path.resolve(__dirname, "..", "..")],
    },
  },
  preview: {
    host: rendererHost,
    port: rendererPort,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/web/app"),
      "@web": path.resolve(__dirname, "src/web"),
      "@openscout/runtime": path.resolve(__dirname, "../../packages/runtime/src"),
      "@openscout/protocol": path.resolve(__dirname, "../../packages/protocol/src"),
    },
  },
});
