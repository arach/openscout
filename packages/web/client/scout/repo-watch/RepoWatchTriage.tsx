/**
 * Repo Watch — Attention Triage board (SCO-061).
 *
 * The "what needs me now" cross-machine view. Worktrees from EVERY project are
 * flattened into one pool, then dealt left-to-right into Kanban lanes by
 * mechanical attention severity (CRITICAL · ATTENTION · ACTIVE · QUIET, with
 * UNKNOWN folded into the QUIET lane as its own band). Left-to-right is urgency;
 * the lane tones do the heavy lifting. An operator reads this once and knows
 * exactly what to open first.
 *
 * Pure presentational. Every "ago" is derived from snapshot.generatedAt — no
 * wall-clock, no randomness — so screenshots stay byte-stable.
 */

import { useState } from "react";
import type {
  RepoWatchSnapshot,
  RepoWatchWorktree,
  RepoWatchProject,
  RepoWatchAttentionLevel,
} from "./types.ts";
import {
  ATTENTION,
  aheadBehind,
  pathLeaf,
  shortPath,
  agoFromMillis,
  fileStatusTone,
  fileStatusBadge,
  agentLive,
  agentHandle,
  agentLabel,
  toneFg,
} from "./ui.ts";

/* A worktree carried alongside the project it belongs to — the flattened pool
 * loses the project nesting, so we re-attach project identity to every chip. */
interface TriageItem {
  project: RepoWatchProject;
  worktree: RepoWatchWorktree;
}

/* The visible lanes, in severity order. UNKNOWN is not a lane of its own — it
 * rides inside QUIET as a quiet, dimmed band so the board stays at a readable
 * four-column width and urgency still reads strictly left-to-right. */
const LANES: RepoWatchAttentionLevel[] = ["critical", "attention", "active", "quiet"];

export function RepoWatchTriage({ snapshot }: { snapshot: RepoWatchSnapshot }) {
  const [selected, setSelected] = useState<string | null>(null);

  // Flatten all projects → one pool of worktrees, each tagged with its project.
  const pool: TriageItem[] = snapshot.projects.flatMap((project) =>
    project.worktrees.map((worktree) => ({ project, worktree })),
  );

  // Stable within-lane ordering: most recently touched first, nulls last.
  const byRecency = (a: TriageItem, b: TriageItem) =>
    (b.worktree.lastCommitAt ?? -1) - (a.worktree.lastCommitAt ?? -1);

  const itemsFor = (level: RepoWatchAttentionLevel) =>
    pool.filter((i) => i.worktree.attention === level).sort(byRecency);

  const unknownItems = itemsFor("unknown");
  const t = snapshot.totals;

  return (
    <div className="font-sans text-studio-ink">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · repo watch · this machine
          </div>
          <h1 className="mt-1.5 font-display text-[26px] font-medium leading-none tracking-tight text-studio-ink">
            Attention triage
          </h1>
          <p className="mt-2.5 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
            Every worktree across {t.projects} projects, dealt by severity. Read
            left to right — open what&rsquo;s leftmost first.
          </p>
        </div>

        <TotalsStrip
          totals={t}
          generatedAt={snapshot.generatedAt}
          warnings={snapshot.warnings.length}
        />
      </header>

      {/* ── Board ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((level) => {
          const items = itemsFor(level);
          // The QUIET lane also carries the UNKNOWN band beneath its own chips.
          const trailing = level === "quiet" ? unknownItems : [];
          return (
            <Lane
              key={level}
              level={level}
              items={items}
              trailing={trailing}
              selected={selected}
              onSelect={setSelected}
              generatedAt={snapshot.generatedAt}
            />
          );
        })}
      </div>

      {/* ── Warnings footer ───────────────────────────────────────────── */}
      {snapshot.warnings.length > 0 ? (
        <WarningsFooter warnings={snapshot.warnings} />
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Totals — a compact, calm scoreboard. Mono, tabular, no decoration.
 * ──────────────────────────────────────────────────────────────────────── */
function TotalsStrip({
  totals,
  generatedAt,
  warnings,
}: {
  totals: RepoWatchSnapshot["totals"];
  generatedAt: number;
  warnings: number;
}) {
  const stats: { label: string; value: number; tone?: string }[] = [
    { label: "worktrees", value: totals.worktrees },
    { label: "dirty", value: totals.dirtyWorktrees, tone: "var(--status-warn-fg)" },
    {
      label: "conflicts",
      value: totals.conflictedWorktrees,
      tone: "var(--status-error-fg)",
    },
    { label: "agents", value: totals.attachedAgents, tone: "var(--scout-accent)" },
  ];
  return (
    <div className="flex shrink-0 items-stretch divide-x divide-studio-edge rounded-md border border-studio-edge bg-studio-surface">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col items-end px-3.5 py-2">
          <span
            className="font-mono text-[16px] font-medium leading-none tabular-nums"
            style={{ color: s.tone ?? "var(--studio-ink)" }}
          >
            {s.value}
          </span>
          <span className="mt-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            {s.label}
          </span>
        </div>
      ))}
      <div className="flex flex-col items-end justify-center px-3.5 py-2">
        <span className="font-mono text-[10px] tabular-nums text-studio-ink-muted">
          snapshot {fmtClock(generatedAt)}
        </span>
        <span className="mt-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {warnings > 0 ? `${warnings} warnings` : "no warnings"}
        </span>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Lane — one attention column.
 * ──────────────────────────────────────────────────────────────────────── */
function Lane({
  level,
  items,
  trailing,
  selected,
  onSelect,
  generatedAt,
}: {
  level: RepoWatchAttentionLevel;
  items: TriageItem[];
  trailing: TriageItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  generatedAt: number;
}) {
  const meta = ATTENTION[level];
  const total = items.length + trailing.length;
  const empty = total === 0;

  // Critical is the only lane that gets a live accent rail — it's the one a
  // glance must catch. Other lanes stay quiet so the accent keeps its meaning.
  const railColor = level === "critical" ? meta.fg : "var(--studio-edge)";

  return (
    <section
      className="flex flex-col overflow-hidden rounded-md border border-studio-edge bg-studio-canvas-alt"
      style={{ boxShadow: `inset 2px 0 0 ${railColor}` }}
    >
      {/* Lane header — label in tone + count badge + one-line gloss. */}
      <header className="flex items-center gap-2 border-b border-studio-edge px-3 py-2.5">
        <span
          className="grid h-4 w-4 place-items-center rounded-[3px] font-mono text-[10px] leading-none"
          style={{ color: meta.fg, background: meta.bg }}
          aria-hidden
        >
          {meta.glyph}
        </span>
        <span
          className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow"
          style={{ color: meta.fg }}
        >
          {meta.label}
        </span>
        <span
          className="ml-auto min-w-[1.5rem] rounded-[3px] px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold tabular-nums"
          style={
            empty
              ? { color: "var(--studio-ink-faint)", background: "var(--status-neutral-bg)" }
              : { color: meta.fg, background: meta.bg }
          }
        >
          {total}
        </span>
      </header>

      <div className="px-2 pb-2 pt-1.5">
        <p className="mb-2 px-1 font-sans text-[10.5px] leading-snug text-studio-ink-faint">
          {meta.gloss}
        </p>

        {empty ? (
          <EmptyLane />
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.map((item) => (
              <WorktreeChip
                key={item.worktree.id}
                item={item}
                selected={selected === item.worktree.id}
                onSelect={onSelect}
                generatedAt={generatedAt}
              />
            ))}

            {/* UNKNOWN band — folded under QUIET, visually set apart + dimmed. */}
            {trailing.length > 0 ? (
              <UnknownBand
                items={trailing}
                selected={selected}
                onSelect={onSelect}
                generatedAt={generatedAt}
              />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyLane() {
  return (
    <div className="grid place-items-center rounded-[4px] border border-dashed border-studio-edge px-3 py-7">
      <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        clear
      </span>
    </div>
  );
}

/* The UNKNOWN sub-band inside QUIET: a labeled divider, then dimmed chips. */
function UnknownBand({
  items,
  selected,
  onSelect,
  generatedAt,
}: {
  items: TriageItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  generatedAt: number;
}) {
  const meta = ATTENTION.unknown;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 border-t border-studio-edge pt-2.5">
      <div className="flex items-center gap-2 px-1">
        <span
          className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow"
          style={{ color: meta.fg }}
        >
          {meta.glyph} {meta.label}
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink-faint">
          {items.length}
        </span>
        <span className="ml-auto font-mono text-[9px] text-studio-ink-faint">
          couldn&rsquo;t scan
        </span>
      </div>
      {items.map((item) => (
        <WorktreeChip
          key={item.worktree.id}
          item={item}
          selected={selected === item.worktree.id}
          onSelect={onSelect}
          generatedAt={generatedAt}
          dim
        />
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * WorktreeChip — the atom. Compact card, expands the reason on click.
 *
 * Rows (top → bottom):
 *   project / worktree · attention glyph
 *   branch + ahead/behind  ·  ago
 *   top attentionReason
 *   change summary (file dots / shortstat)  +  attached live agent
 * ──────────────────────────────────────────────────────────────────────── */
function WorktreeChip({
  item,
  selected,
  onSelect,
  generatedAt,
  dim = false,
}: {
  item: TriageItem;
  selected: boolean;
  onSelect: (id: string | null) => void;
  generatedAt: number;
  dim?: boolean;
}) {
  const { project, worktree: wt } = item;
  const meta = ATTENTION[wt.attention];
  const branch = wt.branch;
  const liveAgent = wt.agents.find((a) => agentLive(a)) ?? null;
  const idleAgent = liveAgent ? null : wt.agents[0] ?? null;
  const reason = wt.attentionReasons[0] ?? null;
  const ab = aheadBehind(branch.ahead, branch.behind);

  const branchLabel = branch.detached
    ? `detached @ ${branch.head ?? "?"}`
    : branch.name ?? "(no branch)";

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onSelect(selected ? null : wt.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(selected ? null : wt.id);
        }
      }}
      className={[
        "group relative cursor-pointer rounded-[5px] border bg-studio-surface px-2.5 py-2",
        "transition-[border-color,background-color] duration-75 ease-out outline-none",
        selected ? "border-studio-edge-strong" : "border-studio-edge hover:border-studio-edge-strong",
        dim ? "opacity-70 hover:opacity-100" : "",
      ].join(" ")}
      style={selected ? { boxShadow: `inset 2px 0 0 ${meta.fg}` } : undefined}
    >
      {/* Row 1 — project · worktree leaf + main/detached tag, attention glyph */}
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 truncate font-mono text-[11px] leading-none text-studio-ink">
          <span className="text-studio-ink-faint">{project.name}</span>
          <span className="text-studio-ink-faint">/</span>
          <span className="font-medium text-studio-ink">{pathLeaf(wt.path)}</span>
        </span>
        {branch.isMain ? <MicroTag>main</MicroTag> : null}
        {branch.detached ? <MicroTag tone="var(--status-error-fg)">detached</MicroTag> : null}
        {wt.error ? <MicroTag tone="var(--status-error-fg)">scan-fail</MicroTag> : null}
        <span
          className="ml-auto font-mono text-[10px] leading-none"
          style={{ color: meta.fg }}
          aria-hidden
        >
          {meta.glyph}
        </span>
      </div>

      {/* Row 2 — branch + ahead/behind, ago */}
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-studio-ink-muted">
          {branchLabel}
        </span>
        {ab ? (
          <span
            className="shrink-0 font-mono text-[10px] tabular-nums"
            style={{ color: branch.diverged ? "var(--status-warn-fg)" : "var(--studio-ink-muted)" }}
          >
            {ab}
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-studio-ink-faint">
          {agoFromMillis(wt.lastCommitAt, generatedAt)}
        </span>
      </div>

      {/* Row 3 — top attention reason, in the lane's tone */}
      {reason ? (
        <div className="mt-1.5 flex items-start gap-1.5">
          <span
            className="mt-[5px] h-1 w-1 shrink-0 rounded-full"
            style={{ background: meta.fg }}
            aria-hidden
          />
          <span
            className="font-sans text-[11px] leading-snug text-studio-ink-muted"
            title={wt.attentionReasons.join(" · ")}
          >
            {reason}
            {wt.attentionReasons.length > 1 ? (
              <span className="ml-1 font-mono text-[9px] text-studio-ink-faint">
                +{wt.attentionReasons.length - 1}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      {/* Row 4 — change summary + attached agent. Wraps at narrow lane
          widths so the agent/session badges drop to their own line instead
          of colliding with a long conflict summary. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <ChangeSummary wt={wt} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {liveAgent ? (
            <AgentBadge handle={agentHandle(liveAgent)} live />
          ) : idleAgent ? (
            <AgentBadge handle={agentHandle(idleAgent)} live={false} />
          ) : null}
          {wt.sessions.length > 0 ? (
            <SessionBadge
              harness={wt.sessions[0].harness}
              live={liveAgent != null}
            />
          ) : null}
        </div>
      </div>

      {/* Expanded — full reasons + file preview, on click */}
      {selected ? <ChipDetail wt={wt} /> : null}
    </article>
  );
}

/* Change summary — file-status dots (capped) + count, or shortstat, or "clean". */
function ChangeSummary({ wt }: { wt: RepoWatchWorktree }) {
  const st = wt.status;

  if (st.conflicts > 0) {
    return (
      <span className="flex items-center gap-1.5">
        <Dots files={wt.status.files} />
        <span
          className="font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow"
          style={{ color: "var(--status-error-fg)" }}
        >
          {st.conflicts} conflict{st.conflicts === 1 ? "" : "s"}
        </span>
      </span>
    );
  }

  if (st.clean) {
    return (
      <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        clean
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Dots files={wt.status.files} />
      <span className="font-mono text-[10px] tabular-nums text-studio-ink-muted">
        {st.changedFiles} file{st.changedFiles === 1 ? "" : "s"}
      </span>
    </span>
  );
}

/* Up to 6 file-status dots, colored by porcelain code; overflow as "+N". */
function Dots({ files }: { files: RepoWatchWorktree["status"]["files"] }) {
  if (files.length === 0) return null;
  const shown = files.slice(0, 6);
  const overflow = files.length - shown.length;
  return (
    <span className="flex items-center gap-[3px]">
      {shown.map((f, i) => (
        <span
          key={`${f.path}-${i}`}
          className="h-[6px] w-[6px] rounded-full"
          style={{ background: toneFg(fileStatusTone(f.status)) }}
          title={`${f.status} ${f.path}`}
        />
      ))}
      {overflow > 0 ? (
        <span className="font-mono text-[9px] tabular-nums text-studio-ink-faint">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

/* Attached agent badge — live gets the accent + a presence dot; idle stays muted. */
function AgentBadge({ handle, live }: { handle: string; live: boolean }) {
  if (live) {
    return (
      <span
        className="flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold"
        style={{ color: "var(--scout-accent)", background: "var(--scout-accent-soft)" }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--scout-accent)" }}
        />
        {handle}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-[3px] border border-studio-edge px-1.5 py-0.5 font-mono text-[9.5px] text-studio-ink-faint">
      <span className="h-1.5 w-1.5 rounded-full bg-studio-edge-strong" />
      {handle}
    </span>
  );
}

function SessionBadge({ harness, live }: { harness: string | null; live: boolean }) {
  const label = harness ?? "session";
  return (
    <span
      className="rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow"
      style={
        live
          ? { color: "var(--scout-accent)", background: "var(--scout-accent-soft)" }
          : { color: "var(--studio-ink-faint)", background: "var(--status-neutral-bg)" }
      }
      title={`session · ${label}${live ? " · live" : ""}`}
    >
      {label}
    </span>
  );
}

function MicroTag({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className="shrink-0 rounded-[2px] px-1 py-px font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
      style={{
        color: tone ?? "var(--studio-ink-faint)",
        background: tone
          ? "color-mix(in oklab, var(--studio-canvas) 70%, transparent)"
          : "var(--status-neutral-bg)",
      }}
    >
      {children}
    </span>
  );
}

/* Expanded detail — every reason, the scan error if any, and a file preview. */
function ChipDetail({ wt }: { wt: RepoWatchWorktree }) {
  const files = wt.status.files.slice(0, 8);
  const overflow = wt.status.files.length - files.length;
  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-studio-edge pt-2.5">
      {/* Full path */}
      <div className="font-mono text-[10px] text-studio-ink-faint" title={wt.path}>
        {shortPath(wt.path, 4)}
      </div>

      {/* All reasons */}
      {wt.attentionReasons.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {wt.attentionReasons.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-studio-edge-strong" />
              <span className="font-sans text-[11px] leading-snug text-studio-ink-muted">
                {r}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Scan error */}
      {wt.error ? (
        <div
          className="rounded-[3px] px-2 py-1.5 font-mono text-[10px] leading-snug"
          style={{ color: "var(--status-error-fg)", background: "var(--status-error-bg)" }}
        >
          {wt.error}
        </div>
      ) : null}

      {/* Diff shortstats, when present */}
      {wt.diff.stagedShortstat || wt.diff.unstagedShortstat ? (
        <div className="flex flex-col gap-0.5 font-mono text-[10px] text-studio-ink-faint">
          {wt.diff.stagedShortstat ? (
            <div>
              <span className="text-status-ok-fg">staged</span> ·{" "}
              {wt.diff.stagedShortstat}
            </div>
          ) : null}
          {wt.diff.unstagedShortstat ? (
            <div>
              <span className="text-status-warn-fg">unstaged</span> ·{" "}
              {wt.diff.unstagedShortstat}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* File preview */}
      {files.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {files.map((f, i) => (
            <div key={`${f.path}-${i}`} className="flex items-center gap-2">
              <span
                className="w-4 shrink-0 text-center font-mono text-[10px] font-semibold"
                style={{ color: toneFg(fileStatusTone(f.status)) }}
                title={f.status}
              >
                {fileStatusBadge(f.status)}
              </span>
              <span className="min-w-0 truncate font-mono text-[10px] text-studio-ink-muted">
                {shortPath(f.path, 3)}
              </span>
            </div>
          ))}
          {overflow > 0 ? (
            <div className="pl-7 font-mono text-[9.5px] text-studio-ink-faint">
              +{overflow} more
            </div>
          ) : null}
        </div>
      ) : null}

      {/* All agents + sessions */}
      {wt.agents.length > 0 || wt.sessions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {wt.agents.map((a) => {
            const live = agentLive(a);
            return (
              <span
                key={a.id}
                className="font-mono text-[10px]"
                style={{ color: live ? "var(--scout-accent)" : "var(--studio-ink-faint)" }}
                title={`${agentLabel(a)}${a.harness ? ` · ${a.harness}` : ""} (${a.state ?? "unknown"})`}
              >
                {agentHandle(a)}
                {live ? "" : ` (${a.state ?? "idle"})`}
              </span>
            );
          })}
          {wt.sessions.map((s) => (
            <span key={s.id} className="font-mono text-[9.5px] text-studio-ink-faint">
              · {s.harness ?? "session"}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* Snapshot-level warnings — a calm, collapsed note rail under the board. */
function WarningsFooter({ warnings }: { warnings: string[] }) {
  return (
    <footer className="mt-4 rounded-md border border-studio-edge bg-studio-canvas-alt px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow"
          style={{ color: "var(--status-warn-fg)" }}
        >
          ▲ scan warnings
        </span>
        <span className="font-mono text-[9px] tabular-nums text-studio-ink-faint">
          {warnings.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {warnings.map((w, i) => (
          <li
            key={i}
            className="flex items-start gap-1.5 font-mono text-[10px] leading-snug text-studio-ink-faint"
          >
            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-studio-edge-strong" />
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </footer>
  );
}

/* Deterministic clock from epoch-ms — UTC so screenshots stay byte-stable. */
function fmtClock(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
