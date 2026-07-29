/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Hudsonkit ships compiled ESM; transpile so Next/Turbopack resolve its
  // package exports cleanly next to the studio app.
  transpilePackages: ["hudsonkit"],
  // Next blocks dev client/HMR resources from "cross-origin" hosts by default,
  // which silently breaks hydration when the studio is opened on 127.0.0.1
  // (only localhost is trusted otherwise). Also trust arach/studio's
  // {repo}.studio.local host edge (shared Caddy or studio host on :80).
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.studio.local"],
  experimental: {
    // Next preloads EVERY route entry into memory on dev startup by default
    // (preloadEntriesOnStart: true). With ~87 study routes that's the whole
    // studio resident at once — the OOM. Load routes on demand instead.
    preloadEntriesOnStart: false,
  },
};

export default nextConfig;
