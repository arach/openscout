import fs from "node:fs";
import path from "node:path";
import { STUDIO_PAGES } from "./studio-pages";

/**
 * Map of study `href` → file mtime (ms since epoch), read server-side from
 * each study page's on-disk `page.tsx`. The sidebar uses this to order the
 * Studies nav by recency (most-recently-edited first). Computed live on each
 * server render — no caching needed at studio scale, and it stays fresh as
 * pages are edited.
 *
 * Only the `studies` bucket is mapped; hrefs are `/studies/<slug>` →
 * `app/studies/<slug>/page.tsx` relative to the studio app root (cwd when
 * `bun run dev` runs in design/studio). Missing files are skipped and sort
 * last.
 */
export function studyMtimes(): Record<string, number> {
  const root = process.cwd();
  const out: Record<string, number> = {};
  for (const page of STUDIO_PAGES) {
    if (page.bucket !== "studies") continue;
    const rel = page.href.replace(/^\//, "");
    const file = path.join(root, "app", rel, "page.tsx");
    try {
      out[page.href] = fs.statSync(file).mtimeMs;
    } catch {
      // No page.tsx at the conventional path — leave unset (sorts last).
    }
  }
  return out;
}
