"use client";

import { usePathname } from "next/navigation";
import { StatusPill as StatusPillAtom } from "@/components/StatusPill";
import {
  bucketLabel,
  insertionPointForId,
  pageForPath,
  surfaceLabel,
  type StudioPage,
  type StudioStatus,
} from "@/lib/studio-pages";

/**
 * Per-page header strip — breadcrumbs · status pill · source refs ·
 * blurb. Reads the registry entry for the current route; pages
 * without an entry render no strip.
 *
 * Handles dynamic plan routes by stripping `/plans/<slug>` to `/plans`
 * lookup if the exact path isn't registered.
 */
export function PageStrip({ extraPages }: { extraPages: StudioPage[] }) {
  const pathname = usePathname();
  const page = pageForPath(pathname, extraPages);
  if (!page) return null;
  const targetPoint = page.target
    ? insertionPointForId(page.target.anchor)
    : undefined;

  return (
    <div className="border-b border-studio-edge bg-studio-canvas px-7 py-2.5 font-mono text-[10px]">
      <div className="flex flex-wrap items-baseline gap-3">
        <Crumbs page={page} />
        <Sep />
        <StatusPill status={page.status} />
        {page.source && page.source.length > 0 ? (
          <>
            <Sep />
            <SourceRefs files={page.source} />
          </>
        ) : null}
        {page.target ? (
          <>
            <Sep />
            <TargetRef
              anchor={page.target.anchor}
              mode={page.target.mode}
              label={targetPoint?.label}
            />
          </>
        ) : null}
        {page.blurb ? (
          <>
            <span className="mx-1 text-studio-ink-faint">·</span>
            <span className="font-sans text-[11px] italic text-studio-ink-faint">
              {page.blurb}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function TargetRef({
  anchor,
  mode,
  label,
}: {
  anchor: string;
  mode: string;
  label?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5 text-studio-ink-faint">
      <span className="text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        target
      </span>
      <code className="rounded-[2px] bg-studio-canvas-alt px-1 py-px text-[9.5px] text-studio-ink">
        {anchor}
      </code>
      <span className="text-[9px] uppercase tracking-[0.18em] text-studio-ink-faint">
        {mode}
      </span>
      {label ? (
        <span className="font-sans text-[11px] italic text-studio-ink-faint">
          {label}
        </span>
      ) : null}
    </div>
  );
}

function Crumbs({ page }: { page: StudioPage }) {
  const surface = page.surface ? surfaceLabel(page.surface) : null;

  return (
    <div className="flex items-baseline gap-1.5 uppercase tracking-eyebrow text-studio-ink-faint">
      <span>{bucketLabel(page.bucket)}</span>
      {surface ? (
        <>
          <Chevron />
          <span>{surface}</span>
        </>
      ) : null}
      {page.family && page.family !== page.label.toLowerCase() ? (
        <>
          <Chevron />
          <span>{page.family}</span>
        </>
      ) : null}
      <Chevron />
      <span className="text-studio-ink">{page.label}</span>
    </div>
  );
}

function StatusPill({ status }: { status?: StudioStatus }) {
  if (!status) return null;
  return <StatusPillAtom status={status} />;
}

function SourceRefs({ files }: { files: string[] }) {
  return (
    <div className="flex items-baseline gap-1.5 text-studio-ink-faint">
      <span className="text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        source
      </span>
      {files.map((file, i) => (
        <span key={file} className="inline-flex items-baseline gap-1">
          <code className="rounded-[2px] bg-studio-canvas-alt px-1 py-px text-[9.5px] text-studio-ink">
            {basename(file)}
          </code>
          {i < files.length - 1 ? (
            <span className="text-studio-ink-faint">,</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function Sep() {
  return <span aria-hidden className="h-3 w-px shrink-0 bg-studio-edge" />;
}

function Chevron() {
  return (
    <span aria-hidden className="text-studio-ink-faint">
      ›
    </span>
  );
}
