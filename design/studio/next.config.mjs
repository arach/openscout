/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next blocks dev client/HMR resources from "cross-origin" hosts by default,
  // which silently breaks hydration when the studio is opened on 127.0.0.1
  // (only localhost is trusted otherwise). Trust both loopback hosts.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
