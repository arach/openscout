import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared `studio` package ships raw .ts/.tsx (consumed via bun
  // workspace symlink) — Next must transpile it with our settings.
  transpilePackages: ["studio"],
  turbopack: {
    // `studio` (and `hudson`) are sibling repos of openscout, so their
    // source sits OUTSIDE openscout. Widen Turbopack's root to the common
    // parent dir so workspace-symlinked source resolves — otherwise
    // Turbopack rejects it ("leaves the filesystem root").
    root: path.resolve(__dirname, "../../.."),
  },
};

export default nextConfig;
