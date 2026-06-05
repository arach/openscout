/**
 * Repo Watch — CONTEXT side pane.
 *
 * The right-hand drill-down that fills when a worktree is selected in the Fleet
 * Table. Ported from the Claude Design handoff's `ContextPanel`, but bound
 * strictly to the real `/api/repo-watch` snapshot contract — the design's
 * fabricated bits (commit history, per-file +/− churn, agent OWNER/REVIEW
 * roles) are NOT present in our wire format and are not invented here. Instead:
 *
 *   · RECENT COMMITS → a single "LAST COMMIT" line (ago + short head sha)
 *   · per-file churn → a status badge + path (we have status, not +/−)
 *   · AGENTS ON TREE roles → the agent handle + a live/idle state word
 *   · CHURN → parsed from `diff.unstagedShortstat` (+ staged) into the same
 *     split bar + numerals the table uses; "working tree clean" otherwise
 *
 * Palette + fonts inherit from the `.rw-scope` ancestor (see ReposScreen), so
 * the panel tracks the table's warm / cool / mono tone for free. Styles live in
 * ./console.css under `.rw-ctx` / `.ctx-*`.
 */

import "./console.css";
import type {
  RepoWatchWorktree,
  RepoWatchProject,
  RepoWatchAgentRef,
} from "./types.ts";
import {
  agoFromMillis,
  agentHandle,
  agentLive,
  fileStatusTone,
  fileStatusBadge,
  toneFg,
  toneBg,
  uniqueAgents,
  churnOf,
  wtState,
  fmt,
} from "./ui.ts";
import { BranchLabel } from "./parts.tsx";

/* Derive the header state tag from real status fields. */
function stateTag(wt: RepoWatchWorktree): { label: string; cls: string } {
  if (wt.error != null) return { label: "SCAN ERR", cls: "err" };
  if (wt.status.conflicts > 0) return { label: "CONFLICT", cls: "conflict" };
  if (!wt.status.clean) return { label: "DIRTY", cls: "dirty" };
  return { label: "CLEAN", cls: "clean" };
}

function stateWord(a: RepoWatchAgentRef): string {
  const s = (a.state ?? "").toLowerCase();
  if (s === "active") return "ACTIVE";
  if (s === "idle") return "IDLE";
  if (s === "waiting") return "WAITING";
  return "—";
}

/* Split a path into directory prefix + filename for the FILES CHANGED rows. */
function splitPath(p: string): { dir: string; file: string } {
  const i = p.lastIndexOf("/");
  if (i < 0) return { dir: "", file: p };
  return { dir: p.slice(0, i + 1), file: p.slice(i + 1) };
}

export default function RepoWatchContext({
  worktree,
  project,
  generatedAt,
}: {
  worktree: RepoWatchWorktree | null;
  project: RepoWatchProject | null;
  generatedAt: number;
}) {
  if (!worktree || !project) {
    return (
      <aside className="rw-ctx" aria-label="Worktree detail">
        <div className="rw-ctx-empty">
          <span className="eb">CONTEXT · WORKTREE</span>
          <span className="msg">Select a worktree to inspect</span>
        </div>
      </aside>
    );
  }

  const wt = worktree;
  const b = wt.branch;
  const tag = stateTag(wt);

  // Churn — parsed from real shortstats; sum staged + unstaged.
  const { add, del, has: hasChurn } = churnOf(wt);
  const churnTot = add + del || 1;

  const agents = uniqueAgents(wt);

  // Breakdown chips (only those that carry a count).
  const breakdown: { label: string; n: number; cls?: string }[] = [
    { label: "staged", n: wt.status.staged },
    { label: "unstaged", n: wt.status.unstaged },
    { label: "untracked", n: wt.status.untracked },
    { label: "conflicts", n: wt.status.conflicts, cls: "conf" },
  ].filter((c) => c.n > 0);

  return (
    <aside className="rw-ctx" aria-label="Worktree detail">
      {/* ── header ── */}
      <div className="ctx-h">
        <div className="ctx-eyebrow">
          <span>CONTEXT · WORKTREE</span>
        </div>
        <div className="ctx-repo">
          <span className={"dot " + wtState(wt)} />
          <span className="rn">{project.name}</span>
          <span className={"ctx-state " + tag.cls}>{tag.label}</span>
        </div>
        <div className="ctx-branch">
          <BranchLabel branch={b} fallback={wt.name} />
        </div>
        <div className="ctx-path">
          {wt.path}
          {b.upstream ? <span className="ref"> · {b.upstream}</span> : null}
        </div>
      </div>

      {/* ── stat grid ── */}
      <div className="ctx-stats">
        <div>
          <div className={"v" + (b.ahead > 0 ? " mint" : " dim")}>↑{b.ahead}</div>
          <div className="k">AHEAD</div>
        </div>
        <div>
          <div className={"v" + (b.behind > 0 ? " amber" : " dim")}>↓{b.behind}</div>
          <div className="k">BEHIND</div>
        </div>
        <div>
          <div className={"v" + (wt.status.changedFiles > 0 ? "" : " dim")}>
            {wt.status.changedFiles}
          </div>
          <div className="k">FILES</div>
        </div>
      </div>

      {/* ── status breakdown chips ── */}
      {breakdown.length > 0 ? (
        <div className="ctx-breakdown">
          {breakdown.map((c) => (
            <span key={c.label} className={"ctx-chip" + (c.cls ? " " + c.cls : "")}>
              <span className="n">{c.n}</span>
              {c.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="ctx-body">
        {/* ── attention / why ── */}
        {wt.attentionReasons.length > 0 ? (
          <div className="ctx-sec">
            <div className="ctx-sec-h">
              <span>ATTENTION</span>
              <span className="n">{wt.attentionReasons.length}</span>
            </div>
            <div className="ctx-why">
              {wt.attentionReasons.map((r, i) => (
                <span key={i} className="pill">
                  {r}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── scan error ── */}
        {wt.error ? (
          <div className="ctx-sec">
            <div className="ctx-sec-h">
              <span>SCAN ERROR</span>
            </div>
            <div className="ctx-err">{wt.error}</div>
          </div>
        ) : null}

        {/* ── churn ── */}
        <div className="ctx-sec">
          <div className="ctx-sec-h">
            <span>CHURN</span>
            <span className="n">working tree</span>
          </div>
          {hasChurn ? (
            <div className="ctx-churn">
              <span className="nums">
                <span className="add">+{fmt(add)}</span>
                <span className="sl">/</span>
                <span className="del">−{fmt(del)}</span>
              </span>
              <span className="cbar" title={`+${fmt(add)} −${fmt(del)}`}>
                <span className="g" style={{ width: (add / churnTot) * 100 + "%" }} />
                <span className="r" style={{ width: (del / churnTot) * 100 + "%" }} />
              </span>
            </div>
          ) : (
            <div className="ctx-churn-clean">working tree clean</div>
          )}
        </div>

        {/* ── files changed ── */}
        {wt.status.files.length > 0 ? (
          <div className="ctx-sec">
            <div className="ctx-sec-h">
              <span>FILES CHANGED</span>
              <span className="n">{wt.status.files.length}</span>
            </div>
            {wt.status.files.map((f) => {
              const tone = fileStatusTone(f.status);
              const { dir, file } = splitPath(f.path);
              return (
                <div className="ctx-fchg" key={f.path}>
                  <span
                    className="badge"
                    style={{ color: toneFg(tone), background: toneBg(tone) }}
                    title={f.status}
                  >
                    {fileStatusBadge(f.status)}
                  </span>
                  <span className="fp" title={f.path}>
                    <span className="dir">{dir}</span>
                    {file}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* ── last commit ── */}
        <div className="ctx-sec">
          <div className="ctx-sec-h">
            <span>LAST COMMIT</span>
          </div>
          <div className="ctx-commit">
            {wt.lastCommitAt != null || b.head ? (
              <>
                {b.head ? <span className="hash">{b.head.slice(0, 7)}</span> : null}
                <span className="t">{agoFromMillis(wt.lastCommitAt, generatedAt)} ago</span>
              </>
            ) : (
              <span className="none">no commit data</span>
            )}
          </div>
        </div>

        {/* ── agents on tree ── */}
        <div className="ctx-sec">
          <div className="ctx-sec-h">
            <span>AGENTS ON TREE</span>
            <span className="n">
              {agents.length}
              {wt.sessions.length > 0 ? ` · ${wt.sessions.length} session${wt.sessions.length === 1 ? "" : "s"}` : ""}
            </span>
          </div>
          {agents.length > 0 ? (
            agents.map((a) => (
              <div className="ctx-agent" key={agentHandle(a)}>
                <span className={"d " + (agentLive(a) ? "on" : "off")} />
                <span className="h">{agentHandle(a)}</span>
                <span className="role">{stateWord(a)}</span>
              </div>
            ))
          ) : (
            <div className="ctx-none">no agents attached</div>
          )}
        </div>
      </div>

      {/* ── actions ── */}
      <div className="ctx-actions">
        <button className="ctx-btn primary" type="button" disabled title="not wired yet">
          Open diff
        </button>
        <button className="ctx-btn" type="button" disabled title="not wired yet">
          Checkout
        </button>
        <button
          className="ctx-btn"
          type="button"
          style={{ flex: "0 0 auto", padding: "9px 12px" }}
          title="Copy worktree path"
          onClick={() => {
            void navigator.clipboard?.writeText(wt.path);
          }}
        >
          Copy path
        </button>
      </div>
    </aside>
  );
}
