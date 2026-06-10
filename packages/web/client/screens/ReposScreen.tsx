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
import RepoWatchDrift from "../scout/repo-watch/RepoWatchDrift.tsx";
import RepoWatchContext from "../scout/repo-watch/RepoWatchContext.tsx";
import { attentionRank, type Tone } from "../scout/repo-watch/ui.ts";
import { SlidePanel } from "../components/SlidePanel/SlidePanel.tsx";
import { RepoDiffViewerLazy } from "../scout/repo-diff/RepoDiffViewerLazy.tsx";
import { prefetchRepoDiffSnapshots } from "../scout/repo-diff/cache.ts";
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
const TONE_KEY = "openscout.repos.tone";
const TONES: readonly Tone[] = ["warm", "cool", "mono"];

type ReposView = "table" | "drift";
const VIEW_KEY = "openscout.repos.view";
const VIEWS: readonly ReposView[] = ["table", "drift"];
type RepoWatchScanDepth = "standard" | "expanded";

function repoWatchUrl(depth: RepoWatchScanDepth, force: boolean): string {
  const params = new URLSearchParams({
    includeDiff: "1",
    includeLastCommit: "1",
    native: "1",
  });
  if (force) params.set("force", "1");
  if (depth === "expanded") {
    params.set("maxRoots", "32");
    params.set("maxWorktrees", "12");
    params.set("scanBudgetMs", "12000");
  }
  return `/api/repo-watch?${params.toString()}`;
}

/** A bit of UI state mirrored to localStorage, validated against `allowed` so a
 *  stale or garbage stored value can never wedge the view. SSR-safe. */
function usePersistedState<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const stored = window.localStorage.getItem(key) as T | null;
      return stored && allowed.includes(stored) ? stored : fallback;
    } catch {
      // Safari private mode / sandboxed iframes can throw on access.
      return fallback;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* ignore private-mode / quota failures */
      }
    },
    [key],
  );
  return [value, set];
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

function RepoWatchEmptyNextSteps({ error }: { error?: string | null }) {
  return (
    <div className="rw-empty-next">
      <p className="rw-empty-copy">
        Repos is waiting on the local Scout Services layer. Restart the broker
        from the menu bar app, then rescan.
      </p>
      <ol className="rw-empty-steps">
        <li>
          Click <span className="rw-empty-action-name">Restart broker</span> to
          hand off to the menu bar app.
        </li>
        <li>
          Wait for Scout Services to report the broker online.
        </li>
        <li>
          If nothing opens, run <code>scout doctor</code> and follow the repair
          command it prints.
        </li>
      </ol>
      {error ? <p className="rw-empty-error">{error}</p> : null}
    </div>
  );
}

export function ReposScreen({ navigate }: { navigate: (route: Route) => void }) {
  const [snapshot, setSnapshot] = useState<RepoWatchSnapshot | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const hasData = useRef(false);
  const emptyStreak = useRef(0);

  // Tone + view persist to localStorage; selection is shared across both views.
  // All three reach the table and the context pane through the `.rw-scope`
  // wrapper (which carries the tone palette vars).
  const [tone, setTone] = usePersistedState<Tone>(TONE_KEY, TONES, "warm");
  const [view, setView] = usePersistedState<ReposView>(VIEW_KEY, VIEWS, "table");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scanDepth, setScanDepth] = useState<RepoWatchScanDepth>("standard");
  const [scanMorePending, setScanMorePending] = useState(false);
  const [serviceRestartPending, setServiceRestartPending] = useState(false);
  const [serviceRestartError, setServiceRestartError] = useState<string | null>(null);
  // SCO-065: the worktree path whose diff is open in the slide-in viewer.
  const [diffPath, setDiffPath] = useState<string | null>(null);

  const load = useCallback(async (options: {
    depth?: RepoWatchScanDepth;
    force?: boolean;
    scanMore?: boolean;
  } = {}) => {
    const depth = options.depth ?? scanDepth;
    if (options.scanMore) setScanMorePending(true);
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
    }
  }, [scanDepth]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

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

  const restartBrokerFromMenu = useCallback(async () => {
    if (serviceRestartPending) return;
    setServiceRestartPending(true);
    setServiceRestartError(null);

    try {
      const response = await fetch("/api/scout-services/restart-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "broker" }),
      });
      if (!response.ok) {
        throw new Error(`Scout Services link failed (${response.status})`);
      }
      const data = await response.json() as { url?: string };
      if (!data.url?.startsWith("scout://services/restart/")) {
        throw new Error("Scout Services link was not returned.");
      }
      window.location.assign(data.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setServiceRestartError(`${message} Run scout doctor if the menu app did not open.`);
    } finally {
      setServiceRestartPending(false);
    }
  }, [serviceRestartPending]);

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
            title="Scout Services need attention"
            body={<RepoWatchEmptyNextSteps error={serviceRestartError} />}
            action={
              <>
                <button
                  type="button"
                  className="s-btn s-btn-primary"
                  onClick={() => void restartBrokerFromMenu()}
                  disabled={serviceRestartPending}
                >
                  {serviceRestartPending ? "Opening…" : "Restart broker"}
                </button>
                <button
                  type="button"
                  className="s-btn"
                  onClick={scanNow}
                  disabled={refreshing || scanMorePending}
                >
                  {refreshing ? "Scanning…" : "Scan again"}
                </button>
              </>
            }
          />
        </div>
      </ReposOpsShell>
    );
  }

  if (!snapshot) return <ReposOpsShell navigate={navigate} />;

  return (
    <ReposOpsShell navigate={navigate}>
    <div className="repo-watch-scope">
      <div className={"rw-scope tone-" + tone}>
        <div className="mx-auto max-w-[1560px] px-6 py-6">
          {/* Shared toolbar: view toggle (left) + tone toggle (right). */}
          <div className="rw-toolbar">
            <div className="rw-tone" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={v === view ? "on" : ""}
                  aria-pressed={v === view}
                  onClick={() => setView(v)}
                >
                  {v}
                </button>
              ))}
            </div>
            <div
              className="rw-tone"
              style={{ marginLeft: "auto" }}
              role="group"
              aria-label="Console tone"
            >
              {TONES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={t === tone ? "on" : ""}
                  aria-pressed={t === tone}
                  onClick={() => setTone(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-start gap-6">
            <div className="min-w-0 flex-1">
              {view === "drift" ? (
                <RepoWatchDrift
                  snapshot={snapshot}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ) : (
                <RepoWatchTable
                  snapshot={snapshot}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onViewDiff={setDiffPath}
                  scanDepth={scanDepth}
                  scanMorePending={scanMorePending}
                  onScanMore={scanMore}
                />
              )}
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
