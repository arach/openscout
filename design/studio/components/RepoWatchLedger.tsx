"use client";

/**
 * Repo Watch — calm inventory treatment (SCO-061).
 *
 * A bird's-eye list of every repo on the machine and the worktrees with
 * something going on, presented in the app's OWN vocabulary: each repo is a
 * titled section over a lifted surface card; each worktree is a padded row that
 * reads in plain English (sans titles, mono only for numerics). Structure comes
 * from surface tone + spacing — NO rules, lines, or dividers anywhere (they read
 * as harsh near-white seams on the app theme, which the operator rejects).
 * Clean checkouts fold away ("+N clean"); fully-idle repos drop
 * to a quiet tray under "all"; ignore hides a repo entirely.
 *
 * Colour is reserved for meaning only: red = conflict, accent = a live agent.
 * Everything else is ink / muted / faint. The single interaction is an optional
 * per-row expand that reveals the changed-file list; every headline fact (what
 * changed, how big, who's on it, how stale) is visible without a click.
 */

import { useMemo, useState } from "react";
import type {
  RepoWatchSnapshot,
  RepoWatchWorktree,
  RepoWatchProject,
} from "@/lib/repo-watch/types";
import {
  ATTENTION,
  shortPath,
  agoFromMillis,
  fileStatusTone,
  fileStatusBadge,
  isConflict,
  agentLive,
  agentHandle,
  toneFg,
  toneBg,
} from "@/lib/repo-watch/ui";

/* ── View model: filter + ignore (no table-header sorting) ───────────────
 * "recent" shows only the repos with something going on; "all" also lists the
 * clean, idle ones in a quiet tray. Ignore is a per-machine curation: an ignored
 * repo drops out of the list (and the counts) entirely, reachable again only via
 * the ignored tray. */
type FilterMode = "recent" | "all";

/* Severity reads as ONE small dot, tone + size by level — red critical, bright
 * attention, accent active, faint idle. No new hues; the dot is the only mark
 * the eye has to parse at the head of a row. */
const SEV_DOT: Record<string, { size: number; color: string }> = {
  critical: { size: 7, color: "var(--status-error-fg)" },
  attention: { size: 6, color: "var(--studio-ink)" },
  active: { size: 6, color: "var(--scout-accent)" },
  quiet: { size: 4, color: "var(--studio-ink-faint)" },
  unknown: { size: 4, color: "var(--studio-ink-faint)" },
};

/* Panels float on the canvas by a lifted FILL plus a soft shadow — NEVER a
 * border or rule. On the near-black app theme a 1px edge reads as a harsh
 * near-white seam, so the boundary of every panel is a soft tonal step.
 *
 * The fill is anchored to canvas + ink — the two tokens that are IDENTICAL in
 * the studio and the live app (0.14 / 0.96). `--studio-surface` is NOT used: it
 * differs between the two (0.20 studio vs 0.18 live), which is exactly why an
 * earlier surface-anchored fill looked crisp in the studio but washed out live.
 * Anchoring to canvas makes the studio a faithful preview of the live result. */
const PANEL_BG =
  "color-mix(in oklab, var(--studio-canvas) 84%, var(--studio-ink))";
const PANEL_SHADOW =
  "shadow-[0_1px_2px_rgba(0,0,0,0.45),0_10px_26px_-8px_rgba(0,0,0,0.5)]";

/* Ignored repos — persisted in localStorage so the operator's curation sticks
 * across reloads. Stored as a Set of project ids. */
const IGNORED_KEY = "openscout.repos.ignored";

function useIgnored() {
  const [ignored, setIgnored] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const raw = window.localStorage.getItem(IGNORED_KEY);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  });
  const toggle = (id: string) =>
    setIgnored((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(IGNORED_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore quota / privacy-mode failures */
      }
      return next;
    });
  return [ignored, toggle] as const;
}

/* Stable worktree order within a repo: worst-first, main winning ties. */
function worktreeOrder(a: RepoWatchWorktree, b: RepoWatchWorktree): number {
  const r = ATTENTION[a.attention].rank - ATTENTION[b.attention].rank;
  if (r !== 0) return r;
  if (a.branch.isMain !== b.branch.isMain) return a.branch.isMain ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/* A worktree is "going on" when there's something live or unfinished in it:
 * uncommitted changes, an unpushed/unpulled commit, a live agent, or a parked
 * session. Clean, idle worktrees fold away rather than spending a row each. */
function hasActivity(wt: RepoWatchWorktree): boolean {
  return (
    !wt.status.clean ||
    wt.branch.ahead > 0 ||
    wt.branch.behind > 0 ||
    wt.agents.some(agentLive) ||
    wt.sessions.length > 0
  );
}

export function RepoWatchLedger({ snapshot }: { snapshot: RepoWatchSnapshot }) {
  const [filter, setFilter] = useState<FilterMode>("recent");
  const [ignored, toggleIgnore] = useIgnored();
  const [showIgnored, setShowIgnored] = useState(false);

  // Partition the inventory: ignored repos drop out entirely (reachable only
  // via the tray); the rest split into live (something going on) and quiet
  // (clean, idle). Live leads, worst-first then name; the tails are name-sorted.
  const { live, quiet, ignoredList } = useMemo(() => {
    const live: RepoWatchProject[] = [];
    const quiet: RepoWatchProject[] = [];
    const ignoredList: RepoWatchProject[] = [];
    for (const p of snapshot.projects) {
      if (ignored.has(p.id)) ignoredList.push(p);
      else if (p.worktrees.some(hasActivity)) live.push(p);
      else quiet.push(p);
    }
    const byName = (a: RepoWatchProject, b: RepoWatchProject) =>
      a.name.localeCompare(b.name);
    live.sort(
      (a, b) =>
        ATTENTION[a.attention].rank - ATTENTION[b.attention].rank || byName(a, b),
    );
    quiet.sort(byName);
    ignoredList.sort(byName);
    return { live, quiet, ignoredList };
  }, [snapshot.projects, ignored]);

  // Overview counts reflect what's actually in view — ignoring a repo drops it
  // from the totals too, so the numbers always match what you're looking at.
  let repos = 0;
  let worktrees = 0;
  let active = 0;
  let changed = 0;
  let conflicts = 0;
  let liveAgents = 0;
  for (const p of [...live, ...quiet]) {
    repos++;
    for (const wt of p.worktrees) {
      worktrees++;
      if (hasActivity(wt)) active++;
      if (!wt.status.clean) changed++;
      if (wt.status.conflicts > 0) conflicts++;
      liveAgents += wt.agents.filter(agentLive).length;
    }
  }

  return (
    <section className="text-studio-ink">
      {/* Overview line — the inventory on the left, the filter (and a way back
          to ignored repos) on the right. "Everything you've got going on." */}
      <header className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <SummaryStrip
          repos={repos}
          worktrees={worktrees}
          active={active}
          changed={changed}
          conflicts={conflicts}
          live={liveAgents}
        />
        <div className="flex shrink-0 items-center gap-3">
          {ignored.size > 0 ? (
            <button
              type="button"
              onClick={() => setShowIgnored((v) => !v)}
              aria-pressed={showIgnored}
              className={[
                "text-[11px] transition-colors",
                showIgnored
                  ? "text-studio-ink-muted"
                  : "text-studio-ink-faint hover:text-studio-ink-muted",
              ].join(" ")}
            >
              ignored ({ignored.size})
            </button>
          ) : null}
          <FilterControl filter={filter} onFilter={setFilter} />
        </div>
      </header>

      {/* Live repos — one soft panel PER repo, separated by spacing (no lines),
          so the list reads as distinct cards, not one big blob. A single-worktree
          repo is a compact one-line card; a multi-worktree project is a taller
          card: quiet sub-head + indented worktree sub-rows + "+N clean". */}
      {live.length > 0 ? (
        <div className="space-y-3">
          {live.map((project) => (
            <RepoEntry
              key={project.id}
              project={project}
              generatedAt={snapshot.generatedAt}
              onIgnore={() => toggleIgnore(project.id)}
            />
          ))}
        </div>
      ) : (
        <div
          className={`rounded-xl px-4 py-5 text-[12px] text-studio-ink-faint ${PANEL_SHADOW}`}
          style={{ background: PANEL_BG }}
        >
          Nothing going on right now
          {quiet.length > 0 ? " — switch to all to see your other repos" : ""}.
        </div>
      )}

      {/* Clean tray — only under "all"; cared-about-but-idle repos, still
          findable, kept out of the way without having to ignore them. */}
      {filter === "all" && quiet.length > 0 ? (
        <QuietSection
          label={`clean & idle (${quiet.length})`}
          projects={quiet}
          onIgnore={toggleIgnore}
        />
      ) : null}

      {/* Ignored tray — opened from the header; restore with "unignore". */}
      {showIgnored && ignoredList.length > 0 ? (
        <QuietSection
          label={`ignored (${ignoredList.length})`}
          projects={ignoredList}
          onIgnore={toggleIgnore}
          ignored
        />
      ) : null}

      {/* Scan warnings — a quiet note, never a heavy banner. */}
      {snapshot.warnings.length > 0 ? (
        <footer
          className={`mt-5 rounded-xl px-4 py-3 ${PANEL_SHADOW}`}
          style={{ background: PANEL_BG }}
        >
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            scan warnings ({snapshot.warnings.length})
          </div>
          <ul className="space-y-1">
            {snapshot.warnings.map((w, i) => (
              <li
                key={i}
                className="flex gap-2 font-mono text-[11px] leading-snug text-studio-ink-muted"
              >
                <span className="select-none text-studio-ink-faint">—</span>
                <span className="min-w-0">{w}</span>
              </li>
            ))}
          </ul>
        </footer>
      ) : null}
    </section>
  );
}

/* ── Filter control — segmented, app-calm. "recent" hides the clean tray. ── */

function FilterControl({
  filter,
  onFilter,
}: {
  filter: FilterMode;
  onFilter: (m: FilterMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter repos"
      className="flex items-center gap-0.5 rounded-[7px] bg-studio-canvas-alt p-0.5 text-[11px]"
    >
      {(["recent", "all"] as FilterMode[]).map((f) => {
        const on = f === filter;
        return (
          <button
            key={f}
            type="button"
            onClick={() => onFilter(f)}
            aria-pressed={on}
            className={[
              "rounded-[5px] px-2.5 py-1 capitalize transition-colors duration-75",
              on
                ? "bg-studio-surface text-studio-ink"
                : "text-studio-ink-faint hover:text-studio-ink-muted",
            ].join(" ")}
          >
            {f}
          </button>
        );
      })}
    </div>
  );
}

/* ── Repo entry: one repo inside the unified panel ─────────────────────────
 * A single-worktree repo (the common case) is ONE compact line: repo · branch ·
 * status · agents · ago. A multi-worktree project shows a quiet sub-head (name ·
 * path · rollup) and its active worktrees as indented sub-rows, with the clean
 * ones folded into a "+N clean" note. Severity dots align down a single rail. */

function RepoEntry({
  project,
  generatedAt,
  onIgnore,
}: {
  project: RepoWatchProject;
  generatedAt: number;
  onIgnore: () => void;
}) {
  const going = [...project.worktrees].filter(hasActivity).sort(worktreeOrder);
  const quietCount = project.worktrees.length - going.length;
  const multi = project.worktrees.length > 1;
  const panelCls = `overflow-hidden rounded-xl ${PANEL_SHADOW}`;

  // Single-worktree repo → a compact one-line card. Repo name leads (bold),
  // branch rides along muted; the whole line reads left-to-right, no empty middle.
  if (!multi) {
    const wt = going[0] ?? project.worktrees[0];
    return (
      <div className={panelCls} style={{ background: PANEL_BG }}>
        <EntryRow
          wt={wt}
          generatedAt={generatedAt}
          primary={project.name}
          secondary={branchLabel(wt)}
          onIgnore={onIgnore}
        />
      </div>
    );
  }

  // Multi-worktree project → a taller card grouping its worktrees.
  return (
    <div className={`${panelCls} py-1`} style={{ background: PANEL_BG }}>
      <RepoSubhead project={project} onIgnore={onIgnore} />
      {going.map((wt) => (
        <EntryRow
          key={wt.id}
          wt={wt}
          generatedAt={generatedAt}
          primary={branchLabel(wt)}
          indent
        />
      ))}
      {quietCount > 0 ? (
        <div className="py-1 pl-[52px] pr-4 text-[11px] text-studio-ink-faint">
          + {quietCount} clean {quietCount === 1 ? "worktree" : "worktrees"}
        </div>
      ) : null}
    </div>
  );
}

/* Quiet sub-head for a multi-worktree project: name + path + a calm rollup,
 * carrying the repo's overall severity dot so it aligns with single-repo rows. */
function RepoSubhead({
  project,
  onIgnore,
}: {
  project: RepoWatchProject;
  onIgnore: () => void;
}) {
  const total = project.worktrees.length;
  const conflicts = project.stats.conflictedWorktrees;
  const dot = SEV_DOT[project.attention];
  return (
    <div className="group/row relative flex items-baseline gap-2.5 px-4 pb-0.5 pt-2">
      <span className="flex h-5 w-3 shrink-0 translate-y-1 items-center justify-center">
        <span
          aria-hidden
          className="rounded-full"
          style={{ height: `${dot.size}px`, width: `${dot.size}px`, background: dot.color }}
        />
      </span>
      <span className="shrink-0 text-[12.5px] font-semibold leading-5 text-studio-ink">
        {project.name}
      </span>
      <span className="min-w-0 truncate font-mono text-[11px] text-studio-ink-faint">
        {shortPath(project.root, 3)}
      </span>
      <span className="ml-auto flex shrink-0 items-baseline gap-3 text-[11px] tabular-nums text-studio-ink-faint">
        {conflicts > 0 ? (
          <span style={{ color: "var(--status-error-fg)" }}>
            {conflicts} conflict{conflicts > 1 ? "s" : ""}
          </span>
        ) : null}
        <span>{total} worktrees</span>
      </span>
      <HoverIgnore onIgnore={onIgnore} />
    </div>
  );
}

/* A hover-revealed "ignore" pinned to the row's right edge — out of the content
 * flow so it never disturbs the line, present on every repo-level row. */
function HoverIgnore({ onIgnore }: { onIgnore: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onIgnore();
      }}
      title="Ignore this repo — hide it from the list"
      aria-label="Ignore this repo"
      className="absolute right-3 top-1.5 z-10 rounded-[4px] px-1 text-[11px] text-studio-ink-faint opacity-0 transition-opacity hover:text-studio-ink-muted group-hover/row:opacity-100"
      style={{ background: PANEL_BG }}
    >
      ignore
    </button>
  );
}

/* Branch identity for a worktree. Detached HEAD reads as jargon, so show the
 * short commit it's parked on; the "no branch" marker carries the meaning. */
function branchLabel(wt: RepoWatchWorktree): string {
  const b = wt.branch;
  if (b.detached) return b.head ? b.head.slice(0, 7) : "no branch";
  return b.name ?? wt.name;
}

/* ── Entry row: one compact line for a repo or a worktree ──────────────────
 * dot · primary (bold) · secondary (muted) · markers · what-changed · diff ·
 * ahead/behind · agents · ago — all flowing left-to-right in reading order so a
 * calm row never strands metadata across an empty middle. A faint "why" line
 * follows for critical/attention rows; the file list expands on click. */

function EntryRow({
  wt,
  generatedAt,
  primary,
  secondary,
  indent,
  onIgnore,
}: {
  wt: RepoWatchWorktree;
  generatedAt: number;
  primary: string;
  secondary?: string;
  indent?: boolean;
  onIgnore?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const b = wt.branch;
  const av = ATTENTION[wt.attention];
  const dot = SEV_DOT[wt.attention];

  const expandable = wt.status.files.length > 0 || wt.error != null;
  const isCritical = wt.attention === "critical";
  const reason =
    isCritical || wt.attention === "attention"
      ? cleanReason(wt.attentionReasons[0] ?? "")
      : "";
  const branchTip = b.upstream
    ? `${secondary ?? primary} → ${b.upstream}`
    : secondary ?? primary;

  return (
    <div className="group/row relative">
      <div
        className={[
          "flex items-start gap-2.5 py-2 pr-4 transition-colors duration-75",
          indent ? "pl-[36px]" : "pl-4",
          expandable ? "cursor-pointer" : "",
          expandable && !isCritical ? "hover:bg-studio-canvas-alt/50" : "",
        ].join(" ")}
        // A conflict tints its row a faint red — tone, not a rule.
        style={
          isCritical
            ? {
                background:
                  "color-mix(in oklab, var(--status-error-bg) 16%, transparent)",
              }
            : undefined
        }
        onClick={expandable ? () => setOpen((o) => !o) : undefined}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onKeyDown={
          expandable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((o) => !o);
                }
              }
            : undefined
        }
      >
        {/* Severity dot — fixed box so the rail stays straight down the panel. */}
        <span
          className="flex h-5 w-3 shrink-0 items-center justify-center"
          title={`${av.label} — ${av.gloss}`}
        >
          <span
            aria-hidden
            className="rounded-full"
            style={{
              height: `${dot.size}px`,
              width: `${dot.size}px`,
              background: dot.color,
            }}
          />
          <span className="sr-only">{av.label}</span>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            {/* Identity — primary (bold) + branch (muted) + markers. */}
            <span className="flex min-w-0 items-baseline gap-2" title={branchTip}>
              <span className="truncate text-[12.5px] font-semibold leading-5 text-studio-ink">
                {primary}
              </span>
              {secondary ? (
                <span className="truncate text-[12px] leading-5 text-studio-ink-muted">
                  {secondary}
                </span>
              ) : null}
              {b.detached ? <Marker>no branch</Marker> : null}
              {wt.isBare ? <Marker>bare</Marker> : null}
              {!b.detached && !b.upstream ? (
                <Marker title="no upstream configured">local</Marker>
              ) : null}
            </span>

            {/* Status — flowing left, never pinned to the far edge. */}
            <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[11px] text-studio-ink-muted">
              <ChangeSummary wt={wt} />
              {b.ahead > 0 ? <Meta>{b.ahead} ahead</Meta> : null}
              {b.behind > 0 ? <Meta>{b.behind} behind</Meta> : null}
              <AgentChips wt={wt} />
              <span className="font-mono tabular-nums text-studio-ink-faint">
                {agoFromMillis(wt.lastCommitAt, generatedAt)}
              </span>
            </span>

            {expandable ? (
              <span
                aria-hidden
                className={[
                  "select-none text-[9px] leading-5 text-studio-ink-faint transition-transform duration-100",
                  open ? "rotate-90" : "",
                ].join(" ")}
              >
                ▶
              </span>
            ) : null}
          </div>

          {reason ? (
            <div className="mt-0.5 truncate text-[11px] text-studio-ink-faint">
              {reason}
            </div>
          ) : null}
        </div>
      </div>

      {onIgnore ? <HoverIgnore onIgnore={onIgnore} /> : null}
      {open ? <ExpandedDetail wt={wt} /> : null}
    </div>
  );
}

/* ── Change summary — the headline of what's uncommitted, in plain words ───
 * "N changed" carries the read; conflicts earn red; the diff size rides along
 * in mono so the magnitude of the work is legible at a glance. */

function ChangeSummary({ wt }: { wt: RepoWatchWorktree }) {
  const s = wt.status;
  const staged = parseShortstat(wt.diff.stagedShortstat);
  const unstaged = parseShortstat(wt.diff.unstagedShortstat);
  const ins = (staged?.ins ?? 0) + (unstaged?.ins ?? 0);
  const del = (staged?.del ?? 0) + (unstaged?.del ?? 0);

  if (s.clean) {
    return <span className="text-studio-ink-faint">no changes</span>;
  }

  return (
    <>
      {s.changedFiles > 0 ? <Meta>{s.changedFiles} changed</Meta> : null}
      {ins > 0 || del > 0 ? (
        <span
          className="shrink-0 font-mono tabular-nums"
          title={[wt.diff.stagedShortstat, wt.diff.unstagedShortstat]
            .filter(Boolean)
            .join("  ·  ")}
        >
          {ins > 0 ? (
            <span className="text-studio-ink">+{ins.toLocaleString()}</span>
          ) : null}
          {del > 0 ? (
            <span className="ml-1.5 text-studio-ink-muted">
              −{del.toLocaleString()}
            </span>
          ) : null}
        </span>
      ) : null}
      {s.conflicts > 0 ? (
        <span
          className="shrink-0 tabular-nums"
          style={{ color: "var(--status-error-fg)" }}
        >
          {s.conflicts} conflict{s.conflicts > 1 ? "s" : ""}
        </span>
      ) : null}
    </>
  );
}

/* One muted metadata token on line 2. */
function Meta({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 tabular-nums">{children}</span>;
}

/* ── Agents — live ones lifted, the rest collapsed ─────────────────────────
 * A worktree accumulates dozens of agents over its life; only the live ones are
 * signal. Show live first with a single small accent dot (green stays scarce),
 * cap the inline handles, and collapse the long tail into "+N". */

const MAX_AGENT_CHIPS = 2;

function AgentChips({ wt }: { wt: RepoWatchWorktree }) {
  const { agents, sessions } = wt;
  if (agents.length === 0) return null;

  const seen = new Set<string>();
  const unique: typeof agents = [];
  for (const a of [...agents].sort(
    (x, y) => Number(agentLive(y)) - Number(agentLive(x)),
  )) {
    const h = agentHandle(a);
    if (seen.has(h)) continue;
    seen.add(h);
    unique.push(a);
  }
  const shown = unique.slice(0, MAX_AGENT_CHIPS);
  const overflow = unique.length - shown.length;
  const sessionTip =
    sessions.length > 0
      ? `\n${sessions.length} session${sessions.length > 1 ? "s" : ""}`
      : "";

  return (
    <span
      className="flex min-w-0 items-center gap-2 overflow-hidden text-[11px] leading-5"
      title={
        unique.map((a) => `${agentHandle(a)} (${a.state ?? "unknown"})`).join("\n") +
        sessionTip
      }
    >
      {shown.map((a) => (
        <span
          key={a.id}
          className="inline-flex min-w-0 items-center gap-1 text-studio-ink-muted"
        >
          {agentLive(a) ? (
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: "var(--scout-accent)" }}
            />
          ) : null}
          <span className="truncate">{agentHandle(a)}</span>
        </span>
      ))}
      {overflow > 0 ? (
        <span className="shrink-0 text-studio-ink-faint">+{overflow}</span>
      ) : null}
    </span>
  );
}

/* ── Quiet tray — clean/idle or ignored repos, one calm row each ───────────
 * Low-value to show prominently, but findable. A faint dot, the name, the path,
 * a one-word state, and a hover affordance to ignore / unignore. */

function QuietSection({
  label,
  projects,
  onIgnore,
  ignored,
}: {
  label: string;
  projects: RepoWatchProject[];
  onIgnore: (id: string) => void;
  ignored?: boolean;
}) {
  return (
    <div className="mt-5">
      <div className="mb-2 pl-0.5 text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div
        className="overflow-hidden rounded-xl py-1"
        style={{ background: PANEL_BG }}
      >
        {projects.map((project) => {
          const n = project.worktrees.length;
          return (
            <div
              key={project.id}
              className="group/q flex items-center gap-2.5 px-4 py-2"
            >
              <span
                aria-hidden
                className="h-1 w-1 shrink-0 rounded-full"
                style={{ background: "var(--studio-ink-faint)" }}
              />
              <span className="shrink-0 text-[12px] text-studio-ink-muted">
                {project.name}
              </span>
              <span className="min-w-0 truncate font-mono text-[11px] text-studio-ink-faint">
                {shortPath(project.root, 3)}
              </span>
              <span className="ml-auto shrink-0 text-[11px] text-studio-ink-faint">
                {ignored ? "ignored" : n > 1 ? `${n} worktrees · clean` : "clean"}
              </span>
              <button
                type="button"
                onClick={() => onIgnore(project.id)}
                className="shrink-0 text-[11px] text-studio-ink-faint opacity-0 transition-opacity hover:text-studio-ink-muted group-hover/q:opacity-100"
              >
                {ignored ? "unignore" : "ignore"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Expanded detail — the changed-file preview + reasons / error ──────────── */

function ExpandedDetail({ wt }: { wt: RepoWatchWorktree }) {
  return (
    <div className="bg-studio-canvas/40 px-4 pb-3 pt-2.5 pl-[39px]">
      {/* Reasons — why this row carries its attention level. */}
      {wt.attentionReasons.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            why
          </span>
          {wt.attentionReasons.map((r, i) => (
            <span
              key={i}
              className="rounded-[4px] bg-studio-canvas-alt px-1.5 py-px text-[10px] text-studio-ink-muted"
            >
              {cleanReason(r)}
            </span>
          ))}
        </div>
      ) : null}

      {/* Scan error — quiet inline note, never a heavy full-width banner. */}
      {wt.error ? (
        <div className="mb-2 flex items-start gap-2">
          <span
            className="mt-px shrink-0 text-[10px] font-semibold uppercase tracking-eyebrow"
            style={{ color: "var(--status-error-fg)" }}
          >
            error
          </span>
          <span className="min-w-0 break-words font-mono text-[11px] leading-snug text-studio-ink-muted">
            {wt.error}
          </span>
        </div>
      ) : null}

      {/* Changed-file preview — a small list, status-toned. */}
      {wt.status.files.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
          {wt.status.files.map((f) => {
            const tone = fileStatusTone(f.status);
            const conflict = isConflict(f.status);
            return (
              <div
                key={f.path}
                className="flex items-center gap-2 font-mono text-[11px]"
              >
                <span
                  className={[
                    "grid h-[15px] w-[18px] shrink-0 place-items-center rounded-[3px] text-[9px] font-semibold leading-none",
                    conflict ? "ring-1" : "",
                  ].join(" ")}
                  style={{
                    color: toneFg(tone),
                    background: toneBg(tone),
                    ...(conflict
                      ? { ["--tw-ring-color" as string]: toneFg(tone) }
                      : null),
                  }}
                  title={f.status}
                >
                  {fileStatusBadge(f.status)}
                </span>
                <span className="truncate text-studio-ink-muted" title={f.path}>
                  {shortPath(f.path, 4)}
                </span>
              </div>
            );
          })}
        </div>
      ) : !wt.error ? (
        <div className="text-[11px] text-studio-ink-faint">no changed files</div>
      ) : null}
    </div>
  );
}

/* ── Small presentational atoms ────────────────────────────────────────── */

/* Overview strip — the calm, app-native "everything you've got going on" line.
 * The whole inventory (repos · worktrees) sits beside how much is actually live
 * (active · changed · conflicts · live). Numbers carry the contrast, labels stay
 * quiet, and only a real conflict earns colour. */
function SummaryStrip({
  repos,
  worktrees,
  active,
  changed,
  conflicts,
  live,
}: {
  repos: number;
  worktrees: number;
  active: number;
  changed: number;
  conflicts: number;
  live: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-studio-ink-muted">
      <Stat value={repos} label="repos" />
      <Stat value={worktrees} label="worktrees" />
      <Sep />
      <Stat value={active} label="active" />
      <Stat value={changed} label="changed" />
      {conflicts > 0 ? (
        <Stat value={conflicts} label="conflicts" valueColor={ATTENTION.critical.fg} />
      ) : null}
      {live > 0 ? <Stat value={live} label="live" /> : null}
    </div>
  );
}

/* One "value label" pair in the overview line. The number reads (ink, medium);
 * the label stays faint. Colour is reserved — only a real conflict passes one. */
function Stat({
  value,
  label,
  valueColor,
}: {
  value: number;
  label: string;
  valueColor?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className="font-mono font-medium tabular-nums text-studio-ink"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
      <span className="text-studio-ink-faint">{label}</span>
    </span>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-studio-ink-faint/40">
      ·
    </span>
  );
}

/* Inline branch/state marker — bare faint uppercase, no fill. */
function Marker({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      className="shrink-0 text-[10px] font-semibold uppercase leading-5 tracking-eyebrow text-studio-ink-faint"
      title={title}
    >
      {children}
    </span>
  );
}

/* ── Pure helpers ──────────────────────────────────────────────────── */

interface Shortstat {
  files: number;
  ins: number;
  del: number;
}

/** Soften backend reason phrasing for display. The classifier emits strings
 *  like "Dirty main" / "Dirty master"; we don't surface the word "dirty", so
 *  rewrite those to plain English and downcase any stray "dirty" elsewhere. */
function cleanReason(reason: string): string {
  if (!reason) return "";
  const onBranch = reason.match(/^dirty\s+(.+)$/i);
  if (onBranch) return `Uncommitted changes on ${onBranch[1]}`;
  return reason.replace(/\bdirty\b/gi, "uncommitted");
}

/** Parse `git diff --shortstat` text into numbers. Tolerant of any of the
 *  three clauses being absent (e.g. "4 files changed, 412 insertions(+)"). */
function parseShortstat(text: string | null): Shortstat | null {
  if (!text) return null;
  const files = /(\d+)\s+files?\s+changed/.exec(text);
  const ins = /(\d+)\s+insertions?\(\+\)/.exec(text);
  const del = /(\d+)\s+deletions?\(-\)/.exec(text);
  if (!files && !ins && !del) return null;
  return {
    files: files ? Number(files[1]) : 0,
    ins: ins ? Number(ins[1]) : 0,
    del: del ? Number(del[1]) : 0,
  };
}
