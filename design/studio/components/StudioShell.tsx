"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { StudioSidebar } from "@/components/StudioSidebar";
import { PageStrip } from "@/components/PageStrip";
import type { StudioPage } from "@/lib/studio-pages";

/**
 * Top-level shell — persistent 220px sidebar + per-page header strip.
 *
 * `?focus=1` opts pages out of chrome for fullscreen mocks / screenshots.
 *
 * Plans live on disk, so the root layout reads them server-side and
 * passes them in here. The sidebar + page strip both honor them.
 */
export function StudioShell({
  children,
  extraPages,
}: {
  children: React.ReactNode;
  extraPages: StudioPage[];
}) {
  return (
    <Suspense fallback={<ShellFallback extraPages={extraPages}>{children}</ShellFallback>}>
      <ShellInner extraPages={extraPages}>{children}</ShellInner>
    </Suspense>
  );
}

function ShellInner({
  children,
  extraPages,
}: {
  children: React.ReactNode;
  extraPages: StudioPage[];
}) {
  const params = useSearchParams();
  const focusMode =
    params.get("focus") === "1" || params.get("focus") === "true";

  if (focusMode) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className="min-h-screen">
      <StudioSidebar extraPages={extraPages} />
      <div className="ml-[220px] flex min-h-screen flex-col">
        <PageStrip extraPages={extraPages} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function ShellFallback({
  children,
  extraPages,
}: {
  children: React.ReactNode;
  extraPages: StudioPage[];
}) {
  return (
    <div className="min-h-screen">
      <StudioSidebar extraPages={extraPages} />
      <div className="ml-[220px] flex min-h-screen flex-col">
        <PageStrip extraPages={extraPages} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
