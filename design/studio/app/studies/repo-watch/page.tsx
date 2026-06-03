"use client";

/**
 * Repo Watch — study (SCO-061 "State of Repos").
 *
 * Primary view is the dense Ledger; Triage is an optional toggle for when the
 * operator wants severity lanes instead of the per-project table. Both render
 * the same `RepoWatchSnapshot` — the exact shape of the live
 * `/v1/repo-watch/snapshot` response, so these components port straight into
 * the web app against real data.
 *
 * Data contract + attention model: docs/eng/sco-061-repo-watch-worktree-state.md.
 * Shared fixture: lib/repo-watch/mock.ts. Presentation helpers: lib/repo-watch/ui.ts.
 */

import { useState } from "react";
import { MOCK_SNAPSHOT } from "@/lib/repo-watch/mock";
import { RepoWatchLedger } from "@/components/RepoWatchLedger";
import { RepoWatchTriage } from "@/components/RepoWatchTriage";

type ViewKey = "ledger" | "triage";

const VIEWS: Array<{
  key: ViewKey;
  label: string;
  blurb: string;
  Component: ({ snapshot }: { snapshot: typeof MOCK_SNAPSHOT }) => React.ReactNode;
}> = [
  {
    key: "ledger",
    label: "Ledger",
    blurb: "Per-project table, every worktree on one severity-sorted line — the default read.",
    Component: RepoWatchLedger,
  },
  {
    key: "triage",
    label: "Triage",
    blurb: "Same worktrees re-dealt into attention lanes across the whole machine — what needs you first.",
    Component: RepoWatchTriage,
  },
];

export default function RepoWatchPage() {
  const [view, setView] = useState<ViewKey>("ledger");
  const current = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  const Active = current.Component;

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="text-[9px] font-mono font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · studies · macos · repo-watch · SCO-061
          </div>
          <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
            Repo Watch
          </h1>
          <p className="mt-3 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            The state of every repo on this machine — projects, worktrees,
            branches, dirty state, and which agents are attached — from one
            backend snapshot.
          </p>
        </div>

        {/* View toggle — Ledger is primary; Triage is the optional alternate. */}
        <div
          role="group"
          aria-label="Repo Watch view"
          className="flex shrink-0 items-center gap-0.5 rounded-[7px] border border-studio-edge bg-studio-surface p-0.5"
        >
          {VIEWS.map((v) => {
            const on = v.key === view;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                aria-pressed={on}
                className={[
                  "focus-ring rounded-[5px] px-3.5 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-eyebrow transition-colors duration-75",
                  on
                    ? "bg-scout-accent-soft text-scout-accent"
                    : "text-studio-ink-faint hover:text-studio-ink",
                ].join(" ")}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      </header>

      <p className="mb-5 min-h-[1.25em] max-w-prose font-sans text-[11.5px] leading-relaxed text-studio-ink-muted">
        {current.blurb}
      </p>

      <Active snapshot={MOCK_SNAPSHOT} />
    </main>
  );
}
