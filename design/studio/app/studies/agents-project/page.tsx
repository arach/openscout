"use client";

import { useMemo, useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { HarnessMark } from "@/components/HarnessMark";
import fixtureJson from "./fixture.json";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────────────────
   Agents · Project view — the wide pane when you focus ONE project.

   Built on a REAL broker snapshot (packages/web/scripts/build-agents-fixture.ts
   over a live /api/agents + /api/conversations + /api/tail/discover capture),
   normalized through the actual project-identity layer. So this shows the real
   mess, not a hypothetical: 52 broker rows for openscout that are really ~5
   recognizable agents (Claude, Grok, Codex, Scout, Openscout) plus a long tail
   of ephemeral "Card" workflow agents and numeric clones.

   Three goals drive the layout:
     1. FIND the agent you want    → find bar (name / branch / harness) + roster
     2. understand its CONTEXT     → header digest + per-agent branch/model/live
     3. CREATE / MANAGE sessions   → ＋New agent, Resume, ＋Session, Steer, ⋯

   One accent, used only as a precedence ladder: needs-you ▸ live ▸ idle.
   ──────────────────────────────────────────────────────────────────────── */

const HARNESS_HUE: Record<string, number> = {
  claude: 28,
  codex: 210,
  grok: 280,
  pi: 280,
  gemini: 150,
  general: 220,
};

type FxSession = {
  kind: string;
  status: string;
  harness: string;
  label: string;
  detail: string | null;
  lastActivityAt: number | null;
};
type FxAgentRow = {
  name: string;
  harness: string;
  status: string;
  stateLabel: string;
  branch: string;
  activeTask: string | null;
  activeAskCount: number;
  lastActivityAt: number | null;
  model: string | null;
  sessions: FxSession[];
};
type FxProject = {
  slug: string;
  title: string;
  root: string;
  harnesses: string[];
  sessionCount: number;
  lastActivityAt: number | null;
  liveProcesses: number;
  liveHarnesses: string[];
  agents: FxAgentRow[];
  unassigned: FxSession[];
};
type FxRecent = {
  agentName: string;
  agentId: string;
  task: string;
  conversationId: string;
  completedAt: number | null;
};
type Fx = { generatedAt: number; recentCompleted: FxRecent[]; projects: FxProject[] };

const FX = fixtureJson as unknown as Fx;
const NOW = FX.generatedAt;

/* ── time / text helpers ─────────────────────────────────────────────────── */
function ago(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = NOW - ms;
  if (d < 0) return "now";
  const m = Math.round(d / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
function harnessOf(h: string): string {
  return h === "pi" ? "grok" : h;
}
function firstToken(name: string): string {
  return name.toLowerCase().split(/\s+/)[0] ?? name.toLowerCase();
}

// The real broker mints a separate identity per workflow card and per numeric
// clone — "Openscout Card J Sh3vxg", "Openscout 185", "Sco061". Those are not
// agents you go looking for; demote them so the recognizable agents lead.
function isEphemeral(name: string): boolean {
  return (
    /\bcard\b/i.test(name) ||
    /\b\d{3,}\b/i.test(name) ||
    /sco\d{2,}/i.test(name) ||
    /grok\d+$/i.test(name) ||
    /codex\s*\d+$/i.test(name) ||
    /message\s+(attach|workflow)/i.test(name)
  );
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "agent";
  let max = 0;
  for (const [v, n] of counts) if (n > max) ((max = n), (best = v));
  return best;
}

/* ── roll the broker's per-(name·branch) rows up to one lane per real agent ── */
type Group = {
  name: string;
  harness: string;
  model: string | null;
  rows: FxAgentRow[];
  branches: string[];
  sessionCount: number;
  lastAt: number;
  needs: boolean;
  ephemeral: boolean;
};

function groupsFor(p: FxProject): Group[] {
  const byName = new Map<string, FxAgentRow[]>();
  for (const r of p.agents) {
    const arr = byName.get(r.name) ?? [];
    arr.push(r);
    byName.set(r.name, arr);
  }
  const groups: Group[] = [];
  for (const [name, rows] of byName) {
    const branches = [...new Set(rows.map((r) => r.branch).filter((b) => b && b !== "—"))];
    groups.push({
      name,
      harness: mostCommon(rows.map((r) => r.harness)),
      model: rows.map((r) => r.model).find(Boolean) ?? null,
      rows: [...rows].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)),
      branches,
      sessionCount: rows.reduce((n, r) => n + r.sessions.length, 0),
      lastAt: Math.max(0, ...rows.map((r) => r.lastActivityAt ?? 0)),
      needs: rows.some((r) => r.activeAskCount > 0),
      ephemeral: isEphemeral(name),
    });
  }
  return groups.sort((a, b) => {
    if (a.needs !== b.needs) return a.needs ? -1 : 1;
    return b.lastAt - a.lastAt || b.sessionCount - a.sessionCount;
  });
}

function branchesInFlight(p: FxProject): string[] {
  const seen = new Map<string, number>();
  for (const r of p.agents) {
    if (!r.branch || r.branch === "—" || r.branch === "main") continue;
    seen.set(r.branch, Math.max(seen.get(r.branch) ?? 0, r.lastActivityAt ?? 0));
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
}

function recentFor(p: FxProject): FxRecent[] {
  const names = new Set(p.agents.map((a) => a.name.toLowerCase()));
  return FX.recentCompleted.filter(
    (r) => names.has(r.agentName.toLowerCase()) || p.slug.startsWith(firstToken(r.agentName)),
  );
}

/* the rooted, real projects — most live first */
const PROJECTS = [...FX.projects].sort(
  (a, b) => b.liveProcesses - a.liveProcesses || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
);
const DEFAULT = PROJECTS.find((p) => p.slug === "openscout") ?? PROJECTS[0];

/* ── icons ─────────────────────────────────────────────────────────────── */
function IcoOpen() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M9 3h4v4M13 3 7.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IcoBranch() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4.5" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4.5" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.5" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 5.1v5.8M4.5 9.5c0-2.5 1.5-3.5 5.4-3.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function IcoSearch() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/* ── one agent lane (rolled up) ────────────────────────────────────────── */
function AgentLane({ g }: { g: Group }) {
  const [open, setOpen] = useState(false);
  const live = NOW - g.lastAt < 30 * 60_000; // touched in last 30m → live-ish
  const tone = g.needs ? "needs" : live ? "working" : "idle";
  const shownBranches = g.branches.slice(0, 3);

  return (
    <div className={styles.lane} data-tone={tone}>
      <div className={styles.laneRow}>
        <SpriteAvatar
          name={g.name}
          size={32}
          hue={HARNESS_HUE[g.harness]}
          tile
          corner={g.needs ? "var(--s-accent)" : live ? "var(--s-accent)" : "var(--s-dim)"}
          cornerPulse={live}
        />
        <div className={styles.laneBody}>
          <div className={styles.laneTop}>
            <span className={styles.laneName}>{g.name}</span>
            <span className={styles.laneHmark} aria-hidden>
              <HarnessMark harness={harnessOf(g.harness)} size={11} />
            </span>
            {g.model ? <span className={styles.modelChip}>{g.model}</span> : null}
            {g.needs ? (
              <span className={styles.tagNeeds}>needs you</span>
            ) : live ? (
              <span className={styles.tagWorking}>
                <span className={styles.pip} aria-hidden /> live
              </span>
            ) : null}
            <span className={styles.laneAgo}>{ago(g.lastAt)}</span>
          </div>

          <div className={styles.laneCtx}>
            {shownBranches.length ? (
              shownBranches.map((b) => (
                <span key={b} className={styles.ctxBranch}>
                  <span className={styles.ctxBranchIco} aria-hidden>
                    <IcoBranch />
                  </span>
                  {b}
                </span>
              ))
            ) : (
              <span className={styles.ctxBranch} data-dim>
                <span className={styles.ctxBranchIco} aria-hidden>
                  <IcoBranch />
                </span>
                main
              </span>
            )}
            {g.branches.length > 3 ? <span className={styles.ctxMore}>+{g.branches.length - 3}</span> : null}
          </div>

          <button type="button" className={styles.laneMetaToggle} onClick={() => setOpen((v) => !v)}>
            {g.rows.length} instance{g.rows.length === 1 ? "" : "s"} · {g.sessionCount} live session
            {g.sessionCount === 1 ? "" : "s"} {open ? "▴" : "▾"}
          </button>
        </div>

        <div className={styles.laneActions}>
          {g.needs ? (
            <button type="button" className={`${styles.laneBtn} ${styles.laneBtnPrimary}`}>
              Approve
            </button>
          ) : (
            <button type="button" className={styles.laneBtn}>
              {live ? "Steer ›" : "Resume ›"}
            </button>
          )}
          <button type="button" className={styles.laneBtn}>＋ Session</button>
          <button type="button" className={styles.laneIcon} title="More">⋯</button>
        </div>
      </div>

      {open ? (
        <div className={styles.sessions}>
          {g.rows.map((r, i) => (
            <button key={i} type="button" className={styles.instRow} data-active={NOW - (r.lastActivityAt ?? 0) < 30 * 60_000 || undefined}>
              <span className={styles.sessDot} aria-hidden />
              <span className={styles.sessBranch}>{r.branch === "—" ? "main" : r.branch}</span>
              <span className={styles.sessTask}>
                {r.sessions.length
                  ? `${r.sessions.length} session${r.sessions.length === 1 ? "" : "s"}`
                  : r.stateLabel || "registered"}
              </span>
              <span className={styles.sessAgo}>{ago(r.lastActivityAt)}</span>
              <span className={styles.instOpen} aria-hidden>
                <IcoOpen />
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── project view ──────────────────────────────────────────────────────── */
function ProjectView({ p }: { p: FxProject }) {
  const [q, setQ] = useState("");
  const [harness, setHarness] = useState<string | null>(null);
  const [showEph, setShowEph] = useState(false);

  const groups = useMemo(() => groupsFor(p), [p]);
  const flight = useMemo(() => branchesInFlight(p), [p]);
  const recent = useMemo(() => recentFor(p), [p]);

  const query = q.trim().toLowerCase();
  const match = (g: Group) =>
    (!harness || g.harness === harness || (harness === "grok" && g.harness === "pi")) &&
    (!query ||
      g.name.toLowerCase().includes(query) ||
      g.branches.some((b) => b.toLowerCase().includes(query)) ||
      g.harness.includes(query));

  const primary = groups.filter((g) => !g.ephemeral && match(g));
  const ephemeral = groups.filter((g) => g.ephemeral && match(g));
  const lead = primary.find((g) => g.needs) ?? primary[0];
  const filtering = Boolean(query || harness);

  const liveTone = p.liveProcesses > 0 ? "working" : "idle";

  return (
    <div className={styles.view}>
      {/* Zone A — header */}
      <header className={styles.head}>
        <SpriteAvatar name={p.slug} size={38} tile />
        <div className={styles.headIdent}>
          <div className={styles.headTop}>
            <span className={styles.headName}>{p.slug}</span>
            <span className={styles.chip} data-tone={liveTone}>
              {p.liveProcesses > 0 ? (
                <>
                  <span className={styles.pip} aria-hidden /> {p.liveProcesses} live
                </>
              ) : (
                <>idle · {ago(p.lastActivityAt)}</>
              )}
            </span>
          </div>
          <span className={styles.headRoot}>{p.root}</span>
        </div>
        <div className={styles.headActions}>
          <button type="button" className={styles.headBtn}>Steer all</button>
          <button type="button" className={`${styles.headBtn} ${styles.headBtnPrimary}`}>＋ New agent</button>
        </div>
      </header>

      {/* Zone B — digest (overall context at a glance) */}
      <div className={styles.digest}>
        <span className={styles.digestItem}>
          <span className={styles.digestNum}>{groups.filter((g) => !g.ephemeral).length}</span>
          <span className={styles.digestLbl}>agents</span>
        </span>
        <span className={styles.digestSep} aria-hidden />
        <span className={styles.digestItem}>
          <span className={styles.digestLbl}>harnesses</span>
          <span className={styles.harnessMarks}>
            {p.harnesses.map((h) => (
              <span key={h} className={styles.harnessMark} title={harnessOf(h)} aria-hidden>
                <HarnessMark harness={harnessOf(h)} size={13} />
              </span>
            ))}
          </span>
        </span>
        <span className={styles.digestSep} aria-hidden />
        <span className={styles.digestItem}>
          <span className={styles.digestNum}>{p.sessionCount}</span>
          <span className={styles.digestLbl}>conversations</span>
        </span>
        <span className={styles.digestSep} aria-hidden />
        <span className={styles.digestItem}>
          <span className={styles.digestLbl}>branches in flight</span>
          <span className={styles.branchChips}>
            {flight.slice(0, 3).map((b) => (
              <span key={b} className={styles.branchChip}>{b}</span>
            ))}
            {flight.length > 3 ? <span className={styles.ctxMore}>+{flight.length - 3}</span> : null}
          </span>
        </span>
      </div>

      {/* Zone C — pick up where it left off (becomes needs-you when an ask is raised) */}
      {lead && !filtering ? (
        <div className={styles.nowBand} data-tone={lead.needs ? "needs" : "working"}>
          <span className={styles.nowLbl}>{lead.needs ? "Waiting on you" : "Most recent"}</span>
          <span className={styles.nowText}>
            <span className={styles.nowWho}>{lead.name}</span>
            <span className={styles.nowSub}>
              {lead.branches[0] ?? "main"} · {ago(lead.lastAt)} · {lead.sessionCount} session
              {lead.sessionCount === 1 ? "" : "s"}
            </span>
          </span>
          <span className={styles.nowActions}>
            {lead.needs ? (
              <button type="button" className={`${styles.nowBtn} ${styles.nowBtnPrimary}`}>Approve &amp; continue</button>
            ) : (
              <button type="button" className={`${styles.nowBtn} ${styles.nowBtnPrimary}`}>Resume</button>
            )}
            <button type="button" className={styles.nowBtn}>＋ Session</button>
            <button type="button" className={styles.nowBtn} title="Open"><IcoOpen /></button>
          </span>
        </div>
      ) : null}

      {/* Zone D — find bar (goal: locate the agent you want) */}
      <div className={styles.find}>
        <span className={styles.findIco} aria-hidden><IcoSearch /></span>
        <input
          className={styles.findInput}
          placeholder="Find an agent, branch, or harness…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className={styles.findChips}>
          {p.harnesses.map((h) => {
            const key = harnessOf(h);
            return (
              <button
                key={h}
                type="button"
                className={styles.findChip}
                data-on={harness === key || undefined}
                onClick={() => setHarness((cur) => (cur === key ? null : key))}
              >
                <HarnessMark harness={key} size={11} />
                {key}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body — roster + aside */}
      <div className={styles.grid}>
        <div className={styles.main}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Agents</span>
            <span className={styles.sectionMeta}>
              {primary.length} shown{filtering ? " · filtered" : ""}
            </span>
          </div>

          {primary.map((g) => (
            <AgentLane key={g.name} g={g} />
          ))}
          {primary.length === 0 ? <div className={styles.empty}>No agents match.</div> : null}

          {/* ephemeral / clone agents — collapsed by default */}
          {ephemeral.length ? (
            <div className={styles.ephBlock}>
              <button type="button" className={styles.ephToggle} onClick={() => setShowEph((v) => !v)}>
                <span className={styles.ephCount}>{ephemeral.length}</span> ephemeral · workflow &amp; clone agents
                <span className={styles.ephCaret}>{showEph ? "▴" : "▾"}</span>
              </button>
              {showEph ? (
                <div className={styles.ephList}>
                  {ephemeral.map((g) => (
                    <button key={g.name} type="button" className={styles.ephRow}>
                      <span className={styles.ephMark} aria-hidden>
                        <HarnessMark harness={harnessOf(g.harness)} size={10} />
                      </span>
                      <span className={styles.ephName}>{g.name}</span>
                      <span className={styles.ephBranch}>{g.branches[0] ?? "main"}</span>
                      <span className={styles.ephAgo}>{ago(g.lastAt)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <button type="button" className={styles.startAgent}>＋ New agent on this project</button>
        </div>

        <aside className={styles.aside}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>Recently</div>
            <div className={styles.panelBody}>
              {recent.length ? (
                recent.slice(0, 5).map((r, i) => (
                  <button key={i} type="button" className={styles.recentRow}>
                    <span className={styles.recentWho}>{r.agentName}</span>
                    <span className={styles.recentTask}>{r.task}</span>
                    <span className={styles.recentAgo}>{ago(r.completedAt)}</span>
                  </button>
                ))
              ) : (
                <div className={styles.placeDim} style={{ padding: "4px 7px 8px" }}>No recent completions.</div>
              )}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>Place</div>
            <div className={styles.placeBody}>
              <div className={styles.placeRow}>
                <span className={styles.placeKey}>root</span>
                <span className={styles.placeRoot}>{p.root}</span>
              </div>
              <div className={styles.placeRow}>
                <span className={styles.placeKey}>live</span>
                <span className={styles.placeVal}>
                  {p.liveProcesses} process{p.liveProcesses === 1 ? "" : "es"}
                  {p.liveHarnesses.length ? <span className={styles.placeDim}>· {p.liveHarnesses.join(", ")}</span> : null}
                </span>
              </div>
              <div className={styles.placeRow}>
                <span className={styles.placeKey}>in flight</span>
                <span className={styles.placeBranches}>
                  {flight.slice(0, 5).map((b) => (
                    <span key={b} className={styles.placeBranch}>
                      <span className={styles.placeBranchIco} aria-hidden><IcoBranch /></span>
                      {b}
                    </span>
                  ))}
                  {flight.length === 0 ? <span className={styles.placeDim}>—</span> : null}
                </span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */
export default function AgentsProjectStudy() {
  const [slug, setSlug] = useState(DEFAULT.slug);
  const project = PROJECTS.find((p) => p.slug === slug) ?? DEFAULT;

  return (
    <ScoutStudyShell
      pageId="agents-project"
      title="Agents · Project view"
      initialSkin="graphite"
      blurb={
        <>
          The wide pane when you focus <strong>one project</strong> — built on a{" "}
          <strong>real broker snapshot</strong> (the actual <code>/api/agents</code>,{" "}
          <code>/api/conversations</code> and <code>/api/tail/discover</code>, normalized through the
          live project-identity layer). Three goals: <strong>find</strong> the agent you want (search +
          harness filter), understand its <strong>context</strong> (digest · branches · model · live),
          and <strong>create / manage</strong> sessions (＋New agent · Resume · ＋Session · Steer · ⋯).
          openscout&rsquo;s 52 broker rows collapse to ~5 real agents; the ephemeral{" "}
          <em>Card</em> &amp; clone tail folds away. One accent as a precedence ladder.
        </>
      }
    >
      <div className={styles.surface}>
        <nav className={styles.rail} aria-label="Projects">
          <div className={styles.railHead}>Projects</div>
          {PROJECTS.map((p) => {
            const tone = p.liveProcesses > 0 ? "working" : "idle";
            return (
              <button
                key={p.slug}
                type="button"
                className={styles.railRow}
                data-selected={p.slug === slug || undefined}
                data-tone={tone}
                onClick={() => setSlug(p.slug)}
              >
                <SpriteAvatar name={p.slug} size={24} tile />
                <span className={styles.railName}>{p.slug}</span>
                {p.liveProcesses > 0 ? <span className={styles.railCount}>{p.liveProcesses}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className={styles.pane}>
          <ProjectView p={project} />
        </div>
      </div>
    </ScoutStudyShell>
  );
}
