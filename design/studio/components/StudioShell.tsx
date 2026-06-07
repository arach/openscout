"use client";

import Link from "next/link";
import {
  StudioShell as Shell,
  StudioSidebar,
  PageStrip,
  SidebarLink,
  StatusDot,
  type BucketSpec,
  type SidebarRenderContext,
} from "studio/shell";
import {
  registry,
  type StudioBucket,
  type StudioSurface,
  type StudioStatus,
  type StudioPage,
} from "@/lib/studio-pages";
import { StatusPill, statusToColor } from "@/components/StatusPill";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Top-level shell — now composed from the shared `studio/shell` package
 * (StudioShell + StudioSidebar + PageStrip) over this app's registry and
 * status palette. `?focus=1` opts out of chrome (handled by the shared
 * shell). Plans/eng docs live on disk and are passed in as `extraPages`.
 *
 * Buckets render in order; only `eng` needs a custom layout (Index + the
 * 5 most-recently-touched SCO docs) — the rest use the shared defaults
 * (`studies` grouped by surface).
 */

const STATUS_COLORS: Record<StudioStatus, string> = {
  draft: statusToColor("draft"),
  "in-flight": statusToColor("in-flight"),
  shipped: statusToColor("shipped"),
  shelved: statusToColor("shelved"),
  concept: statusToColor("concept"),
};

/** Engineering bucket: Index entry + count + the 5 most recently touched
 *  SCO docs. The /eng index is the canonical browser for the full corpus. */
function renderEngBucket(
  ctx: SidebarRenderContext<StudioBucket, StudioSurface, StudioStatus>,
) {
  const { registry, pathname, extraPages, statusColors } = ctx;
  const all = registry.pagesIn("eng", extraPages);
  const indexPage = all.find((p) => p.href === "/eng");
  const docs = all
    .filter((p) => p.href !== "/eng" && p.updatedAt)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const recent = docs.slice(0, 5);
  const remaining = docs.length - recent.length;

  return (
    <div className="flex flex-col">
      {indexPage ? (
        <SidebarLink href="/eng" active={indexPage.href === pathname}>
          <span className="flex-1 truncate">{indexPage.label}</span>
          <span className="font-mono text-[8.5px] text-studio-ink-faint">
            {docs.length}
          </span>
        </SidebarLink>
      ) : null}

      {recent.length > 0 ? (
        <>
          <div className="mt-3 mb-1 px-2 font-mono text-[8.5px] uppercase tracking-[0.20em] text-studio-ink-faint">
            Recent
          </div>
          <div className="flex flex-col">
            {recent.map((page) => (
              <SidebarLink
                key={page.href}
                href={page.href}
                active={page.href === pathname}
                muted
              >
                <span className="flex-1 truncate">{page.label}</span>
                {page.status ? (
                  <StatusDot status={page.status} colors={statusColors} />
                ) : null}
              </SidebarLink>
            ))}
          </div>
          {remaining > 0 ? (
            <Link
              href="/eng"
              className="mt-1 px-2 py-1 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint hover:text-studio-ink"
            >
              +{remaining} more →
            </Link>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const BUCKETS: ReadonlyArray<BucketSpec<StudioBucket, StudioSurface, StudioStatus>> = [
  { key: "plans" },
  { key: "eng", render: renderEngBucket },
  { key: "foundations" },
  { key: "studies", surfaceGrouped: true },
  { key: "atoms" },
];

function SidebarHeader() {
  return (
    <div className="flex items-center gap-2 border-b border-studio-edge px-4 py-3.5">
      <div
        aria-hidden
        className="h-2 w-2 rounded-full"
        style={{ background: "var(--scout-accent)" }}
      />
      <Link
        href="/"
        className="focus-ring rounded-[2px] font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink"
      >
        Scout · Studio
      </Link>
    </div>
  );
}

function SidebarFooter({ totalPages }: { totalPages: number }) {
  return (
    <div className="mt-auto border-t border-studio-edge px-4 py-3">
      <ThemeToggle />
      <div className="mt-2 font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span>openscout</span>
        <span className="mx-1.5">·</span>
        <span>{totalPages} pages</span>
      </div>
    </div>
  );
}

export function StudioShell({
  children,
  extraPages,
}: {
  children: React.ReactNode;
  extraPages: StudioPage[];
}) {
  const totalPages = registry.pages.length + extraPages.length;
  return (
    <Shell
      sidebar={
        <StudioSidebar
          registry={registry}
          buckets={BUCKETS}
          extraPages={extraPages}
          statusColors={STATUS_COLORS}
          header={<SidebarHeader />}
          footer={<SidebarFooter totalPages={totalPages} />}
        />
      }
      pageStrip={
        <PageStrip
          registry={registry}
          extraPages={extraPages}
          renderStatusPill={(status) => <StatusPill status={status} />}
        />
      }
    >
      {children}
    </Shell>
  );
}
