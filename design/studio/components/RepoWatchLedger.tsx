"use client";

/**
 * Repo Watch — Dense Ledger treatment (SCO-061).
 *
 * The "ssh into the machine" maximal-density read. One severity-sorted
 * ledger of every worktree, grouped under thin project header rows. Each
 * worktree is ONE scannable line whose columns align across the whole
 * table: attention glyph · name · branch (+ahead/behind) · dirty chips
 * (staged/unstaged/untracked/conflicts) · diff shortstat · attached agent
 * handles (live ones lifted) · last-commit ago. A top totals strip and a
 * legend anchor the read; conflicts are made unmistakable.
 *
 * Calm, not loud: the accent is a signal (live agents, active rank), tone
 * vars carry severity, hairline token dividers do all the partitioning.
 * The single interaction is an optional per-row expand that drops the
 * porcelain file list — every other field is visible without a click.
 */

import { useState } from "react";
import type {
  RepoWatchSnapshot,
  RepoWatchWorktree,
  RepoWatchProject,
  RepoWatchAttentionLevel,
} from "@/lib/repo-watch/types";
import {
  ATTENTION,
  ATTENTION_ORDER,
  aheadBehind,
  pathLeaf,
  shortPath,
  agoFromMillis,
  fileStatusTone,
  fileStatusBadge,
  isConflict,
  agentLive,
  agentHandle,
  agentLabel,
  toneFg,
  toneBg,
} from "@/lib/repo-watch/ui";

/* ── Shared column geometry ────────────────────────────────────────────
 * One grid template drives the project header rows AND every worktree
 * row, so the columns line up vertically down the entire ledger — the
 * thing that makes a dense table feel engineered rather than stacked.
 *
 *   glyph · name · branch · dirty-chips · diff · agents · ago
 */
const GRID =
  "grid-cols-[14px_minmax(170px,1.15fr)_minmax(190px,1.5fr)_136px_minmax(150px,1fr)_minmax(120px,0.9fr)_46px]";

export function RepoWatchLedger({ snapshot }: { snapshot: RepoWatchSnapshot }) {
  const { totals } = snapshot;

  // Stable severity ordering for the project blocks: worst-first by the
  // project's own rollup, ties broken by name so the read never shuffles.
  const projects = [...snapshot.projects].sort((a, b) => {
    const r = ATTENTION[a.attention].rank - ATTENTION[b.attention].rank;
    return r !== 0 ? r : a.name.localeCompare(b.name);
  });

  // Per-level worktree counts → drives the distribution bar + its legend.
  // Gated to levels actually present so we never key a tone the table
  // doesn't use.
  const levelCounts = {} as Record<RepoWatchAttentionLevel, number>;
  for (const p of snapshot.projects)
    for (const wt of p.worktrees)
      levelCounts[wt.attention] = (levelCounts[wt.attention] ?? 0) + 1;
  const dist = ATTENTION_ORDER.filter((l) => (levelCounts[l] ?? 0) > 0).map(
    (l) => ({ level: l, count: levelCounts[l] }),
  );

  return (
    <section className="font-mono text-studio-ink">
      {/* ── Hero + totals strip ───────────────────────────────────── */}
      <header className="mb-5">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              · repo watch · state of repos
            </div>
            <h1 className="mt-1 font-display text-[24px] font-medium leading-none tracking-tight text-studio-ink">
              Working tree ledger
            </h1>
          </div>
          <div className="shrink-0 text-right font-mono text-[9.5px] leading-tight text-studio-ink-faint">
            <div className="uppercase tracking-eyebrow">snapshot</div>
            <div className="mt-0.5 tabular-nums text-studio-ink-muted">
              {fmtClock(snapshot.generatedAt)}
            </div>
          </div>
        </div>

        {/* Totals — the rollup the operator reads first. Conflicts and
            attention get tone; the rest stay neutral counts. A stacked
            distribution bar underneath gives the severity mix at a glance,
            before the eye reaches the table. */}
        <div className="mt-3 rounded-md border border-studio-edge bg-studio-surface px-3.5 py-2.5">
          <div className="flex flex-wrap items-stretch gap-x-5 gap-y-2">
            <Total label="projects" value={totals.projects} />
            <Total label="worktrees" value={totals.worktrees} />
            <Divider />
            <Total label="dirty" value={totals.dirtyWorktrees} tone="warn" />
            <Total
              label="conflicts"
              value={totals.conflictedWorktrees}
              tone={totals.conflictedWorktrees > 0 ? "error" : undefined}
              emphatic={totals.conflictedWorktrees > 0}
            />
            <Total
              label="attention"
              value={totals.attentionWorktrees}
              tone="warn"
            />
            <Divider />
            <Total label="agents" value={totals.attachedAgents} tone="accent" />
            <Total label="sessions" value={totals.attachedSessions} />
          </div>

          <DistributionBar dist={dist} total={totals.worktrees} />
        </div>
      </header>

      {/* ── Table — header rail + body share GRID so all seven columns
            align down the whole ledger. The scroll wrapper lets that dense
            table scroll rather than compress on a narrow native panel,
            instead of crushing the min column widths. ─────────────────── */}
      <div className="overflow-x-auto">
       <div className="min-w-[860px]">
      {/* Column header rail */}
      <div
        className={[
          "grid items-end gap-x-3 border-b border-studio-edge-strong px-2 pb-1.5",
          GRID,
        ].join(" ")}
      >
        <span aria-hidden />
        <ColHead>worktree</ColHead>
        <ColHead>branch</ColHead>
        <ColHead className="justify-self-start">
          <span title="staged / unstaged / untracked / conflicts">
            S·U·?·X
          </span>
        </ColHead>
        <ColHead>diff</ColHead>
        <ColHead>agents</ColHead>
        <ColHead className="justify-self-end">ago</ColHead>
      </div>

      {/* ── Ledger body ───────────────────────────────────────────── */}
      <div className="rounded-b-md border border-t-0 border-studio-edge bg-studio-canvas-alt">
        {projects.map((project, pi) => (
          <ProjectBlock
            key={project.id}
            project={project}
            generatedAt={snapshot.generatedAt}
            first={pi === 0}
          />
        ))}
      </div>
       </div>
      </div>

      {/* ── Snapshot warnings ─────────────────────────────────────── */}
      {snapshot.warnings.length > 0 ? (
        <footer className="mt-4 rounded-md border border-studio-edge bg-studio-surface px-3.5 py-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className="text-[10px] leading-none"
              style={{ color: ATTENTION.attention.fg }}
            >
              {ATTENTION.attention.glyph}
            </span>
            <span className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              scan warnings · {snapshot.warnings.length}
            </span>
          </div>
          <ul className="space-y-1">
            {snapshot.warnings.map((w, i) => (
              <li
                key={i}
                className="flex gap-2 font-mono text-[10.5px] leading-snug text-studio-ink-muted"
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

/* ── Project block: thin header row + its worktrees ────────────────── */

function ProjectBlock({
  project,
  generatedAt,
  first,
}: {
  project: RepoWatchProject;
  generatedAt: number;
  first: boolean;
}) {
  // Severity-sort worktrees inside the project; ties → main first, then
  // name. Main floats up within a rank so the canonical tree leads.
  const worktrees = [...project.worktrees].sort((a, b) => {
    const r = ATTENTION[a.attention].rank - ATTENTION[b.attention].rank;
    if (r !== 0) return r;
    if (a.branch.isMain !== b.branch.isMain) return a.branch.isMain ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const av = ATTENTION[project.attention];
  const s = project.stats;

  return (
    <div className={first ? "" : "border-t border-studio-edge-strong"}>
      {/* Project header rail — spans the full width, sits a half-step
          above the data rows on the deepest canvas tone. */}
      <div className="flex items-center gap-2.5 bg-studio-canvas px-2 py-1.5">
        <span
          aria-hidden
          className="text-[10px] leading-none"
          style={{ color: av.fg }}
          title={av.gloss}
        >
          {av.glyph}
        </span>
        <span className="font-sans text-[12.5px] font-semibold tracking-tight text-studio-ink">
          {project.name}
        </span>
        <span className="truncate font-mono text-[10px] text-studio-ink-faint">
          {shortPath(project.root, 3)}
        </span>

        {/* Per-project mini rollup — calm counts, tone only where it
            earns it (conflicts / dirty / agents). */}
        <span className="ml-auto flex items-center gap-2.5 font-mono text-[9.5px] tabular-nums">
          <MiniStat label="wt" value={s.worktrees} />
          {s.dirtyWorktrees > 0 ? (
            <MiniStat label="dirty" value={s.dirtyWorktrees} tone="warn" />
          ) : null}
          {s.conflictedWorktrees > 0 ? (
            <MiniStat
              label="conflict"
              value={s.conflictedWorktrees}
              tone="error"
            />
          ) : null}
          {s.attachedAgents > 0 ? (
            <MiniStat
              label="agents"
              value={s.attachedAgents}
              tone="accent"
            />
          ) : null}
        </span>
      </div>

      {/* Worktree rows */}
      <div className="divide-y divide-studio-edge">
        {worktrees.map((wt) => (
          <WorktreeRow key={wt.id} wt={wt} generatedAt={generatedAt} />
        ))}
      </div>
    </div>
  );
}

/* ── Worktree row: the dense, single-line read ─────────────────────── */

function WorktreeRow({
  wt,
  generatedAt,
}: {
  wt: RepoWatchWorktree;
  generatedAt: number;
}) {
  const [open, setOpen] = useState(false);
  const av = ATTENTION[wt.attention];
  const isCritical = wt.attention === "critical";
  const conflicts = wt.status.conflicts;
  const hasFiles = wt.status.files.length > 0;
  const errored = wt.error != null;

  // The expand affordance only exists when there's something to reveal:
  // a porcelain file list or an error/reason worth dropping.
  const expandable = hasFiles || errored || wt.attentionReasons.length > 0;

  return (
    <div
      className={[
        "group relative",
        // Critical rows get a solid tone rail on the left so a conflict
        // is unmistakable even in peripheral vision.
        isCritical ? "shadow-[inset_2px_0_0_var(--status-error-fg)]" : "",
      ].join(" ")}
      style={
        isCritical
          ? {
              background:
                "color-mix(in oklab, var(--status-error-bg) 22%, transparent)",
            }
          : undefined
      }
    >
      <div
        className={[
          "grid items-center gap-x-3 px-2 py-[7px] transition-colors duration-75",
          "hover:bg-[color-mix(in_oklab,var(--studio-surface)_70%,transparent)]",
          expandable ? "cursor-pointer" : "",
          GRID,
        ].join(" ")}
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
        {/* 1 — attention glyph (color+shape cue, with an sr-only level
            label so severity isn't conveyed by color alone) */}
        <span
          className="text-[11px] leading-none"
          style={{ color: av.fg }}
          title={`${av.label} — ${av.gloss}`}
        >
          <span aria-hidden>{av.glyph}</span>
          <span className="sr-only">{av.label}</span>
        </span>

        {/* 2 — worktree name (+ main / bare / detached marker) */}
        <span className="flex min-w-0 items-center gap-1.5">
          {expandable ? (
            <span
              aria-hidden
              className={[
                "select-none text-[8px] leading-none text-studio-ink-faint transition-transform duration-100",
                open ? "rotate-90" : "",
              ].join(" ")}
            >
              ▶
            </span>
          ) : (
            <span aria-hidden className="w-[8px]" />
          )}
          <span className="truncate text-[11px] text-studio-ink">
            {pathLeaf(wt.path)}
          </span>
          {wt.branch.isMain ? <Marker tone="warn">main</Marker> : null}
          {wt.branch.detached ? <Marker tone="error">detached</Marker> : null}
          {wt.isBare ? <Marker tone="neutral">bare</Marker> : null}
        </span>

        {/* 3 — branch + ahead/behind + upstream cue */}
        <BranchCell wt={wt} />

        {/* 4 — dirty chips: staged · unstaged · untracked · conflicts */}
        <DirtyChips wt={wt} />

        {/* 5 — diff shortstat (staged + unstaged) */}
        <DiffCell wt={wt} />

        {/* 6 — attached agents (live lifted) + session count */}
        <AgentsCell wt={wt} />

        {/* 7 — last-commit ago */}
        <span className="justify-self-end text-[10px] tabular-nums text-studio-ink-faint">
          {agoFromMillis(wt.lastCommitAt, generatedAt)}
        </span>
      </div>

      {/* ── Expanded drawer: porcelain file list + reasons / error ── */}
      {open ? (
        <ExpandedDetail wt={wt} />
      ) : conflicts > 0 ? (
        // Even collapsed, a conflict spells out which files are stuck —
        // a conflict should never need a click to be understood.
        <ConflictHint wt={wt} />
      ) : wt.attention === "critical" || wt.attention === "attention" ? (
        // The top two severities also surface their reason inline, so the
        // "why" for a dirty main / diverged branch reads without a click.
        // Active + quiet rows stay clean to protect the table's calm.
        <ReasonHint wt={wt} />
      ) : null}
    </div>
  );
}

/* ── Branch cell ───────────────────────────────────────────────────── */

function BranchCell({ wt }: { wt: RepoWatchWorktree }) {
  const b = wt.branch;
  const ab = aheadBehind(b.ahead, b.behind);
  const name = b.detached
    ? `(detached) ${b.head ?? ""}`.trim()
    : b.name ?? "—";

  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[10.5px]">
      <span
        className={[
          "truncate",
          b.detached ? "text-status-error-fg" : "text-studio-ink-muted",
        ].join(" ")}
        title={b.upstream ? `${name} → ${b.upstream}` : name}
      >
        {name}
      </span>

      {/* ahead/behind cue — diverged gets tone, plain sync stays faint */}
      {ab ? (
        <span
          className="shrink-0 tabular-nums"
          style={{
            color: b.diverged
              ? "var(--status-warn-fg)"
              : "var(--studio-ink-faint)",
          }}
          title={
            b.diverged
              ? `diverged ${ab} from ${b.upstream ?? "upstream"}`
              : `${ab} vs ${b.upstream ?? "upstream"}`
          }
        >
          {ab}
        </span>
      ) : null}

      {/* no-upstream marker — a real, common state worth flagging quietly */}
      {!b.detached && !b.upstream ? (
        <span
          className="shrink-0 text-[9px] uppercase tracking-eyebrow text-studio-ink-faint"
          title="no upstream configured"
        >
          local
        </span>
      ) : null}
    </span>
  );
}

/* ── Dirty summary: calm tone-colored counts ───────────────────────────
 * Plain text counts, fixed-width so the column still aligns down the whole
 * ledger. No fills, no boxes — only a real conflict is allowed to carry a
 * tinted pill, so a row stays quiet right up until it shouldn't be. */

function DirtyChips({ wt }: { wt: RepoWatchWorktree }) {
  const s = wt.status;
  if (s.clean) {
    return (
      <span className="justify-self-start text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
        clean
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2.5 text-[10px] leading-none">
      <Count n={s.staged} label="S" tone="ok" title="staged" />
      <Count n={s.unstaged} label="U" tone="warn" title="unstaged" />
      <Count n={s.untracked} label="?" tone="info" title="untracked" />
      {s.conflicts > 0 ? (
        <span
          className="inline-flex items-baseline gap-0.5 rounded-[2px] px-1 py-px text-[9px] font-semibold tabular-nums"
          style={{ color: toneFg("error"), background: toneBg("error") }}
          title={`${s.conflicts} conflicts`}
        >
          <span className="opacity-70">X</span>
          {s.conflicts}
        </span>
      ) : (
        <Count n={0} label="X" tone="error" title="conflicts" />
      )}
    </span>
  );
}

/* One porcelain count — tone-colored when present, a faint placeholder dot
 * when zero; fixed width keeps the column aligned without a box. */
function Count({
  n,
  label,
  tone,
  title,
}: {
  n: number;
  label: string;
  tone: "ok" | "warn" | "info" | "error";
  title: string;
}) {
  const active = n > 0;
  return (
    <span
      className="inline-flex w-[22px] items-baseline gap-0.5 tabular-nums"
      title={`${n} ${title}`}
      style={active ? { color: toneFg(tone) } : undefined}
    >
      <span className={active ? "opacity-55" : "text-studio-ink-faint/45"}>
        {label}
      </span>
      {active ? (
        <span className="font-semibold">{n}</span>
      ) : (
        <span className="text-studio-ink-faint/35">·</span>
      )}
    </span>
  );
}

/* ── Diff shortstat cell ───────────────────────────────────────────── */

function DiffCell({ wt }: { wt: RepoWatchWorktree }) {
  const staged = parseShortstat(wt.diff.stagedShortstat);
  const unstaged = parseShortstat(wt.diff.unstagedShortstat);

  if (!staged && !unstaged) {
    return <span className="text-[10px] text-studio-ink-faint/60">—</span>;
  }

  // Sum across staged + unstaged for the compact +/- read; the file
  // count comes from whichever stat is present.
  const ins = (staged?.ins ?? 0) + (unstaged?.ins ?? 0);
  const del = (staged?.del ?? 0) + (unstaged?.del ?? 0);
  const files = Math.max(staged?.files ?? 0, unstaged?.files ?? 0);

  return (
    <span
      className="flex items-center gap-2 text-[10px] tabular-nums"
      title={[wt.diff.stagedShortstat, wt.diff.unstagedShortstat]
        .filter(Boolean)
        .join("  ·  ")}
    >
      <span className="text-studio-ink-faint">{files}f</span>
      <span className="flex items-center gap-1.5">
        {ins > 0 ? (
          <span style={{ color: "var(--status-ok-fg)" }}>+{ins}</span>
        ) : null}
        {del > 0 ? (
          <span style={{ color: "var(--status-error-fg)" }}>−{del}</span>
        ) : null}
      </span>
    </span>
  );
}

/* ── Agents cell — attached handles, live ones lifted ──────────────── */

function AgentsCell({ wt }: { wt: RepoWatchWorktree }) {
  const { agents, sessions } = wt;
  if (agents.length === 0 && sessions.length === 0) {
    return <span className="text-[10px] text-studio-ink-faint/60">—</span>;
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {agents.map((a) => {
          const live = agentLive(a);
          return (
            <span
              key={a.id}
              className={[
                "inline-flex items-center gap-1 text-[10px] leading-none",
                live ? "font-semibold" : "",
              ].join(" ")}
              style={{
                color: live ? "var(--scout-accent)" : "var(--studio-ink-faint)",
              }}
              title={`${agentLabel(a)}${a.harness ? ` · ${a.harness}` : ""} (${a.state ?? "unknown"})`}
            >
              {live ? (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--scout-accent)" }}
                />
              ) : null}
              {agentHandle(a)}
            </span>
          );
        })}
      </span>

      {/* Session ref count — secondary, only when there are sessions. */}
      {sessions.length > 0 ? (
        <span
          className="shrink-0 text-[9px] uppercase tracking-eyebrow text-studio-ink-faint"
          title={sessions.map((s) => `${s.harness ?? "session"} · ${s.id}`).join("  ·  ")}
        >
          {sessions.length}s
        </span>
      ) : null}
    </span>
  );
}

/* ── Collapsed conflict hint — spells out stuck files inline ───────── */

function ConflictHint({ wt }: { wt: RepoWatchWorktree }) {
  const conflicted = wt.status.files.filter((f) => isConflict(f.status));
  if (conflicted.length === 0) return null;
  return (
    <div className="flex items-center gap-2 px-2 pb-1.5 pl-[34px] text-[10px]">
      <span
        className="shrink-0 rounded-[2px] px-1 py-px text-[9px] font-semibold uppercase tracking-eyebrow"
        style={{
          color: "var(--status-error-fg)",
          background: "var(--status-error-bg)",
        }}
      >
        unmerged
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-studio-ink-muted">
        {conflicted.map((f) => (
          <span key={f.path} className="truncate" title={f.path}>
            {shortPath(f.path, 2)}
          </span>
        ))}
      </span>
    </div>
  );
}

/* ── Collapsed reason hint — the top "why" for critical/attention rows ─
 * The two highest severities earn their reason inline (dirty main, diverged,
 * status errored) so the operator never has to expand to learn why a row is
 * flagged. Active + quiet rows stay clean to keep the table calm. */

function ReasonHint({ wt }: { wt: RepoWatchWorktree }) {
  const av = ATTENTION[wt.attention];
  const reason = wt.attentionReasons[0];
  if (!reason) return null;
  const more = wt.attentionReasons.length - 1;
  return (
    <div className="flex items-center gap-2 px-2 pb-1.5 pl-[34px] text-[10px]">
      <span
        aria-hidden
        className="h-1 w-1 shrink-0 rounded-full"
        style={{ background: av.fg }}
      />
      <span
        className="min-w-0 truncate font-sans text-[10.5px] text-studio-ink-muted"
        title={wt.attentionReasons.join(" · ")}
      >
        {reason}
        {more > 0 ? (
          <span className="ml-1 font-mono text-[9px] text-studio-ink-faint">
            +{more}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/* ── Expanded detail drawer ────────────────────────────────────────── */

function ExpandedDetail({ wt }: { wt: RepoWatchWorktree }) {
  return (
    <div className="border-t border-studio-edge bg-studio-canvas px-2 pb-2.5 pl-[34px] pt-2">
      {/* Reasons — why this row carries its attention level. */}
      {wt.attentionReasons.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            why
          </span>
          {wt.attentionReasons.map((r, i) => (
            <span
              key={i}
              className="rounded-[2px] bg-studio-canvas-alt px-1.5 py-px text-[9.5px] text-studio-ink-muted"
            >
              {r}
            </span>
          ))}
        </div>
      ) : null}

      {/* Scan error — the unknown / errored case. */}
      {wt.error ? (
        <div
          className="mb-2 flex items-start gap-2 rounded-[3px] px-2 py-1.5"
          style={{ background: "var(--status-error-bg)" }}
        >
          <span
            className="mt-px shrink-0 text-[9px] font-semibold uppercase tracking-eyebrow"
            style={{ color: "var(--status-error-fg)" }}
          >
            error
          </span>
          <span className="min-w-0 break-words font-mono text-[10px] leading-snug text-studio-ink-muted">
            {wt.error}
          </span>
        </div>
      ) : null}

      {/* Porcelain file list — the small preview, status-toned. */}
      {wt.status.files.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
          {wt.status.files.map((f) => {
            const tone = fileStatusTone(f.status);
            const conflict = isConflict(f.status);
            return (
              <div
                key={f.path}
                className="flex items-center gap-2 font-mono text-[10px]"
              >
                <span
                  className={[
                    "grid h-[14px] w-[18px] shrink-0 place-items-center rounded-[2px] text-[9px] font-semibold leading-none",
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
        <div className="text-[10px] text-studio-ink-faint">
          no changed files
        </div>
      ) : null}
    </div>
  );
}

/* ── Small presentational atoms ────────────────────────────────────── */

/* Severity distribution bar — a stacked, full-width read of the worktree
 * mix by attention level: the rollup's center of gravity. Each segment is
 * sized by share with a 4% floor so a lone critical never disappears at a
 * seam; the inline legend below doubles as the key. */
function DistributionBar({
  dist,
  total,
}: {
  dist: { level: RepoWatchAttentionLevel; count: number }[];
  total: number;
}) {
  if (total === 0 || dist.length === 0) return null;
  return (
    <div className="mt-2.5 border-t border-studio-edge pt-2.5">
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-studio-canvas"
        role="img"
        aria-label={`Worktrees by attention: ${dist
          .map((d) => `${ATTENTION[d.level].label} ${d.count}`)
          .join(", ")}`}
      >
        {dist.map(({ level, count }) => (
          <span
            key={level}
            className="h-full"
            style={{
              width: `${Math.max(4, (count / total) * 100)}%`,
              background: ATTENTION[level].fg,
            }}
            title={`${ATTENTION[level].label} · ${count}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {dist.map(({ level, count }) => (
          <span key={level} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2 w-2 rounded-[2px]"
              style={{ background: ATTENTION[level].fg }}
            />
            <span className="text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              {ATTENTION[level].label}
            </span>
            <span
              className="text-[9.5px] font-semibold tabular-nums"
              style={{ color: ATTENTION[level].fg }}
            >
              {count}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Total({
  label,
  value,
  tone,
  emphatic,
}: {
  label: string;
  value: number;
  tone?: "warn" | "error" | "accent";
  emphatic?: boolean;
}) {
  const color =
    tone === "error"
      ? "var(--status-error-fg)"
      : tone === "warn"
        ? "var(--status-warn-fg)"
        : tone === "accent"
          ? "var(--scout-accent)"
          : "var(--studio-ink)";
  // Counts of zero stay calm regardless of tone — tone is reserved for
  // "there is something here", not the column's identity.
  const live = value > 0 && tone != null;
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-[16px] font-semibold leading-none tabular-nums"
        style={{ color: live ? color : "var(--studio-ink)" }}
      >
        {value}
        {emphatic ? (
          <span
            className="ml-1 align-middle text-[10px]"
            style={{ color }}
          >
            {ATTENTION.critical.glyph}
          </span>
        ) : null}
      </span>
      <span className="text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
    </div>
  );
}

function Divider() {
  return <span className="self-stretch border-l border-studio-edge" />;
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "error" | "accent";
}) {
  const color =
    tone === "error"
      ? "var(--status-error-fg)"
      : tone === "warn"
        ? "var(--status-warn-fg)"
        : tone === "accent"
          ? "var(--scout-accent)"
          : "var(--studio-ink-faint)";
  return (
    <span className="inline-flex items-baseline gap-1">
      <span style={{ color }} className="font-semibold">
        {value}
      </span>
      <span className="uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
    </span>
  );
}

function Marker({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "warn" | "error" | "neutral";
}) {
  const fg =
    tone === "neutral" ? "var(--studio-ink-faint)" : `var(--status-${tone}-fg)`;
  const bg =
    tone === "neutral" ? "var(--status-neutral-bg)" : `var(--status-${tone}-bg)`;
  return (
    <span
      className="shrink-0 rounded-[2px] px-1 py-px text-[8.5px] font-semibold uppercase leading-none tracking-eyebrow"
      style={{ color: fg, background: bg }}
    >
      {children}
    </span>
  );
}

function ColHead({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={[
        "text-[9px] uppercase tracking-eyebrow text-studio-ink-faint",
        className,
      ].join(" ")}
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

/** Deterministic HH:MM clock from the snapshot's generatedAt (epoch ms).
 *  Uses UTC so screenshots are byte-stable regardless of host TZ. */
function fmtClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}
