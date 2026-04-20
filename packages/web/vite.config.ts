import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const hudsonSdk = resolve(__dirname, "../../..", "hudson/packages/hudson-sdk");
const webNodeModules = resolve(__dirname, "node_modules");

export default defineConfig({
  root: resolve(__dirname, "client"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "react": resolve(webNodeModules, "react"),
      "react-dom": resolve(webNodeModules, "react-dom"),
      "@ai-sdk/react": resolve(webNodeModules, "@ai-sdk/react"),
      "ai": resolve(webNodeModules, "ai"),
      "@hudson/sdk/app-shell": resolve(hudsonSdk, "src/app-shell.ts"),
      "@hudson/sdk/shell": resolve(hudsonSdk, "src/shell.ts"),
      "@hudson/sdk/controls": resolve(hudsonSdk, "src/controls.ts"),
      "@hudson/sdk/styles": resolve(hudsonSdk, "src/styles/bundle.css"),
      "@hudson/sdk": resolve(hudsonSdk, "src/index.ts"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
