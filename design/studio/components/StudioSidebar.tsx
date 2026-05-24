"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
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

/**
 * Persistent left sidebar — Plans / Studies / Atoms buckets, with
 * Studies sub-grouped by surface. Variants of the same family collapse
 * under their primary. 220px width to mirror Talkie Studio.
 */
export function StudioSidebar({ extraPages }: { extraPages: StudioPage[] }) {
  const pathname = usePathname();
  const totalPages = STUDIO_PAGES.length + extraPages.length;

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-30 flex h-screen w-[220px] flex-col",
        "border-r border-studio-edge bg-studio-canvas",
        "overflow-y-auto",
      )}
    >
      <SidebarHeader />

      <nav className="flex flex-col gap-7 px-4 pb-10 pt-3 font-mono text-[10.5px]">
        <BucketSection
          title="Plans"
          bucket="plans"
          pathname={pathname}
          extraPages={extraPages}
        />
        <EngBucketSection pathname={pathname} extraPages={extraPages} />
        <BucketSection
          title="Foundations"
          bucket="foundations"
          pathname={pathname}
          extraPages={extraPages}
        />
        <BucketSection
          title="Studies"
          bucket="studies"
          pathname={pathname}
          extraPages={extraPages}
          surfaceGrouped
        />
        <BucketSection
          title="Atoms"
          bucket="atoms"
          pathname={pathname}
          extraPages={extraPages}
        />
      </nav>

      <SidebarFooter totalPages={totalPages} />
    </aside>
  );
}

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

function BucketSection({
  title,
  bucket,
  pathname,
  extraPages,
  surfaceGrouped = false,
}: {
  title: string;
  bucket: StudioBucket;
  pathname: string | null;
  extraPages: StudioPage[];
  surfaceGrouped?: boolean;
}) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-1.5 flex flex-col gap-3">
        {surfaceGrouped ? (
          pagesBySurface(bucket, extraPages).map(({ surface, pages }) => (
            <SurfaceBlock
              key={surface}
              label={surfaceLabel(surface)}
              groups={familyGroups(pages)}
              pathname={pathname}
            />
          ))
        ) : (
          <div className="flex flex-col">
            {familyGroups(pagesIn(bucket, extraPages)).map((group) => (
              <PageItem
                key={group.primary.href}
                group={group}
                pathname={pathname}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Engineering bucket renders lean: the Index entry + the 5 most
 *  recently touched SCO docs. The /eng index page is the canonical
 *  browser for the full 46-family corpus. */
function EngBucketSection({
  pathname,
  extraPages,
}: {
  pathname: string | null;
  extraPages: StudioPage[];
}) {
  const all = pagesIn("eng", extraPages);
  const indexPage = all.find((p) => p.href === "/eng");
  const docs = all
    .filter((p) => p.href !== "/eng" && p.updatedAt)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const recent = docs.slice(0, 5);
  const remaining = docs.length - recent.length;

  return (
    <section>
      <SectionTitle>Engineering</SectionTitle>
      <div className="mt-1.5 flex flex-col">
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
                  {page.status ? <StatusDot status={page.status} /> : null}
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
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-studio-ink-faint">
      · {children}
    </h2>
  );
}

function SurfaceBlock({
  label,
  groups,
  pathname,
}: {
  label: string;
  groups: ReturnType<typeof familyGroups>;
  pathname: string | null;
}) {
  return (
    <div>
      <h3 className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.20em] text-studio-ink-faint">
        {label}
      </h3>
      <div className="flex flex-col">
        {groups.map((group) => (
          <PageItem key={group.primary.href} group={group} pathname={pathname} />
        ))}
      </div>
    </div>
  );
}

function PageItem({
  group,
  pathname,
}: {
  group: { primary: StudioPage; variants: StudioPage[] };
  pathname: string | null;
}) {
  const { primary, variants } = group;
  const hasVariants = variants.length > 0;
  const activeHere = primary.href === pathname;
  const variantActive = variants.some((v) => v.href === pathname);
  const [expanded, setExpanded] = useState(activeHere || variantActive);

  return (
    <div>
      <div className="flex items-center">
        <SidebarLink href={primary.href} active={activeHere} className="flex-1">
          <span className="flex-1 truncate">{primary.label}</span>
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
            <span className="text-[9px]">{expanded ? "−" : "+"}</span>
          </button>
        ) : null}
      </div>
      {hasVariants && expanded ? (
        <div className="ml-3 flex flex-col border-l border-studio-edge pl-2.5">
          {variants.map((v) => (
            <SidebarLink
              key={v.href}
              href={v.href}
              active={v.href === pathname}
              muted
            >
              <span className="flex-1 truncate">{v.label}</span>
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
      className={cn(
        "focus-ring flex items-center gap-1.5 rounded-[3px] px-2 py-1 transition-colors",
        active
          ? "bg-studio-canvas-alt text-studio-ink"
          : muted
            ? "text-studio-ink-faint hover:bg-studio-canvas-alt hover:text-studio-ink"
            : "text-studio-ink-faint hover:bg-studio-canvas-alt hover:text-studio-ink",
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
