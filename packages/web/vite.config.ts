import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname, "client"),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5180,
    proxy: {
      "/api": { target: "http://127.0.0.1:3200", changeOrigin: true },
    },
  },
});
