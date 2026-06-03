import { useCallback, useEffect, useRef, useState } from "react";
import type { Route } from "../lib/types.ts";
import { api } from "../lib/api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import type { RepoWatchSnapshot } from "../scout/repo-watch/types.ts";
import { RepoWatchLedger } from "../scout/repo-watch/RepoWatchLedger.tsx";
import { RepoWatchTriage } from "../scout/repo-watch/RepoWatchTriage.tsx";

/**
 * Repo Watch / State of Repos (SCO-061) — the live web view.
 *
 * Polls `GET /v1/repo-watch/snapshot` and renders the studio-designed Ledger
 * (default) with an optional Triage toggle. The components were authored in the
 * design studio against the exact `@openscout/runtime` snapshot shape, so they
 * render the broker response directly. Their `--studio-*` / `--status-*` tokens
 * are supplied by `.repo-watch-scope` (see scout/repo-watch/repo-watch.css),
 * mapped onto the app's `--hud-*` theme tokens.
 */

const REFRESH_MS = 10_000;
type ViewKey = "ledger" | "triage";

export function ReposScreen(_props: { navigate: (route: Route) => void }) {
  const [snapshot, setSnapshot] = useState<RepoWatchSnapshot | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>("ledger");
  const hasData = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await api<RepoWatchSnapshot>(
        "/api/repo-watch?includeDiff=1&includeLastCommit=1",
      );
      hasData.current = true;
      setSnapshot(data);
      setError(null);
      setPhase("ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      // Keep showing the last good snapshot if a refresh fails.
      if (!hasData.current) setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (phase === "loading") {
    return (
      <div className="repo-watch-scope" style={{ padding: "24px" }}>
        <EmptyState
          title="Scanning repositories…"
          body="Reading worktree state from the broker."
        />
      </div>
    );
  }

  if (phase === "error" && !snapshot) {
    return (
      <div className="repo-watch-scope" style={{ padding: "24px" }}>
        <EmptyState
          className="sys-state-card-error"
          title="Couldn’t load Repo Watch"
          body={error ?? "The broker did not return a snapshot."}
          action={
            <button
              type="button"
              className="s-btn"
              onClick={() => {
                setPhase("loading");
                void load();
              }}
            >
              Retry
            </button>
          }
        />
      </div>
    );
  }

  if (snapshot && snapshot.projects.length === 0) {
    return (
      <div className="repo-watch-scope" style={{ padding: "24px" }}>
        <EmptyState
          title="No repositories in view"
          body="Nothing active was discovered. Start an agent inside a git repo, or set OPENSCOUT_REPO_WATCH_ROOTS."
        />
      </div>
    );
  }

  if (!snapshot) return null;

  return (
    <div className="repo-watch-scope">
      <div className="mx-auto max-w-[1680px] px-7 py-6">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              · repo watch · state of repos
            </div>
            <h1 className="mt-1 font-display text-[26px] font-medium leading-none tracking-tight text-studio-ink">
              Repos
            </h1>
            <p className="mt-2.5 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
              The state of every repo on this machine — projects, worktrees,
              branches, dirty state, and which agents are attached.
            </p>
          </div>

          <div
            role="group"
            aria-label="Repo Watch view"
            className="flex shrink-0 items-center gap-0.5 rounded-[7px] border border-studio-edge bg-studio-surface p-0.5"
          >
            {(["ledger", "triage"] as ViewKey[]).map((key) => {
              const on = key === view;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  aria-pressed={on}
                  className={[
                    "rounded-[5px] px-3.5 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-eyebrow transition-colors duration-75",
                    on
                      ? "bg-scout-accent-soft text-scout-accent"
                      : "text-studio-ink-faint hover:text-studio-ink",
                  ].join(" ")}
                >
                  {key}
                </button>
              );
            })}
          </div>
        </header>

        {view === "ledger" ? (
          <RepoWatchLedger snapshot={snapshot} />
        ) : (
          <RepoWatchTriage snapshot={snapshot} />
        )}
      </div>
    </div>
  );
}

export default ReposScreen;
