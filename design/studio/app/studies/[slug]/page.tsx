"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useMemo } from "react";

/**
 * One dynamic route for every self-contained study view.
 *
 * Each module under `views/` is code-split into its own chunk; only the
 * visited slug's chunk is fetched, so navigating across studies never
 * accumulates more than one view in memory. This collapses ~80 per-study
 * `app/studies/<name>/page.tsx` route entries into a single entry — the
 * fix for Next loading the whole studio at once.
 *
 * Server/data-backed studies (session-search, workflow-run, file-card,
 * file-explorer, data, tree-viewer) keep their own folders. A static
 * segment always wins over this dynamic one, so those never reach here.
 */

function Frame({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-page px-7 py-8">{children}</main>;
}

function Loading() {
  return (
    <Frame>
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
        Loading…
      </div>
    </Frame>
  );
}

function Missing({ slug }: { slug?: string }) {
  return (
    <Frame>
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
        Study not found
      </div>
      <p className="mt-2 text-[13px] text-studio-ink">
        No view module exists for{" "}
        <code className="font-mono text-studio-ink-muted">/studies/{slug}</code>.
      </p>
    </Frame>
  );
}

export default function StudyView() {
  const { slug } = useParams<{ slug: string }>();

  const View = useMemo(
    () =>
      dynamic(
        () =>
          import(`../../../views/${slug}`).catch(() => ({
            default: () => <Missing slug={slug} />,
          })),
        { ssr: false, loading: () => <Loading /> },
      ),
    [slug],
  );

  if (!slug) return null;
  return <View />;
}
