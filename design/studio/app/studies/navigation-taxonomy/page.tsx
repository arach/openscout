import { redirect } from "next/navigation";

/**
 * `/studies/navigation-taxonomy` was the old nav-reorg before/after doc.
 * Its source was never committed (only a WIP snapshot + stale .next cache),
 * and it's been superseded by the richer `/studies/web-taxonomy` page
 * inventory + interactive map. Redirect the old URL (stale tabs/bookmarks)
 * to the replacement so it doesn't dead-end on a 404.
 */
export default function NavigationTaxonomyRedirect() {
  redirect("/studies/web-taxonomy");
}
