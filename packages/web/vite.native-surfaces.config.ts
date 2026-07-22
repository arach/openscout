import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const nativeRoot = resolve(__dirname, "client/native-surfaces");

export default defineConfig({
  root: nativeRoot,
  base: "./",
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(__dirname, "../../apps/ios/Scout/Resources/WebSurfaces"),
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: "shared",
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        lanes: resolve(nativeRoot, "lanes/index.html"),
        dispatch: resolve(nativeRoot, "dispatch/index.html"),
      },
    },
  },
});
