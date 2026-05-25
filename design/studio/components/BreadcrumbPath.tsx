"use client";

import Link from "next/link";

/**
 * Path breadcrumb — renders a repo-relative path as a chevron-separated
 * trail of clickable segments. Two display modes:
 *
 *   1. Callback mode — pass `onSegmentClick(parentRel)` to drive an
 *      in-page selection state. Used inside the file-explorer split
 *      where clicking a segment scopes the right pane to that dir.
 *   2. Link mode — fallback when no callback is provided. Each non-leaf
 *      segment links to a hypothetical `/eng/dir/<rel>` route; the leaf
 *      links to the file viewer at `/eng/file/<relPath>`.
 *
 * The final segment is always rendered in `text-studio-ink` (slightly
 * heavier); earlier segments use `text-studio-ink-faint` so the eye
 * lands on "where am I" rather than "where did I come from".
 */
export function BreadcrumbPath({
  relPath,
  onSegmentClick,
  fromRoute,
}: {
  /** Path relative to repo root, e.g. `design/studio/app/page.tsx`. */
  relPath: string;
  /** When set, segments call this with their parent relPath rather
   *  than navigating. Empty string = repo root. */
  onSegmentClick?: (parentRel: string) => void;
  /** Back-ref appended to leaf links (file viewer reads `?from=`). */
  fromRoute?: string;
}) {
  const segments = relPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return (
      <span className="font-mono text-[10.5px] text-studio-ink">
        /
      </span>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-1 font-mono text-[10.5px]">
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;
        const parentRel = segments.slice(0, i + 1).join("/");

        const cls = `inline-flex items-baseline truncate transition-colors ${
          isLast
            ? "text-studio-ink"
            : "text-studio-ink-faint hover:text-studio-ink"
        }`;

        let node: React.ReactNode;
        if (onSegmentClick) {
          node = (
            <button
              type="button"
              className={cls}
              onClick={() => onSegmentClick(parentRel)}
            >
              {segment}
            </button>
          );
        } else if (isLast) {
          const fileHref = `/eng/file/${segments
            .map(encodeURIComponent)
            .join("/")}${fromRoute ? `?from=${encodeURIComponent(fromRoute)}` : ""}`;
          node = (
            <Link href={fileHref} className={cls}>
              {segment}
            </Link>
          );
        } else {
          node = <span className={cls}>{segment}</span>;
        }

        return (
          <span key={`${i}:${segment}`} className="inline-flex items-baseline gap-1">
            {node}
            {!isLast ? (
              <span aria-hidden className="text-studio-ink-faint">
                ›
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
