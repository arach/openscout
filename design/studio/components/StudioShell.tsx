"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { StatusBar } from "hudsonkit/chrome";
import { StudioSidebar } from "@/components/StudioSidebar";
import { PageStrip } from "@/components/PageStrip";
import { FocusExit } from "@/components/FocusMode";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  SidebarWidthProvider,
  useSidebarWidth,
  DEFAULT_SIDEBAR_W,
  MIN_SIDEBAR_W,
  MAX_SIDEBAR_W,
} from "@/components/sidebar-width";
import {
  STUDIO_PAGES,
  pageForPath,
  type StudioPage,
} from "@/lib/studio-pages";

/**
 * Studio shell.
 *
 * Left rail is ours (not Hudsonkit SidePanel) so resize is under full control.
 * StatusBar stays from hudsonkit/chrome. Drag any [data-studio-resize-handle];
 * width also via status-bar − / + and keyboard [ / ].
 */

const STATUS_H = 28;

type ShellProps = {
  children: React.ReactNode;
  extraPages: StudioPage[];
  studyMtimes: Record<string, number>;
};

export function StudioShell({ children, extraPages, studyMtimes }: ShellProps) {
  return (
    <SidebarWidthProvider>
      <ShellBody extraPages={extraPages} studyMtimes={studyMtimes}>
        {children}
      </ShellBody>
    </SidebarWidthProvider>
  );
}

function ShellBody({ children, extraPages, studyMtimes }: ShellProps) {
  const { width, dragging, nudge, reset } = useSidebarWidth();
  const [focusMode, setFocusMode] = useState(false);
  const pathname = usePathname();
  const page = pageForPath(pathname, extraPages);
  const totalPages = STUDIO_PAGES.length + extraPages.length;

  const status = useMemo(() => {
    if (page?.status === "in-flight") {
      return { label: "IN FLIGHT", color: "amber" as const };
    }
    if (page?.status === "shipped") {
      return { label: "SHIPPED", color: "emerald" as const };
    }
    if (page?.status === "shelved") {
      return { label: "SHELVED", color: "red" as const };
    }
    return { label: "STUDIO", color: "emerald" as const };
  }, [page?.status]);

  return (
    <>
      <Suspense fallback={null}>
        <FocusModeWatcher onChange={setFocusMode} />
      </Suspense>

      {focusMode ? (
        <>
          <main className="min-h-screen">{children}</main>
          <FocusExit />
        </>
      ) : (
        <div className="min-h-screen bg-studio-canvas text-studio-ink">
          {/* ── Left rail (fully owned) ───────────────────────────── */}
          <aside
            className="fixed left-0 top-0 z-40 flex flex-col border-r border-studio-edge bg-studio-canvas"
            style={{
              width,
              bottom: STATUS_H,
            }}
            data-studio-rail=""
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-studio-edge px-3 py-3">
              <Link
                href="/"
                className="focus-ring rounded-[2px] font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink"
              >
                Scout · Studio
              </Link>
              <div className="flex items-center gap-1">
                <WidthButtons width={width} onNudge={nudge} onReset={reset} />
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-hidden">
              <StudioSidebar
                extraPages={extraPages}
                studyMtimes={studyMtimes}
              />
            </div>

            <footer className="shrink-0 border-t border-studio-edge p-3">
              <ThemeToggle />
            </footer>

            {/* Drag handle — right edge of rail, always visible */}
            <div
              data-studio-resize-handle=""
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              aria-valuenow={width}
              aria-valuemin={MIN_SIDEBAR_W}
              aria-valuemax={MAX_SIDEBAR_W}
              title={`Drag to resize (${width}px) · [ ] keys also work`}
              data-dragging={dragging ? "true" : undefined}
              className={
                "absolute inset-y-0 right-0 z-50 w-2 cursor-col-resize touch-none " +
                "hover:bg-[color-mix(in_srgb,var(--scout-accent)_18%,transparent)] " +
                (dragging
                  ? "bg-[color-mix(in_srgb,var(--scout-accent)_28%,transparent)]"
                  : "")
              }
            >
              <span
                aria-hidden
                className={
                  "pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 " +
                  (dragging
                    ? "bg-[color:var(--scout-accent)]"
                    : "bg-studio-edge")
                }
              />
              <span
                aria-hidden
                className={
                  "pointer-events-none absolute left-1/2 top-1/2 flex h-10 w-3 " +
                  "-translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-[3px] " +
                  "rounded-sm border border-studio-edge bg-studio-canvas-alt " +
                  (dragging ? "border-[color:var(--scout-accent)]" : "")
                }
              >
                <i className="block h-[2px] w-[2px] rounded-full bg-studio-ink-faint" />
                <i className="block h-[2px] w-[2px] rounded-full bg-studio-ink-faint" />
                <i className="block h-[2px] w-[2px] rounded-full bg-studio-ink-faint" />
              </span>
            </div>
          </aside>

          {/* ── Main ──────────────────────────────────────────────── */}
          <div
            className="flex min-h-screen flex-col"
            style={{ marginLeft: width, paddingBottom: STATUS_H }}
          >
            <PageStrip extraPages={extraPages} />
            <main className="flex-1">{children}</main>
          </div>

          {/* ── Status bar (Hudsonkit) ────────────────────────────── */}
          <StatusBar
            status={status}
            left={
              <span className="flex min-w-0 items-center gap-3">
                <WidthButtons width={width} onNudge={nudge} onReset={reset} />
                <span className="truncate text-muted-foreground">
                  {page ? (
                    <>
                      <span className="text-foreground/80">{page.label}</span>
                      {page.bucket ? (
                        <span className="ml-2 uppercase tracking-eyebrow opacity-70">
                          · {page.bucket}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    "OpenScout Studio"
                  )}
                </span>
              </span>
            }
            right={
              <span className="flex items-center gap-2 tabular-nums text-muted-foreground">
                <span className="hidden sm:inline">[ ] resize</span>
                <span className="text-muted-foreground/40" aria-hidden>
                  ·
                </span>
                <span>{totalPages} pages</span>
                <span className="text-muted-foreground/40" aria-hidden>
                  ·
                </span>
                <StudioClock />
              </span>
            }
          />
        </div>
      )}
    </>
  );
}

function WidthButtons({
  width,
  onNudge,
  onReset,
}: {
  width: number;
  onNudge: (d: number) => void;
  onReset: () => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      style={{ pointerEvents: "auto" }}
    >
      <button
        type="button"
        onClick={() => onNudge(-32)}
        className="rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[10px] text-studio-ink-faint hover:bg-studio-canvas-alt hover:text-studio-ink"
        title="Narrower (−32px) · key ["
        aria-label="Narrow sidebar"
      >
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        className="min-w-[2.75rem] rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-studio-ink-faint hover:bg-studio-canvas-alt hover:text-studio-ink"
        title={`Reset to ${DEFAULT_SIDEBAR_W}px`}
        aria-label={`Sidebar width ${width} pixels, click to reset`}
      >
        {width}
      </button>
      <button
        type="button"
        onClick={() => onNudge(32)}
        className="rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[10px] text-studio-ink-faint hover:bg-studio-canvas-alt hover:text-studio-ink"
        title="Wider (+32px) · key ]"
        aria-label="Widen sidebar"
      >
        +
      </button>
    </div>
  );
}

function StudioClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const label = now
    ? now.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "––:––";
  return (
    <time
      dateTime={now?.toISOString()}
      suppressHydrationWarning
      className="font-mono tabular-nums tracking-wide text-foreground"
    >
      {label}
    </time>
  );
}

function FocusModeWatcher({
  onChange,
}: {
  onChange: (focus: boolean) => void;
}) {
  const params = useSearchParams();
  const focus =
    params.get("focus") === "1" || params.get("focus") === "true";
  useEffect(() => {
    onChange(focus);
  }, [focus, onChange]);
  return null;
}
