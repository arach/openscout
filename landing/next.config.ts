import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const isProductionBuild = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  ...(isProductionBuild ? { output: "export" as const } : {}),
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
