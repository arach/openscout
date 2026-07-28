import fs from "node:fs";
import path from "node:path";
import { STUDIO_PAGES } from "./studio-pages";

/**
 * Map of study `href` → file mtime (ms since epoch), read server-side from
 * the study's on-disk backing file. The sidebar uses this to order the
 * Studies nav by recency (most-recently-edited first) and to stamp each row
 * with an age. Computed live on each server render — no caching needed at
 * studio scale, and it stays fresh as pages are edited.
 *
 * A study is backed by either (sometimes both):
 *  - `app/studies/<slug>/page.tsx` — conventional standalone pages
 *  - `views/<slug>.tsx`            — views rendered through `app/studies/[slug]`
 * The freshest of whichever exist wins. Studies with neither (registry
 * entries whose page moved) stay unset and sort last.
 */
export function studyMtimes(): Record<string, number> {
  const root = process.cwd();
  const out: Record<string, number> = {};
  for (const page of STUDIO_PAGES) {
    if (page.bucket !== "studies") continue;
    const slug = page.href.replace(/^\/studies\//, "");
    const candidates = [
      path.join(root, "app", page.href.replace(/^\//, ""), "page.tsx"),
      path.join(root, "views", `${slug}.tsx`),
    ];
    let max = 0;
    for (const file of candidates) {
      try {
        max = Math.max(max, fs.statSync(file).mtimeMs);
      } catch {
        // candidate doesn't exist — the other form may.
      }
    }
    if (max > 0) out[page.href] = max;
  }
  return out;
}
