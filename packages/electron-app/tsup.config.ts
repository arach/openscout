import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["electron/main.ts", "electron/pair-supervisor.ts"],
  format: ["esm"],
  outDir: "dist/electron",
  target: "node22",
  splitting: false,
  external: ["electron"],
});
