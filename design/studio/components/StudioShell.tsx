"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { StudioSidebar } from "@/components/StudioSidebar";
import { PageStrip } from "@/components/PageStrip";
import type { StudioPage } from "@/lib/studio-pages";

/**
 * Top-level shell — persistent, resizable sidebar + per-page header strip.
 *
 * `?focus=1` opts pages out of chrome for fullscreen mocks / screenshots.
 *
 * Plans + eng docs live on disk, so the root layout reads them server-side
 * and passes them in. `studyMtimes` (study href → file mtime) is likewise
 * computed server-side so the sidebar can order Studies by recency.
 *
 * The sidebar width is user-draggable (persisted to localStorage) and shared
 * with the content offset so the two never desync.
 */

const MIN_W = 180;
const MAX_W = 480;
const DEFAULT_W = 220;
const LS_KEY = "studio.sidebarWidth";

type ShellProps = {
  children: React.ReactNode;
  extraPages: StudioPage[];
  studyMtimes: Record<string, number>;
};

export function StudioShell({ children, extraPages, studyMtimes }: ShellProps) {
  return (
    <Suspense
      fallback={
        <ShellChrome extraPages={extraPages} studyMtimes={studyMtimes}>
          {children}
        </ShellChrome>
      }
    >
      <ShellInner extraPages={extraPages} studyMtimes={studyMtimes}>
        {children}
      </ShellInner>
    </Suspense>
  );
}

function ShellInner({ children, extraPages, studyMtimes }: ShellProps) {
  const params = useSearchParams();
  const focusMode =
    params.get("focus") === "1" || params.get("focus") === "true";

  if (focusMode) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <ShellChrome extraPages={extraPages} studyMtimes={studyMtimes}>
      {children}
    </ShellChrome>
  );
}

function ShellChrome({ children, extraPages, studyMtimes }: ShellProps) {
  const [width, setWidth] = useState(DEFAULT_W);

  // Restore the saved width after mount (kept out of the initial render to
  // avoid an SSR/client hydration mismatch).
  useEffect(() => {
    const saved = Number(localStorage.getItem(LS_KEY));
    if (Number.isFinite(saved) && saved >= MIN_W && saved <= MAX_W) {
      setWidth(saved);
    }
  }, []);

  const onResizeStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const onMove = (ev: globalThis.MouseEvent) => {
      setWidth(Math.min(MAX_W, Math.max(MIN_W, ev.clientX)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth((w) => {
        localStorage.setItem(LS_KEY, String(Math.round(w)));
        return w;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  return (
    <div className="min-h-screen">
      <StudioSidebar extraPages={extraPages} studyMtimes={studyMtimes} width={width} />
      {/* Drag handle — straddles the sidebar's right border, full height,
          above both panes so it always catches the grab. Double-click resets. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={onResizeStart}
        onDoubleClick={() => {
          setWidth(DEFAULT_W);
          localStorage.setItem(LS_KEY, String(DEFAULT_W));
        }}
        className="group fixed top-0 z-40 h-screen w-[7px] cursor-col-resize"
        style={{ left: width - 3 }}
      >
        <span className="absolute inset-y-0 left-[3px] w-px bg-transparent transition-colors group-hover:bg-[color:var(--scout-accent)]" />
      </div>
      <div style={{ marginLeft: width }} className="flex min-h-screen flex-col">
        <PageStrip extraPages={extraPages} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
