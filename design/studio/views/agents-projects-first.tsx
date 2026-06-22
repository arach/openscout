"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Agents · Projects First

   The project is the primary object; under each, a few recent sessions. Built
   to a floor, not a ceiling — minimum cognitive load but not less than required.

   Disclosure tiers (recent view):
     · default  — title + recency + project
     · hover    — session id + agent card  (who / which thread)
     · click    — + harness + branch       (the full coordinates)
   Idle projects collapse to a line until opened. Agent card (the named agent)
   is distinct from harness (its runtime). No status lights — the one emerald
   accent is reserved for attention.
   ─────────────────────────────────────────────────────────────────────────── */

import { useMemo, useState } from "react";
import styles from "./agents-projects-first.module.css";

type Session = {
  title: string;
  sref: string;
  card: string; // the named agent (agent card)
  harness: string; // its runtime
  branch: string;
  time: string;
  ts: number; // seconds ago — recent-view ordering
  working: boolean;
  attn?: boolean;
};
type Project = {
  id: string;
  name: string;
  path: string;
  attn?: boolean;
  working: number;
  sessions: number;
  recency: number; // lower = more recent
  recent: Session[];
};

const PROJECTS: Project[] = [
  {
    id: "openscout", name: "openscout", path: "~/dev/openscout", attn: true,
    working: 3, sessions: 12, recency: 1,
    recent: [
      { title: "v1 card shape — needs a call on the review", sref: "askf-mq128", card: "Atlas", harness: "claude", branch: "main", time: "2m", ts: 125, working: false, attn: true },
      { title: "inspector polish pass", sref: "b7x2-9qd4", card: "Scout", harness: "claude", branch: "feat/inspector-polish", time: "6s", ts: 6, working: true },
      { title: "harness families readout wiring", sref: "k4p1-2mzr", card: "Vega", harness: "codex", branch: "feat/harness-families", time: "35m", ts: 2100, working: false },
    ],
  },
  {
    id: "talkie", name: "talkie", path: "~/dev/talkie",
    working: 4, sessions: 9, recency: 2,
    recent: [
      { title: "bridge security audit", sref: "q9f3-7nx2", card: "Grok", harness: "grok", branch: "main", time: "1m", ts: 60, working: true },
      { title: "delight-scout pass", sref: "m2c8-4hb1", card: "Sol", harness: "claude", branch: "feat/delight", time: "12m", ts: 720, working: false },
      { title: "card Z jiq8 review", sref: "z5a1-0wq9", card: "Echo", harness: "codex", branch: "codex/card-z-jiq8", time: "41m", ts: 2460, working: false },
    ],
  },
  {
    id: "hudson", name: "hudson", path: "~/dev/hudson",
    working: 2, sessions: 5, recency: 3,
    recent: [
      { title: "keyboard layer refactor", sref: "h8d3-6kt7", card: "Nova", harness: "codex", branch: "feat/hud-keyboard", time: "2m", ts: 120, working: true },
      { title: "markdown renderer", sref: "r3e7-1ax4", card: "Juno", harness: "claude", branch: "feat/hud-markdown", time: "18m", ts: 1080, working: false },
      { title: "voice gating behind a flag", sref: "v6d4-9bn0", card: "Pixel", harness: "codex", branch: "feat/voice-flag", time: "1h", ts: 3700, working: false },
    ],
  },
  {
    id: "preframe", name: "preframe", path: "~/dev/preframe",
    working: 1, sessions: 4, recency: 4,
    recent: [
      { title: "brand language draft", sref: "n1f8-3ye6", card: "Scout", harness: "claude", branch: "feat/brand-language", time: "12m", ts: 730, working: true },
      { title: "no-fly list pass", sref: "c8c2-7dp3", card: "Atlas", harness: "claude", branch: "main", time: "1h", ts: 3650, working: false },
      { title: "layered-plain language port", sref: "l4a9-2bk8", card: "Juno", harness: "claude", branch: "feat/layered-plain", time: "2h", ts: 7200, working: false },
    ],
  },
  {
    id: "pi-scout", name: "pi scout", path: "~/dev/pi-scout",
    working: 1, sessions: 3, recency: 5,
    recent: [
      { title: "LAN pairing flow", sref: "p2b6-1fx9", card: "Pi", harness: "pi", branch: "feat/lan-pairing", time: "1h", ts: 3600, working: true },
      { title: "bonjour discovery", sref: "b9e0-4cm2", card: "Pi", harness: "pi", branch: "feat/bonjour", time: "2h", ts: 7260, working: false },
      { title: "one-tap pair over /pair", sref: "t7a3-8dk5", card: "Pi", harness: "pi", branch: "feat/pair-endpoint", time: "3h", ts: 10800, working: false },
    ],
  },
  {
    id: "premotion", name: "premotion", path: "~/dev/premotion",
    working: 0, sessions: 2, recency: 6,
    recent: [
      { title: "launch flag cleanup", sref: "f5c1-9ax3", card: "Vega", harness: "codex", branch: "main", time: "2h", ts: 7300, working: false },
      { title: "feature gate slice", sref: "g3b8-2ye1", card: "Sol", harness: "claude", branch: "feat/feature-gate", time: "4h", ts: 14400, working: false },
    ],
  },
  {
    id: "dewey", name: "dewey", path: "~/dev/dewey",
    working: 0, sessions: 2, recency: 7,
    recent: [
      { title: "inbox triage", sref: "x6f2-0aq7", card: "Juno", harness: "claude", branch: "main", time: "3h", ts: 10860, working: false },
      { title: "digest cadence tuning", sref: "d1d9-5cm4", card: "Echo", harness: "codex", branch: "feat/digest-cadence", time: "6h", ts: 21600, working: false },
    ],
  },
  {
    id: "iris", name: "iris", path: "~/dev/iris",
    working: 0, sessions: 1, recency: 8,
    recent: [{ title: "almanac sync", sref: "a8e4-3bk6", card: "Vega", harness: "codex", branch: "main", time: "5h", ts: 18000, working: false }],
  },
];

type View = "recent" | "project";
type Lens = "all" | "active" | "needs";

const LENSES: { id: Lens; label: string; attn?: boolean }[] = [
  { id: "needs", label: "Needs you", attn: true },
  { id: "active", label: "Active" },
  { id: "all", label: "All projects" },
];

const NOTES: { title: string; body: React.ReactNode }[] = [
  { title: "Project is the unit", body: <>~8 calm blocks instead of a 40-card scroll. You scan <b>what's happening where</b>, then drop in.</> },
  { title: "Disclosure in tiers", body: <>Default is <b>title + recency</b>. Hover a recent row for <b>session id + agent card</b>; click for the full coordinates — <b>harness · branch</b>.</> },
  { title: "Idle collapses", body: <>Active projects show their recent work; idle ones fold to a single line until you <b>open them</b>.</> },
  { title: "Two views", body: <><b>Recent</b> is the compact time-ordered firehose; <b>project</b> groups the same work. Same lenses over both.</> },
  { title: "Cards secondary", body: <>Search-by-card still exists — a lookup tool, more for agents to find each other than your primary lens. It's at the rail foot.</> },
];

export default function AgentsProjectsFirstPage() {
  const [view, setView] = useState<View>("project");
  const [lens, setLens] = useState<Lens>("all");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(PROJECTS.filter((p) => p.working > 0).map((p) => p.id)),
  );
  const [selected, setSelected] = useState<string | null>("b7x2-9qd4");

  const counts = useMemo(
    () => ({
      all: PROJECTS.length,
      active: PROJECTS.filter((p) => p.working > 0).length,
      needs: PROJECTS.filter((p) => p.attn).length,
    }),
    [],
  );

  const projectsView = useMemo(
    () =>
      PROJECTS.filter((p) => (lens === "active" ? p.working > 0 : lens === "needs" ? p.attn : true)).sort(
        (a, b) => a.recency - b.recency,
      ),
    [lens],
  );

  const recentView = useMemo(() => {
    const flat = PROJECTS.flatMap((p) =>
      p.recent.map((s) => ({ ...s, project: p.name, projWorking: p.working > 0 })),
    );
    return flat
      .filter((s) => (lens === "active" ? s.projWorking : lens === "needs" ? s.attn : true))
      .sort((a, b) => a.ts - b.ts);
  }, [lens]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleSelect = (sref: string) => setSelected((cur) => (cur === sref ? null : sref));

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agents-projects-first
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agents · Projects First
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The project is the primary object; recent sessions sit under each. Built to a floor — default rows
          show title + recency. In recent view, hover a row for session id + agent card; click for the full
          coordinates (harness · branch). Idle projects collapse until opened.
        </p>
      </header>

      <div className={styles.wrap}>
        <div className={styles.frame}>
          <nav className={styles.nav}>
            <div className={styles.brand}>
              <span className={styles.brandMark} />
              scout
            </div>
            <div className={styles.navTabs}>
              <span className={styles.navTab}>home</span>
              <span className={styles.navTabActive}>agents</span>
              <span className={styles.navTab}>terminals</span>
              <span className={styles.navTab}>chat</span>
            </div>
          </nav>

          <div className={styles.body}>
            <aside className={styles.rail}>
              <div className={styles.railHead}>lenses</div>
              {LENSES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`${styles.lens} ${lens === l.id ? styles.lensOn : ""}`}
                  onClick={() => setLens(l.id)}
                >
                  <span className={styles.lensLabel}>
                    {l.attn && <span className={styles.lensDot} />}
                    {l.label}
                  </span>
                  <span className={styles.lensCount}>{counts[l.id]}</span>
                </button>
              ))}
              <div className={styles.railBottom}>
                <div className={styles.railDivide} />
                <div className={styles.railSecondaryHead}>find</div>
                <div className={styles.railSecondary}>
                  <span className={styles.railSecondaryTop}>
                    Agent directory <span className={styles.railSecondaryArrow}>→</span>
                  </span>
                  <span className={styles.railSecondaryCap}>search by card · how agents find each other</span>
                </div>
                <div className={styles.railFoot}>
                  {counts.active} of {counts.all} projects active
                </div>
              </div>
            </aside>

            <div className={styles.main}>
              <div className={styles.boardTop}>
                <div className={styles.view}>
                  {(["recent", "project"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`${styles.viewBtn} ${view === v ? styles.viewBtnOn : ""}`}
                      onClick={() => setView(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <div className={styles.boardSearch}>
                  <span>▸</span>
                  search projects &amp; sessions…
                  <span className={styles.boardSearchKbd}>/</span>
                </div>
              </div>

              {view === "project" ? (
                <div className={styles.projects}>
                  {projectsView.map((p) => {
                    const open = expanded.has(p.id);
                    const more = p.sessions - p.recent.length;
                    return (
                      <div key={p.id} className={`${styles.proj} ${p.attn ? styles.projAttn : ""}`}>
                        <div className={styles.projHead} onClick={() => toggleExpand(p.id)}>
                          <span className={`${styles.projChevron} ${open ? styles.projChevronOpen : ""}`}>▸</span>
                          <span className={styles.projIdent}>
                            <span className={`${styles.projName} ${p.working > 0 ? "" : styles.projNameIdle}`}>{p.name}</span>
                            <span className={styles.projPath}>{p.path}</span>
                          </span>
                          {p.attn && <span className={styles.projAttnTag}>needs you</span>}
                          <span className={styles.projDigest}>
                            {p.working > 0 ? `${p.working} working · ` : "idle · "}
                            {p.sessions} session{p.sessions === 1 ? "" : "s"}
                          </span>
                        </div>
                        {open && (
                          <div className={styles.sessions}>
                            {p.recent.map((s) => {
                              const sel = selected === s.sref;
                              return (
                                <div
                                  key={s.sref}
                                  className={`${styles.session} ${sel ? styles.sessionSelected : ""}`}
                                  onClick={() => toggleSelect(s.sref)}
                                >
                                  <span className={`${styles.sessionTitle} ${s.attn ? styles.sessionTitleAttn : s.working ? styles.sessionTitleWorking : ""}`}>
                                    {s.title}
                                  </span>
                                  {sel && (
                                    <div className={styles.sessionMeta}>
                                      <span className={styles.colRef}>{s.sref}</span>
                                      <span className={styles.colCard}>{s.card}</span>
                                      <span className={styles.colHarness}>{s.harness}</span>
                                      <span className={styles.colBranch}>{s.branch}</span>
                                    </div>
                                  )}
                                  <span className={styles.sessionSpacer} />
                                  <span className={styles.sessionTime}>{s.time}</span>
                                </div>
                              );
                            })}
                            {more > 0 && <span className={styles.sessionMore}>+ {more} more sessions</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.recencyList}>
                  {recentView.map((s) => {
                    const sel = selected === s.sref;
                    return (
                      <div
                        key={s.sref}
                        className={`${styles.recRow} ${sel ? styles.recRowSelected : ""}`}
                        onClick={() => toggleSelect(s.sref)}
                      >
                        <span className={styles.recTime}>{s.time}</span>
                        <span className={`${styles.recTitle} ${s.attn ? styles.recTitleAttn : s.working ? styles.recTitleWorking : ""}`}>
                          {s.title}
                        </span>
                        <div className={styles.recDetail}>
                          <span className={styles.colRef}>{s.sref}</span>
                          <span className={styles.colCard}>{s.card}</span>
                          <span className={styles.recFull}>
                            <span className={styles.colHarness}>{s.harness}</span>
                            <span className={styles.colBranch}>{s.branch}</span>
                          </span>
                        </div>
                        <span className={styles.recSpacer} />
                        {s.attn && <span className={styles.recTag}>needs you</span>}
                        <span className={styles.recProject}>{s.project}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <section>
          <div className={styles.noteHead}>Principles</div>
          <div className={styles.note}>
            {NOTES.map((n) => (
              <div key={n.title} className={styles.noteCell}>
                <span className={styles.noteTitle}>{n.title}</span>
                <span className={styles.noteBody}>{n.body}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
