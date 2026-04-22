export function isOpsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.has("no-ops")) return false;
  return true;
}
