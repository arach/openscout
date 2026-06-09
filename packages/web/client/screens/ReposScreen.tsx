import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Route } from "../lib/types.ts";
import { api } from "../lib/api.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import type {
  RepoWatchSnapshot,
  RepoWatchWorktree,
  RepoWatchProject,
} from "../scout/repo-watch/types.ts";
import RepoWatchTable from "../scout/repo-watch/RepoWatchTable.tsx";
import RepoWatchContext from "../scout/repo-watch/RepoWatchContext.tsx";
import { attentionRank } from "../scout/repo-watch/ui.ts";
import { SlidePanel } from "../components/SlidePanel/SlidePanel.tsx";
import { RepoDiffViewerLazy } from "../scout/repo-diff/RepoDiffViewerLazy.tsx";
import { prefetchRepoDiffSnapshots } from "../scout/repo-diff/cache.ts";
import {
  readRepoWatchCache,
  repoWatchSignature,
  writeRepoWatchCache,
} from "../scout/repo-watch/cache.ts";
import { OpsSubnav } from "./OpsSubnav.tsx";

/**
 * Repo Watch / State of Repos (SCO-061) — the live web view.
 *
 * Polls `GET /api/repo-watch` and renders the Fleet Table: every repo and
 * worktree on the machine in one operator-console panel — repos grouped with an
 * indented worktree tree, churn / drift / agents per row, sorted so unfinished
 * work floats to the top. The `--studio-*` / `--status-*` tokens are supplied by
 * `.repo-watch-scope` (see scout/repo-watch/repo-watch.css); the table itself
 * carries its own warm operator-console palette scoped to `.rw-table`.
 */

const REFRESH_MS = 10_000;

type RepoWatchScanDepth = "standard" | "expanded";

function repoWatchUrl(depth: RepoWatchScanDepth, force: boolean): string {
  const params = new URLSearchParams({
    includeDiff: "1",
    includeLastCommit: "1",
    native: "1",
  });
  if (force) params.set("force", "1");
  if (depth === "expanded") {
    // "Scan more" should go as wide as the broker allows. The broker clamps
    // each of these with Math.min(value, cap), so these are the effective
    // ceilings (maxRoots 128, maxWorktrees 32, scanBudgetMs 30s). The standard
    // pass (no params) falls back to the small TS defaults — 8 roots / 4
    // worktrees / 4s — so this is a real jump, not the old 32/12/12s that often
    // still left coverage capped.
    params.set("maxRoots", "128");
    params.set("maxWorktrees", "32");
    params.set("scanBudgetMs", "30000");
  }
  return `/api/repo-watch?${params.toString()}`;
}

/* The default selection — the most-relevant worktree so the context pane isn't
 * empty on load: worst attention first, then live-agent count, then churn. */
function pickDefaultWorktree(
  snapshot: RepoWatchSnapshot,
): RepoWatchWorktree | null {
  let best: RepoWatchWorktree | null = null;
  let bestScore = -Infinity;
  for (const project of snapshot.projects) {
    for (const wt of project.worktrees) {
      const liveAgents = wt.agents.filter(
        (a) => (a.state ?? "").toLowerCase() === "active",
      ).length;
      const score =
        (4 - attentionRank(wt.attention)) * 1_000_000 +
        liveAgents * 10_000 +
        wt.status.changedFiles;
      if (score > bestScore) {
        bestScore = score;
        best = wt;
      }
    }
  }
  return best;
}

function findById(
  snapshot: RepoWatchSnapshot | null,
  id: string | null,
): { worktree: RepoWatchWorktree | null; project: RepoWatchProject | null } {
  if (!snapshot || !id) return { worktree: null, project: null };
  for (const project of snapshot.projects) {
    for (const wt of project.worktrees) {
      if (wt.id === id) return { worktree: wt, project };
    }
  }
  return { worktree: null, project: null };
}

function prefetchWorktreePaths(
  snapshot: RepoWatchSnapshot,
  selectedId: string | null,
): string[] {
  const scored: Array<{ path: string; score: number }> = [];
  for (const project of snapshot.projects) {
    for (const wt of project.worktrees) {
      const dirty =
        wt.status.staged +
        wt.status.unstaged +
        wt.status.untracked +
        wt.status.conflicts;
      const liveAgents = wt.agents.filter(
        (a) => (a.state ?? "").toLowerCase() === "active",
      ).length;
      if (dirty === 0 && liveAgents === 0) continue;
      scored.push({
        path: wt.path,
        score:
          (wt.id === selectedId ? 10_000_000 : 0) +
          (4 - attentionRank(wt.attention)) * 100_000 +
          liveAgents * 10_000 +
          dirty * 100 +
          wt.status.changedFiles,
      });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .map((item) => item.path);
}

// Ops-cluster chrome — the same s-ops header + OpsSubnav module every other Ops
// page (Broker/Mesh/Harnesses) wraps its content in, so Repos navigates
// consistently with its siblings. The body scrolls itself (s-ops-body is
// overflow:hidden by default), which also gives the sticky context panel a
// scroll container.
function ReposOpsShell({
  navigate,
  children,
}: {
  navigate: (route: Route) => void;
  children?: ReactNode;
}) {
  return (
    <div className="s-ops">
      <div className="s-ops-header">
        <OpsSubnav activeRoute={{ view: "repos" }} navigate={navigate} />
      </div>
      <div className="s-ops-body" style={{ overflowY: "auto" }}>
        {children}
      </div>
    </div>
  );
}

export function ReposScreen({ navigate }: { navigate: (route: Route) => void }) {
  // Seed from the cross-session cache so a return visit / reload paints the last
  // scan instantly and refreshes in the background, rather than blocking on a
  // full-screen "Scanning…". See scout/repo-watch/cache.ts.
  const cached = useRef(readRepoWatchCache()).current;
  const [snapshot, setSnapshot] = useState<RepoWatchSnapshot | null>(
    cached?.snapshot ?? null,
  );
  const [phase, setPhase] = useState<"loading" | "ready" | "error">(
    cached ? "ready" : "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const hasData = useRef(Boolean(cached));
  const emptyStreak = useRef(0);

  // Background-refresh affordances: a subtle "updating" pulse while a poll is in
  // flight, and a one-shot glimmer (nonce bump) when a refresh actually changes
  // the data — a no-op poll stays silent.
  const [refreshing, setRefreshing] = useState(false);
  const [glimmerNonce, setGlimmerNonce] = useState(0);
  const [justFresh, setJustFresh] = useState(false);
  const prevSig = useRef<string>(repoWatchSignature(cached?.snapshot ?? null));

  // Selection is shared with the context pane via the `.rw-scope` wrapper, which
  // carries the (fixed "warm") palette vars.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scanDepth, setScanDepth] = useState<RepoWatchScanDepth>("standard");
  const [scanMorePending, setScanMorePending] = useState(false);
  // SCO-065: the worktree path whose diff is open in the slide-in viewer.
  const [diffPath, setDiffPath] = useState<string | null>(null);

  const load = useCallback(async (options: {
    depth?: RepoWatchScanDepth;
    force?: boolean;
    scanMore?: boolean;
  } = {}) => {
    const depth = options.depth ?? scanDepth;
    if (options.scanMore) setScanMorePending(true);
    // Show the "updating" pulse for any background refresh that isn't the very
    // first cold load (which already has its own full-screen state).
    if (!options.scanMore && hasData.current) setRefreshing(true);
    try {
      const data = await api<RepoWatchSnapshot>(
        repoWatchUrl(depth, options.force ?? false),
      );
      // The broker scan intermittently returns an empty (or sharply smaller)
      // snapshot even while repos exist — its filesystem scan races a budget.
      // Don't let a transient empty result wipe a good snapshot we already
      // showed; keep the last good data until a non-empty scan lands.
      if (data.projects.length === 0 && hasData.current && emptyStreak.current < 3) {
        // Ride out a few transient empty scans before believing repos are gone,
        // so the page doesn't flicker to empty — but don't get stuck forever.
        emptyStreak.current += 1;
        setPhase("ready");
        return;
      }
      emptyStreak.current = 0;
      hasData.current = true;
      writeRepoWatchCache(data, Date.now());
      // Only glimmer when the content the table renders actually changed, so a
      // steady 10s poll doesn't strobe.
      const sig = repoWatchSignature(data);
      if (prevSig.current && sig !== prevSig.current) {
        setGlimmerNonce((n) => n + 1);
      }
      prevSig.current = sig;
      setSnapshot(data);
      setError(null);
      setPhase("ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      // Keep showing the last good snapshot if a refresh fails.
      if (!hasData.current) setPhase("error");
    } finally {
      if (options.scanMore) setScanMorePending(false);
      setRefreshing(false);
    }
  }, [scanDepth]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Light the "Updated" badge for a beat whenever a refresh changes data, then
  // let it fade back to idle.
  useEffect(() => {
    if (glimmerNonce === 0) return;
    setJustFresh(true);
    const timer = window.setTimeout(() => setJustFresh(false), 1_400);
    return () => window.clearTimeout(timer);
  }, [glimmerNonce]);

  // Seed the selection once a snapshot lands (or if the selected worktree
  // vanished from a later scan) so the context pane is never blank.
  useEffect(() => {
    if (!snapshot) return;
    const stillThere = snapshot.projects.some((p) =>
      p.worktrees.some((w) => w.id === selectedId),
    );
    if (!stillThere) {
      setSelectedId(pickDefaultWorktree(snapshot)?.id ?? null);
    }
  }, [snapshot, selectedId]);

  useEffect(() => {
    if (!snapshot || snapshot.projects.length === 0) return;
    prefetchRepoDiffSnapshots(prefetchWorktreePaths(snapshot, selectedId));
  }, [snapshot, selectedId]);

  const selection = useMemo(
    () => findById(snapshot, selectedId),
    [snapshot, selectedId],
  );

  const scanMore = useCallback(() => {
    setScanDepth("expanded");
    void load({ depth: "expanded", force: true, scanMore: true });
  }, [load]);

  if (phase === "loading") {
    return (
      <ReposOpsShell navigate={navigate}>
        <div className="repo-watch-scope" style={{ padding: "24px" }}>
          <EmptyState
            title="Scanning repositories…"
            body="Reading worktree state from the broker."
          />
        </div>
      </ReposOpsShell>
    );
  }

  if (phase === "error" && !snapshot) {
    return (
      <ReposOpsShell navigate={navigate}>
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
      </ReposOpsShell>
    );
  }

  if (snapshot && snapshot.projects.length === 0) {
    return (
      <ReposOpsShell navigate={navigate}>
        <div className="repo-watch-scope" style={{ padding: "24px" }}>
          <EmptyState
            title="No repositories in view"
            body="Nothing active was discovered. Start an agent inside a git repo, or set OPENSCOUT_REPO_WATCH_ROOTS."
          />
        </div>
      </ReposOpsShell>
    );
  }

  if (!snapshot) return <ReposOpsShell navigate={navigate} />;

  return (
    <ReposOpsShell navigate={navigate}>
    <div className="repo-watch-scope">
      <div className="rw-scope tone-warm">
        <div className="mx-auto max-w-[1560px] px-6 py-6">
          {/* Section title anchors the page now that the Ops subnav is hidden
              in the lean view. Drift moved into the context pane per worktree;
              the table is the only main view. */}
          <div className="rw-toolbar">
            <h1 className="rw-title">Repos</h1>
            <span
              className={`rw-refresh${refreshing ? " is-busy" : ""}${justFresh ? " is-fresh" : ""}`}
              aria-live="polite"
            >
              <span className="rw-refresh-dot" aria-hidden />
              {refreshing ? (
                <span className="rw-refresh-label">Updating…</span>
              ) : justFresh ? (
                <span className="rw-refresh-label">Updated</span>
              ) : null}
            </span>
          </div>
          <div className="flex items-start gap-6">
            <div className="min-w-0 flex-1">
              <div className="rw-table-wrap">
                <RepoWatchTable
                  snapshot={snapshot}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onViewDiff={setDiffPath}
                  scanDepth={scanDepth}
                  scanMorePending={scanMorePending}
                  onScanMore={scanMore}
                />
                {glimmerNonce > 0 && (
                  <div key={glimmerNonce} className="rw-glimmer" aria-hidden />
                )}
              </div>
            </div>
            <div className="hidden w-[340px] flex-none lg:block sticky top-6 self-start">
              <RepoWatchContext
                worktree={selection.worktree}
                project={selection.project}
                generatedAt={snapshot.generatedAt}
              />
            </div>
          </div>
        </div>
      </div>

      {/* SCO-065 — the diff viewer slides in from the right. Lazy-loaded inside
          the panel so Pierre/Shiki only import when a row's "diff" is clicked. */}
      <SlidePanel
        open={diffPath != null}
        onClose={() => setDiffPath(null)}
        side="right"
        owner="openscout.repos-diff-viewer"
        resizable
        defaultSize={840}
        maxSize={1280}
        minSize={420}
        ariaLabel="Worktree diff"
      >
        {diffPath != null ? (
          <RepoDiffViewerLazy
            key={diffPath}
            path={diffPath}
            onClose={() => setDiffPath(null)}
            onOpenAsPage={() => {
              if (diffPath) {
                navigate({ view: "repo-diff", path: diffPath });
                setDiffPath(null);
              }
            }}
          />
        ) : null}
      </SlidePanel>
    </div>
    </ReposOpsShell>
  );
}

export default ReposScreen;
