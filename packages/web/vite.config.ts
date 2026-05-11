import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

function resolveHudsonSdk(): string {
  if (process.env.HUDSON_SDK_PATH) {
    return resolve(process.env.HUDSON_SDK_PATH);
  }
  const direct = resolve(__dirname, "../../..", "hudson/packages/hudson-sdk");
  if (existsSync(direct)) {
    return direct;
  }
  try {
    const commonGitDir = execSync("git rev-parse --git-common-dir", {
      cwd: __dirname,
      encoding: "utf8",
    }).trim();
    const mainRepoRoot = resolve(commonGitDir, "..");
    const fromCommon = resolve(mainRepoRoot, "..", "hudson/packages/hudson-sdk");
    if (existsSync(fromCommon)) {
      return fromCommon;
    }
  } catch {
    // git not available or not a repo — fall through
  }
  return direct;
}

const hudsonSdk = resolveHudsonSdk();
const webNodeModules = resolve(__dirname, "node_modules");
const bunTarget = process.env.OPENSCOUT_WEB_BUN_URL?.trim() || "http://127.0.0.1:3200";
const viteHmrPath = process.env.OPENSCOUT_WEB_VITE_HMR_PATH?.trim() || "/__vite_hmr";
const terminalRelayPath = process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PATH?.trim() || "/terminal-relay";

export default defineConfig({
  root: resolve(__dirname, "client"),
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  server: {
    hmr: {
      path: viteHmrPath,
    },
    proxy: {
      "/api": { target: bunTarget, changeOrigin: false, ws: true },
      "/health": { target: bunTarget, changeOrigin: false },
      [terminalRelayPath]: { target: bunTarget, changeOrigin: false, ws: true },
    },
  },
  resolve: {
    alias: {
      "react": resolve(webNodeModules, "react"),
      "react-dom": resolve(webNodeModules, "react-dom"),
      "@ai-sdk/react": resolve(webNodeModules, "@ai-sdk/react"),
      "ai": resolve(webNodeModules, "ai"),
      "@hudson/sdk/app-shell": resolve(hudsonSdk, "src/app-shell.ts"),
      "@hudson/sdk/shell": resolve(hudsonSdk, "src/shell.ts"),
      "@hudson/sdk/chrome": resolve(hudsonSdk, "src/chrome.ts"),
      "@hudson/sdk/controls": resolve(hudsonSdk, "src/controls.ts"),
      "@hudson/sdk/overlays": resolve(hudsonSdk, "src/overlays.ts"),
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
