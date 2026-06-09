import { productionSiteHosts } from "./site-links";

export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || "G-QZN11K0EH9";

export const GA_ALLOWED_HOSTS = (
  process.env.NEXT_PUBLIC_GA_ALLOWED_HOSTS?.split(",") || Array.from(productionSiteHosts)
).map((host) => host.trim().toLowerCase()).filter(Boolean);

export const ENABLE_GOOGLE_ANALYTICS =
  process.env.NODE_ENV === "production" && Boolean(GA_MEASUREMENT_ID);

export function isAnalyticsHostAllowed(hostname: string) {
  return GA_ALLOWED_HOSTS.includes(hostname.trim().toLowerCase());
}
