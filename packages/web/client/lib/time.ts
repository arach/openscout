/** Relative time label: "now", "5s", "10m", "2h", "3d". */
export function timeAgo(ts: number): string {
  const tsMs = ts < 1e12 ? ts * 1000 : ts;
  const diff = Math.floor((Date.now() - tsMs) / 1000);
  if (diff < 5) return "now";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/** Full human-readable timestamp. */
export function fullTimestamp(ts: number): string {
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
  });
}
