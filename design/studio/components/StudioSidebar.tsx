"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";
import {
  STUDIO_PAGES,
  familyGroups,
  pagesBySurface,
  pagesIn,
  surfaceLabel,
  type StudioBucket,
  type StudioPage,
  type StudioStatus,
} from "@/lib/studio-pages";

type SortMode = "recent" | "alpha" | "status";

const SORT_MODES: ReadonlyArray<{ id: SortMode; label: string; title: string }> = [
  { id: "recent", label: "rec", title: "Most recently edited first" },
  { id: "alpha", label: "a–z", title: "Alphabetical by label" },
  { id: "status", label: "stat", title: "By status, then label" },
];

const SORT_LS_KEY = "studio.sidebar.sort";
const STATUS_RANK: Record<StudioStatus, number> = {
  "in-flight": 0,
  draft: 1,
  concept: 2,
  shipped: 3,
  shelved: 4,
};

/**
 * Studio nav body for Hudsonkit SidePanel — search, sort, and bucket list.
 * Plans / Studies / Atoms with surface grouping; family variants collapse
 * under their primary. Shell owns the SidePanel chrome + width + status bar.
 */
export function StudioSidebar({
  extraPages,
  studyMtimes = {},
}: {
  extraPages: StudioPage[];
  studyMtimes?: Record<string, number>;
}) {
  const pathname = usePathname();
  const totalPages = STUDIO_PAGES.length + extraPages.length;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(SORT_LS_KEY) as SortMode | null;
    if (saved && SORT_MODES.some((m) => m.id === saved)) setSort(saved);
  }, []);

  const setSortPersist = useCallback((mode: SortMode) => {
    setSort(mode);
    localStorage.setItem(SORT_LS_KEY, mode);
  }, []);

  // `/` focuses search when not already typing in a field; Escape clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const allPages = useMemo(
    () => [...STUDIO_PAGES, ...extraPages],
    [extraPages],
  );

  const matches = useMemo(() => {
    if (!searching) return null;
    return allPages.filter((p) => pageMatches(p, q));
  }, [allPages, searching, q]);

  return (
    <div className="pointer-events-auto flex h-full min-h-0 flex-col">
      <SidebarControls
        query={query}
        onQueryChange={setQuery}
        sort={sort}
        onSortChange={setSortPersist}
        searchRef={searchRef}
        matchCount={matches?.length}
        totalPages={totalPages}
      />

      <nav className="studio-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-2 font-mono text-sm">
        {searching ? (
          <SearchResults
            pages={sortPages(matches ?? [], sort, studyMtimes)}
            query={q}
            pathname={pathname}
            studyMtimes={studyMtimes}
          />
        ) : (
          <div className="flex flex-col gap-7">
            <BucketSection
              title="Plans"
              bucket="plans"
              pathname={pathname}
              extraPages={extraPages}
              sort={sort}
              studyMtimes={studyMtimes}
            />
            <EngBucketSection
              pathname={pathname}
              extraPages={extraPages}
              sort={sort}
            />
            <BucketSection
              title="Foundations"
              bucket="foundations"
              pathname={pathname}
              extraPages={extraPages}
              sort={sort}
              studyMtimes={studyMtimes}
            />
            <BucketSection
              title="Studies"
              bucket="studies"
              pathname={pathname}
              extraPages={extraPages}
              surfaceGrouped
              sort={sort}
              studyMtimes={studyMtimes}
            />
            <BucketSection
              title="Atoms"
              bucket="atoms"
              pathname={pathname}
              extraPages={extraPages}
              sort={sort}
              studyMtimes={studyMtimes}
            />
          </div>
        )}
      </nav>
    </div>
  );
}

function pageMatches(page: StudioPage, q: string): boolean {
  const hay = [
    page.label,
    page.blurb,
    page.href,
    page.bucket,
    page.surface,
    page.status,
    page.family,
    ...(page.source ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  // Token AND — typing "ios home" requires both tokens somewhere.
  return q.split(/\s+/).every((token) => hay.includes(token));
}

function pageRecency(page: StudioPage, mtimes: Record<string, number>): number {
  const fromMtime = mtimes[page.href] ?? 0;
  const fromIso = page.updatedAt ? Date.parse(page.updatedAt) || 0 : 0;
  return Math.max(fromMtime, fromIso);
}

/** Bucket index rows (`/plans`, `/studies`, …) stay pinned above the
 *  entries they index so sort never buries the doorway. */
function isBucketIndex(page: StudioPage): boolean {
  return page.href === `/${page.bucket}`;
}

function comparePages(
  a: StudioPage,
  b: StudioPage,
  sort: SortMode,
  mtimes: Record<string, number>,
): number {
  const aIndex = isBucketIndex(a) ? 0 : 1;
  const bIndex = isBucketIndex(b) ? 0 : 1;
  if (aIndex !== bIndex) return aIndex - bIndex;

  if (sort === "recent") {
    const delta = pageRecency(b, mtimes) - pageRecency(a, mtimes);
    if (delta !== 0) return delta;
  } else if (sort === "status") {
    const ra = a.status ? STATUS_RANK[a.status] : 99;
    const rb = b.status ? STATUS_RANK[b.status] : 99;
    if (ra !== rb) return ra - rb;
  }
  return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
}

function sortPages(
  pages: StudioPage[],
  sort: SortMode,
  mtimes: Record<string, number>,
): StudioPage[] {
  return [...pages].sort((a, b) => comparePages(a, b, sort, mtimes));
}

function sortFamilyGroups(
  groups: ReturnType<typeof familyGroups>,
  sort: SortMode,
  mtimes: Record<string, number>,
) {
  return [...groups].sort((a, b) => {
    const aIndex = isBucketIndex(a.primary) ? 0 : 1;
    const bIndex = isBucketIndex(b.primary) ? 0 : 1;
    if (aIndex !== bIndex) return aIndex - bIndex;

    if (sort === "recent") {
      const delta =
        freshest([b.primary, ...b.variants], mtimes) -
        freshest([a.primary, ...a.variants], mtimes);
      if (delta !== 0) return delta;
      return a.primary.label.localeCompare(b.primary.label, undefined, {
        sensitivity: "base",
      });
    }
    if (sort === "status") {
      const ra = a.primary.status ? STATUS_RANK[a.primary.status] : 99;
      const rb = b.primary.status ? STATUS_RANK[b.primary.status] : 99;
      if (ra !== rb) return ra - rb;
    }
    return a.primary.label.localeCompare(b.primary.label, undefined, {
      sensitivity: "base",
    });
  });
}

function SidebarControls({
  query,
  onQueryChange,
  sort,
  onSortChange,
  searchRef,
  matchCount,
  totalPages,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  sort: SortMode;
  onSortChange: (mode: SortMode) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  matchCount?: number;
  totalPages: number;
}) {
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (query) {
        e.preventDefault();
        onQueryChange("");
      } else {
        (e.target as HTMLInputElement).blur();
      }
    }
  };

  return (
    <div className="shrink-0 border-b border-studio-edge px-3 py-2.5">
      <label className="studio-search relative flex items-center gap-1.5 rounded-[5px] px-2 py-1.5">
        <span
          aria-hidden
          className="font-mono text-2xs text-studio-ink-faint"
        >
          ▸
        </span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search pages…"
          aria-label="Search studio pages"
          className={cn(
            "min-w-0 flex-1 bg-transparent font-mono text-xs text-studio-ink",
            "placeholder:text-studio-ink-faint outline-none",
            // Kill browser search chrome so the field stays studio-shaped.
            "[&::-webkit-search-cancel-button]:hidden",
          )}
        />
        {!query ? (
          <kbd className="shrink-0 rounded-[2px] border border-studio-edge bg-studio-canvas/60 px-1 font-mono text-2xs text-studio-ink-faint">
            /
          </kbd>
        ) : (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="focus-ring shrink-0 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint transition-colors hover:text-studio-ink"
            aria-label="Clear search"
          >
            esc
          </button>
        )}
      </label>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Sort pages"
          className="flex items-center gap-0.5 rounded-[4px] border border-studio-edge p-0.5"
        >
          {SORT_MODES.map((mode) => {
            const active = sort === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                title={mode.title}
                aria-pressed={active}
                onClick={() => onSortChange(mode.id)}
                className={cn(
                  "focus-ring rounded-[3px] px-1.5 py-0.5 font-mono text-2xs uppercase tracking-eyebrow transition-colors",
                  active
                    ? "bg-studio-canvas text-studio-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--studio-ink)_10%,transparent)]"
                    : "text-studio-ink-faint hover:text-studio-ink",
                )}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
        <span
          suppressHydrationWarning
          className="font-mono text-2xs tabular-nums text-studio-ink-faint"
        >
          {matchCount !== undefined
            ? `${matchCount}/${totalPages}`
            : SORT_MODES.find((m) => m.id === sort)?.label}
        </span>
      </div>
    </div>
  );
}

function SearchResults({
  pages,
  query,
  pathname,
  studyMtimes,
}: {
  pages: StudioPage[];
  query: string;
  pathname: string | null;
  studyMtimes: Record<string, number>;
}) {
  if (pages.length === 0) {
    return (
      <div className="px-1 py-6 font-mono text-xs text-studio-ink-faint">
        No pages match{" "}
        <span className="text-studio-ink">“{query}”</span>
      </div>
    );
  }

  // Flat list while searching — buckets dissolve so a token like "ios"
  // can surface studies + eng notes in one scannable column.
  return (
    <section>
      <SectionTitle>
        Matches{" "}
        <span className="text-studio-ink-faint">· {pages.length}</span>
      </SectionTitle>
      <div className="mt-1.5 flex flex-col">
        {pages.map((page) => (
          <SidebarLink
            key={page.href}
            href={page.href}
            active={page.href === pathname}
          >
            <span className="flex-1 truncate">{page.label}</span>
            <span className="shrink-0 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
              {page.bucket}
            </span>
            <AgeStamp ms={pageRecency(page, studyMtimes) || undefined} />
            {page.status ? <StatusDot status={page.status} /> : null}
          </SidebarLink>
        ))}
      </div>
    </section>
  );
}

/** Freshest mtime across a set of pages (0 if none are tracked). */
function freshest(pages: StudioPage[], mtimes: Record<string, number>): number {
  let max = 0;
  for (const p of pages) max = Math.max(max, pageRecency(p, mtimes));
  return max;
}

/** Compact relative age ("12m" · "3h" · "5d" · "2w" · "4mo") — the stamp
 *  that makes the recency ordering legible on the row itself. */
function ageLabel(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 30) return `${Math.floor(s / (86400 * 7))}w`;
  return `${Math.floor(s / (86400 * 30))}mo`;
}

function AgeStamp({ ms }: { ms?: number }) {
  if (!ms) return null;
  return (
    // suppressHydrationWarning: the label derives from Date.now(), which can
    // cross a unit boundary between server render and hydration.
    <span
      suppressHydrationWarning
      className="ml-1 shrink-0 font-mono text-2xs tabular-nums text-studio-ink-faint"
    >
      {ageLabel(ms)}
    </span>
  );
}

function BucketSection({
  title,
  bucket,
  pathname,
  extraPages,
  surfaceGrouped = false,
  sort,
  studyMtimes = {},
}: {
  title: string;
  bucket: StudioBucket;
  pathname: string | null;
  extraPages: StudioPage[];
  surfaceGrouped?: boolean;
  sort: SortMode;
  studyMtimes?: Record<string, number>;
}) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-1.5 flex flex-col gap-3">
        {surfaceGrouped ? (
          [...pagesBySurface(bucket, extraPages)]
            .sort((a, b) => {
              if (sort === "alpha") {
                return surfaceLabel(a.surface).localeCompare(
                  surfaceLabel(b.surface),
                  undefined,
                  { sensitivity: "base" },
                );
              }
              if (sort === "status") {
                // Surface order stays recency-ish for status mode; status
                // applies inside each surface block.
                return (
                  freshest(b.pages, studyMtimes) - freshest(a.pages, studyMtimes)
                );
              }
              return freshest(b.pages, studyMtimes) - freshest(a.pages, studyMtimes);
            })
            .map(({ surface, pages }) => (
              <SurfaceBlock
                key={surface}
                label={surfaceLabel(surface)}
                groups={sortFamilyGroups(familyGroups(pages), sort, studyMtimes)}
                pathname={pathname}
                mtimes={studyMtimes}
                sort={sort}
              />
            ))
        ) : (
          <div className="flex flex-col">
            {sortFamilyGroups(
              familyGroups(pagesIn(bucket, extraPages)),
              sort,
              studyMtimes,
            ).map((group) => (
              <PageItem
                key={group.primary.href}
                group={group}
                pathname={pathname}
                sort={sort}
                studyMtimes={studyMtimes}
                mtime={
                  sort === "recent"
                    ? freshest([group.primary, ...group.variants], studyMtimes) ||
                      undefined
                    : pageRecency(group.primary, studyMtimes) || undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Engineering bucket renders lean: the Index entry + a short sorted
 *  slice of SCO docs. The /eng index is the full corpus browser.
 *  Recency uses each page's `updatedAt` (from file mtime). */
function EngBucketSection({
  pathname,
  extraPages,
  sort,
}: {
  pathname: string | null;
  extraPages: StudioPage[];
  sort: SortMode;
}) {
  const all = pagesIn("eng", extraPages);
  const indexPage = all.find((p) => p.href === "/eng");
  const docs = sortPages(
    all.filter((p) => p.href !== "/eng"),
    sort,
    {},
  );
  // Keep the rail lean under recency; alpha/status can show a few more
  // so the active mode is visible without dumping the whole corpus.
  const visibleLimit = sort === "recent" ? 5 : 8;
  const visible = docs.slice(0, visibleLimit);
  const remaining = docs.length - visible.length;

  return (
    <section>
      <SectionTitle>Engineering</SectionTitle>
      <div className="mt-1.5 flex flex-col">
        {indexPage ? (
          <SidebarLink href="/eng" active={indexPage.href === pathname}>
            <span className="flex-1 truncate">{indexPage.label}</span>
            <span className="font-mono text-2xs text-studio-ink-faint">
              {docs.length}
            </span>
          </SidebarLink>
        ) : null}

        {visible.length > 0 ? (
          <>
            <div className="mt-3 mb-1 px-2 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
              {sort === "alpha" ? "A–Z" : sort === "status" ? "By status" : "Recent"}
            </div>
            <div className="flex flex-col">
              {visible.map((page) => (
                <SidebarLink
                  key={page.href}
                  href={page.href}
                  active={page.href === pathname}
                  muted
                >
                  <span className="flex-1 truncate">{page.label}</span>
                  <AgeStamp
                    ms={pageRecency(page, {}) || undefined}
                  />
                  {page.status ? <StatusDot status={page.status} /> : null}
                </SidebarLink>
              ))}
            </div>
            {remaining > 0 ? (
              <Link
                href="/eng"
                className="mt-1 px-2 py-1 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint hover:text-studio-ink"
              >
                +{remaining} more →
              </Link>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-mono text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
      <span className="text-scout-accent" aria-hidden>
        ·
      </span>
      <span>{children}</span>
    </h2>
  );
}

function SurfaceBlock({
  label,
  groups,
  pathname,
  mtimes,
  sort = "recent",
}: {
  label: string;
  groups: ReturnType<typeof familyGroups>;
  pathname: string | null;
  mtimes?: Record<string, number>;
  sort?: SortMode;
}) {
  return (
    <div>
      <h3 className="mb-1 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </h3>
      <div className="flex flex-col">
        {groups.map((group) => (
          <PageItem
            key={group.primary.href}
            group={group}
            pathname={pathname}
            sort={sort}
            studyMtimes={mtimes}
            // The family's freshest, not the primary's — the row must wear
            // the same recency the sort ranked it by.
            mtime={
              mtimes
                ? freshest([group.primary, ...group.variants], mtimes) ||
                  undefined
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function PageItem({
  group,
  pathname,
  mtime,
  sort = "recent",
  studyMtimes = {},
}: {
  group: { primary: StudioPage; variants: StudioPage[] };
  pathname: string | null;
  mtime?: number;
  sort?: SortMode;
  studyMtimes?: Record<string, number>;
}) {
  const { primary, variants } = group;
  const hasVariants = variants.length > 0;
  const activeHere = primary.href === pathname;
  const variantActive = variants.some((v) => v.href === pathname);
  const [expanded, setExpanded] = useState(activeHere || variantActive);
  const sortedVariants = useMemo(
    () => sortPages(variants, sort, studyMtimes),
    [variants, sort, studyMtimes],
  );

  return (
    <div>
      <div className="flex items-center">
        <SidebarLink href={primary.href} active={activeHere} className="flex-1">
          <span className="flex-1 truncate">{primary.label}</span>
          <AgeStamp ms={mtime} />
          {primary.status ? <StatusDot status={primary.status} /> : null}
        </SidebarLink>
        {hasVariants ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              "ml-1 grid h-5 w-5 place-items-center rounded-[3px]",
              "text-studio-ink-faint hover:text-studio-ink hover:bg-studio-canvas-alt",
            )}
            aria-label={expanded ? "Collapse variants" : "Expand variants"}
          >
            <span className="text-2xs">{expanded ? "−" : "+"}</span>
          </button>
        ) : null}
      </div>
      {hasVariants && expanded ? (
        <div className="ml-3 flex flex-col border-l border-studio-edge pl-2.5">
          {sortedVariants.map((v) => (
            <SidebarLink
              key={v.href}
              href={v.href}
              active={v.href === pathname}
              muted
            >
              <span className="flex-1 truncate">{v.label}</span>
              <AgeStamp
                ms={pageRecency(v, studyMtimes) || undefined}
              />
              {v.status ? <StatusDot status={v.status} /> : null}
            </SidebarLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SidebarLink({
  href,
  active,
  muted,
  className,
  children,
}: {
  href: string;
  active: boolean;
  muted?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      data-active={active ? "true" : undefined}
      className={cn(
        "studio-nav-link focus-ring flex items-center gap-1.5 rounded-[4px] px-2 py-1",
        active
          ? "text-studio-ink"
          : muted
            ? "text-studio-ink-faint hover:bg-studio-canvas/70 hover:text-studio-ink"
            : "text-studio-ink-muted hover:bg-studio-canvas/70 hover:text-studio-ink",
        className,
      )}
    >
      {children}
    </Link>
  );
}

const STATUS_COLOR: Record<StudioStatus, string> = {
  draft: "var(--status-neutral-fg)",
  "in-flight": "var(--status-warn-fg)",
  shipped: "var(--status-ok-fg)",
  shelved: "var(--status-error-fg)",
  concept: "var(--status-info-fg)",
};

function StatusDot({ status }: { status: StudioStatus }) {
  return (
    <span
      aria-label={status}
      title={status}
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: STATUS_COLOR[status] }}
    />
  );
}
