import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Canonical published version — packages/cli is what `bun add -g @openscout/scout`
// installs. Read here (config runs in Node, outside the turbopack root) and inlined
// via env so app code never imports across the workspace boundary.
const cliPkg = JSON.parse(
  fs.readFileSync(
    path.join(projectRoot, "../../packages/cli/package.json"),
    "utf8",
  ),
);

const isProductionBuild = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  ...(isProductionBuild ? { output: "export" as const } : {}),
  env: {
    SCOUT_VERSION: cliPkg.version,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
