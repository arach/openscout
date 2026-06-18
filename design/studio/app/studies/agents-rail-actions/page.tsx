"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Agents · Rail Actions

   The main view stays what it should be: the list — projects, or the agents
   under them. What moves is the chrome. Search and New-chat come out of the
   main view and become rail *actions* that open a focused surface (a ⌘K command
   palette / a small composer) over the list, then get out of the way.

   Kept deliberately simple: two actions, the few agents you last touched, a
   settings foot. No pinned filter box, no second search staged over the work.
   One emerald accent, reserved for attention. Floor, not ceiling.
   ─────────────────────────────────────────────────────────────────────────── */

import { useMemo, useState } from "react";
import styles from "./page.module.css";

type View = "projects" | "agents";
type Overlay = null | "search" | "new";

type Session = { title: string; card: string; time: string; working?: boolean; attn?: boolean };
type Project = { id: string; name: string; path: string; working: number; sessions: number; attn?: boolean; recent: Session[] };

const PROJECTS: Project[] = [
  {
    id: "openscout", name: "openscout", path: "~/dev/openscout", attn: true, working: 3, sessions: 12,
    recent: [
      { title: "v1 card shape — needs a call on the review", card: "Atlas", time: "2m", attn: true },
      { title: "inspector polish pass", card: "Scout", time: "6s", working: true },
      { title: "harness families readout wiring", card: "Vega", time: "35m" },
    ],
  },
  {
    id: "talkie", name: "talkie", path: "~/dev/talkie", working: 4, sessions: 9,
    recent: [
      { title: "bridge security audit", card: "Grok", time: "1m", working: true },
      { title: "delight-scout pass", card: "Sol", time: "12m" },
    ],
  },
  {
    id: "hudson", name: "hudson", path: "~/dev/hudson", working: 2, sessions: 5,
    recent: [{ title: "keyboard layer refactor", card: "Nova", time: "2m", working: true }],
  },
  {
    id: "preframe", name: "preframe", path: "~/dev/preframe", working: 1, sessions: 4,
    recent: [{ title: "brand language draft", card: "Scout", time: "12m", working: true }],
  },
];

const RECENTS = [
  { name: "Scout", time: "6s" },
  { name: "Atlas", time: "2m" },
  { name: "Grok", time: "1m" },
];

const PAL_AGENTS = [
  { icon: "◆", label: "Scout — openscout", meta: "agent" },
  { icon: "◆", label: "Atlas — openscout", meta: "agent" },
  { icon: "◆", label: "Grok — talkie", meta: "agent" },
];
const PAL_ACTIONS = [
  { icon: "＋", label: "New chat…", meta: "⌘N" },
  { icon: "⎇", label: "Search by session id…", meta: "session" },
];

const NOTES: { title: string; body: React.ReactNode }[] = [
  { title: "Main view is the list", body: <>The center stays the <b>list</b> — projects, or the agents under them. That's the work; it doesn't share the frame with chrome.</> },
  { title: "Actions, not a filter", body: <><b>Search</b> and <b>New chat</b> are rail actions that open a focused surface, then close. No box pinned over the list, no second search in the center.</> },
  { title: "Search ≠ narrow", body: <>The rail's Search is the cross-fleet <b>lookup</b> (a ⌘K palette: agents · sessions). Narrowing the visible list, if needed, stays a small control on the list itself.</> },
  { title: "Kept simple", body: <>Two actions, the <b>few agents you last touched</b>, settings at the foot. Pointers/lenses were cut for now — easy to add back if the rail earns it.</> },
];

export default function AgentsRailActionsPage() {
  const [view, setView] = useState<View>("projects");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(PROJECTS.filter((p) => p.working > 0).map((p) => p.id)));

  const agents = useMemo(
    () => PROJECTS.flatMap((p) => p.recent.map((s) => ({ ...s, project: p.name }))).sort((a, b) => (a.working === b.working ? 0 : a.working ? -1 : 1)),
    [],
  );
  const working = useMemo(() => PROJECTS.reduce((n, p) => n + p.working, 0), []);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agents-rail-actions
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agents · Rail Actions
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The main view stays the list — projects, or the agents under them. What moves is the chrome:{" "}
          <b>Search</b> and <b>New chat</b> leave the center and become rail <em>actions</em> that open a ⌘K palette /
          composer over the list, then get out of the way. Kept deliberately simple — two actions, the agents you last
          touched, a settings foot. Click an action to see its surface.
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
            {/* ── rail: the actions column ── */}
            <aside className={styles.rail}>
              <button type="button" className={`${styles.action} ${styles.actionPrimary}`} onClick={() => setOverlay("search")}>
                <span className={styles.actionIcon}>⌕</span>
                <span className={styles.actionLabel}>Search</span>
                <span className={styles.actionKbd}>⌘K</span>
              </button>
              <button type="button" className={styles.action} onClick={() => setOverlay("new")}>
                <span className={styles.actionIcon}>＋</span>
                <span className={styles.actionLabel}>New chat</span>
                <span className={styles.actionKbd}>⌘N</span>
              </button>

              <div className={styles.divide} />

              <div className={styles.railHead}>recent</div>
              {RECENTS.map((a) => (
                <div key={a.name} className={styles.recentRow}>
                  <span className={styles.mono}>{a.name[0]}</span>
                  <span className={styles.recentName}>{a.name}</span>
                  <span className={styles.recentTime}>{a.time}</span>
                </div>
              ))}

              <div className={styles.railFoot}>
                <div className={styles.settings}>
                  <span className={styles.actionIcon}>⚙</span>
                  <span className={styles.settingsLabel}>
                    <span className={styles.settingsTop}>Settings</span>
                    <span className={styles.settingsCap}>agents · harness · caps</span>
                  </span>
                </div>
              </div>
            </aside>

            {/* ── main: the list ── */}
            <div className={styles.main}>
              <div className={styles.boardTop}>
                <div className={styles.view}>
                  {(["projects", "agents"] as const).map((v) => (
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
                <span className={styles.boardSpacer} />
                <span className={styles.boardCount}>
                  <span className={styles.boardPip} /> {working} working
                </span>
              </div>

              {view === "projects" ? (
                <div className={styles.projects}>
                  {PROJECTS.map((p) => {
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
                            {p.sessions} sessions
                          </span>
                        </div>
                        {open && (
                          <div className={styles.sessions}>
                            {p.recent.map((s) => (
                              <div key={s.title} className={styles.session}>
                                <span className={`${styles.sessionTitle} ${s.attn ? styles.sessionTitleAttn : s.working ? styles.sessionTitleWorking : ""}`}>
                                  {s.title}
                                </span>
                                <span className={styles.sessionCard}>{s.card}</span>
                                <span className={styles.sessionSpacer} />
                                <span className={styles.sessionTime}>{s.time}</span>
                              </div>
                            ))}
                            {more > 0 && <div className={styles.session} style={{ color: "var(--studio-ink-faint)", fontSize: 10 }}>+ {more} more sessions</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.agentList}>
                  {agents.map((a) => (
                    <div key={`${a.card}-${a.title}`} className={styles.agentLine}>
                      <span className={styles.agentMono}>{a.card[0]}</span>
                      <span className={`${styles.agentDot} ${a.working ? styles.agentDotWorking : ""}`} />
                      <span className={styles.agentNm}>{a.card}</span>
                      <span className={styles.agentTask}>{a.title}</span>
                      <span className={styles.agentProj}>{a.project}</span>
                      <span className={styles.agentTm}>{a.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── overlays raised by rail actions ── */}
          {overlay === "search" && (
            <div className={styles.scrim} onClick={() => setOverlay(null)}>
              <div className={styles.palette} onClick={(e) => e.stopPropagation()}>
                <div className={styles.palInput}>
                  <span className={styles.palInputIcon}>⌕</span>
                  <span>scout</span>
                  <span className={styles.palCaret} />
                  <span className={styles.palSpacer} />
                  <span className={styles.palEsc}>esc</span>
                </div>
                <div className={styles.palSection}>
                  <div className={styles.palSectionHead}>agents</div>
                  {PAL_AGENTS.map((it, i) => (
                    <div key={it.label} className={`${styles.palItem} ${i === 0 ? styles.palItemOn : ""}`}>
                      <span className={styles.palIcon}>{it.icon}</span>
                      <span className={styles.palLabel}>{it.label}</span>
                      <span className={styles.palMeta}>{it.meta}</span>
                    </div>
                  ))}
                  <div className={styles.palSectionHead}>actions</div>
                  {PAL_ACTIONS.map((it) => (
                    <div key={it.label} className={styles.palItem}>
                      <span className={styles.palIcon}>{it.icon}</span>
                      <span className={styles.palLabel}>{it.label}</span>
                      <span className={styles.palMeta}>{it.meta}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {overlay === "new" && (
            <div className={styles.scrim} onClick={() => setOverlay(null)}>
              <div className={styles.composer} onClick={(e) => e.stopPropagation()}>
                <div className={styles.composerHead}>
                  New chat
                  <span className={styles.composerEsc}>esc</span>
                </div>
                <div className={styles.composerBody}>
                  <div className={styles.targets}>
                    <div className={styles.targetChip}><span className={styles.targetKey}>project</span> openscout</div>
                    <div className={styles.targetChip}><span className={styles.targetKey}>agent</span> Scout</div>
                    <div className={styles.targetChip}><span className={styles.targetKey}>harness</span> claude</div>
                  </div>
                  <div className={styles.well}>
                    Land the rail-actions pass — move search + new behind the rail<span className={styles.wellCaret} />
                  </div>
                  <div className={styles.composerFoot}>
                    <span className={styles.composerHint}>↵ to start · ⇧↵ for newline</span>
                    <button type="button" className={styles.composerSend}>Start ↵</button>
                  </div>
                </div>
              </div>
            </div>
          )}
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
