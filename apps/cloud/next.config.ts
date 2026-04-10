import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(projectRoot, "../..");

const nextConfig: NextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
  async rewrites() {
    return [
      {
        source: "/api/report",
        destination: "/api/feedback",
      },
      {
        source: "/api/reports",
        destination: "/api/feedback",
      },
      {
        source: "/api/reports/:id",
        destination: "/api/feedback/:id",
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/reports",
        destination: "/feedback",
        permanent: true,
      },
      {
        source: "/reports/:id",
        destination: "/feedback/:id",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
