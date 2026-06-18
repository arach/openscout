"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Home · Sidebar

   Defines the left rail on the Home route (`BaseLeftRail` today). The center
   Home screen owns the narrative (hero, what's moving, activity stream); the
   rail is a narrow jump-off — not a second copy of the board.

   Two treatments, switchable in place:
     · Current  — faithful to shipped BaseLeftRail (Recent agents · Recent
                  activity · Needs attention)
     · Lenses   — attention-first IA: Needs you / Moving / Quiet, with jump
                  tiles at the foot instead of repeating the center modules

   Source of truth: packages/web/client/scout/slots/BaseLeftRail.tsx
   ─────────────────────────────────────────────────────────────────────────── */

import { useMemo, useState } from "react";
import styles from "./page.module.css";

type Mode = "current" | "lenses";
type Lens = "needs" | "moving" | "quiet";

type AgentRow = {
  id: string;
  name: string;
  state: "working" | "ready" | "idle";
  updated: string;
  project?: string;
};

type ActivityRow = {
  id: string;
  headline: string;
  actor: string;
  kind: string;
  time: string;
};

type AttentionRow = {
  id: string;
  title: string;
  agent: string;
  kind: string;
  time: string;
};

const RECENT_AGENTS: AgentRow[] = [
  { id: "atelier", name: "Atelier", state: "working", updated: "11s", project: "openscout" },
  { id: "hudson", name: "Hudson", state: "ready", updated: "4m", project: "hudson" },
  { id: "talkie", name: "Talkie", state: "working", updated: "6m", project: "talkie" },
  { id: "dewey", name: "Dewey", state: "ready", updated: "22m", project: "dewey" },
];

const RECENT_ACTIVITY: ActivityRow[] = [
  { id: "a1", headline: "Thicker cube params landed", actor: "Atelier", kind: "message", time: "2m" },
  { id: "a2", headline: "icons:build finished", actor: "Atelier", kind: "flight", time: "5m" },
  { id: "a3", headline: "Review overlay settings timing", actor: "Talkie", kind: "ask", time: "8m" },
  { id: "a4", headline: "Pushed theme bridge to main", actor: "Hudson", kind: "message", time: "18m" },
];

const NEEDS_ATTENTION: AttentionRow[] = [
  { id: "n1", title: "Confirm apple-touch export", agent: "Art", kind: "ask", time: "1m" },
  { id: "n2", title: "QR handoff visible on iPad", agent: "Scout", kind: "ask", time: "11m" },
  { id: "n3", title: "v1 card shape — needs a call", agent: "Atlas", kind: "work", time: "2m" },
];

const LENSES: { id: Lens; label: string; attn?: boolean }[] = [
  { id: "needs", label: "Needs you", attn: true },
  { id: "moving", label: "Moving" },
  { id: "quiet", label: "Quiet" },
];

const NOTES: { title: string; body: React.ReactNode }[] = [
  {
    title: "Rail ≠ board",
    body: (
      <>
        Home center owns the story. The sidebar is a <b>narrow jump-off</b> — recent slices and
        attention, not a second scroll of the same modules.
      </>
    ),
  },
  {
    title: "Current (shipped)",
    body: (
      <>
        Three fixed sections mirror <code>BaseLeftRail</code>: Recent agents (4) · Recent activity (4) ·
        Needs attention (3). Each section has an <b>all</b> escape hatch.
      </>
    ),
  },
  {
    title: "Lenses (proposed)",
    body: (
      <>
        One lens at a time filters the rail. <b>Needs you</b> is default when anything is blocked;
        <b> Moving</b> carries working agents + high-signal activity; <b>Quiet</b> is the rest. Foot
        holds jump tiles (Agents · Activity) instead of a third duplicate list.
      </>
    ),
  },
  {
    title: "Accent budget",
    body: (
      <>
        The emerald accent is reserved for <b>needs-attention</b> rows and the active lens dot — not
        for every working agent. Working reads through tone + copy, not color noise.
      </>
    ),
  },
];

export default function HomeSidebarStudy() {
  const [mode, setMode] = useState<Mode>("current");
  const [lens, setLens] = useState<Lens>("needs");

  const lensCounts = useMemo(
    () => ({
      needs: NEEDS_ATTENTION.length,
      moving: RECENT_AGENTS.filter((a) => a.state === "working").length + 2,
      quiet: RECENT_AGENTS.filter((a) => a.state !== "working").length + 1,
    }),
    [],
  );

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · home-sidebar
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Home · Sidebar
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The left rail on the Home route — what ships in{" "}
          <code className="font-mono text-[11px] text-studio-ink">BaseLeftRail</code> today, and a
          lens-first alternative that stops duplicating the center board. Toggle inside the mockup.
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
              <span className={styles.navTabActive}>home</span>
              <span className={styles.navTab}>agents</span>
              <span className={styles.navTab}>terminals</span>
              <span className={styles.navTab}>chat</span>
            </div>
          </nav>

          <div className={styles.body}>
            <aside className={styles.rail}>
              <div className={styles.railTop}>
                <div className={styles.mode}>
                  {(["current", "lenses"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`${styles.modeBtn} ${mode === m ? styles.modeBtnOn : ""}`}
                      onClick={() => setMode(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {mode === "current" ? (
                <CurrentRail />
              ) : (
                <LensRail lens={lens} setLens={setLens} counts={lensCounts} />
              )}

              <div className={styles.railFoot}>
                {mode === "lenses" ? (
                  <div className={styles.jumpGrid}>
                    <div className={styles.jump}>
                      Agents
                      <span className={styles.jumpCap}>full roster →</span>
                    </div>
                    <div className={styles.jump}>
                      Activity
                      <span className={styles.jumpCap}>full stream →</span>
                    </div>
                  </div>
                ) : null}
                <div className={styles.footNote}>
                  {mode === "current"
                    ? `${RECENT_AGENTS.filter((a) => a.state !== "idle").length} ready · ${NEEDS_ATTENTION.length} need you`
                    : `${lensCounts.moving} moving · ${lensCounts.needs} blocked`}
                </div>
              </div>
            </aside>

            <div className={styles.main} aria-hidden>
              <div className={styles.hero}>
                <div className={styles.heroGreet}>Good morning, Art.</div>
                <div className={styles.heroSub}>3 agents working · 2 asks open · synced 12s ago</div>
              </div>
              <div className={styles.block}>
                <div className={styles.blockLabel}>What&apos;s moving</div>
                <div className={styles.blockLines}>
                  <div className={`${styles.ghostLine} ${styles.ghostLineShort}`} />
                  <div className={styles.ghostLine} />
                  <div className={`${styles.ghostLine} ${styles.ghostLineShort}`} />
                </div>
              </div>
              <div className={styles.block}>
                <div className={styles.blockLabel}>Activity stream</div>
                <div className={styles.blockLines}>
                  <div className={styles.ghostLine} />
                  <div className={styles.ghostLine} />
                  <div className={styles.ghostLine} />
                  <div className={`${styles.ghostLine} ${styles.ghostLineShort}`} />
                </div>
              </div>
              <p className={styles.mainNote}>
                Center is intentionally dimmed — this study is the rail definition only.
              </p>
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

function CurrentRail() {
  const ready = RECENT_AGENTS.filter((a) => a.state !== "idle").length;

  return (
    <div className={styles.railScroll}>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span>Recent agents</span>
          <span className={styles.sectionMeta}>
            {ready} ready · {RECENT_AGENTS.length}
          </span>
        </div>
        {RECENT_AGENTS.map((a) => (
          <SidebarRow
            key={a.id}
            name={a.name}
            time={a.updated}
            sub={a.project}
            dot={a.state === "working" ? "working" : "neutral"}
          />
        ))}
        <button type="button" className={styles.seeAll}>
          all agents →
        </button>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span>Recent activity</span>
          <button type="button" className={styles.seeAll}>
            all
          </button>
        </div>
        {RECENT_ACTIVITY.map((a) => (
          <SidebarRow
            key={a.id}
            name={a.headline}
            time={a.time}
            sub={`${a.actor} · ${a.kind}`}
            dot="neutral"
          />
        ))}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span>Needs attention</span>
          <span className={styles.sectionMeta}>{NEEDS_ATTENTION.length}</span>
        </div>
        {NEEDS_ATTENTION.length === 0 ? (
          <div className={styles.empty}>All clear</div>
        ) : (
          NEEDS_ATTENTION.map((n) => (
            <SidebarRow
              key={n.id}
              name={n.title}
              time={n.time}
              sub={`${n.agent} · ${n.kind}`}
              dot="attn"
              unread
            />
          ))
        )}
      </section>
    </div>
  );
}

function LensRail({
  lens,
  setLens,
  counts,
}: {
  lens: Lens;
  setLens: (l: Lens) => void;
  counts: Record<Lens, number>;
}) {
  const rows = useMemo(() => {
    if (lens === "needs") {
      return NEEDS_ATTENTION.map((n) => ({
        id: n.id,
        name: n.title,
        time: n.time,
        sub: `${n.agent} · ${n.kind}`,
        dot: "attn" as const,
        unread: true,
      }));
    }
    if (lens === "moving") {
      return [
        ...RECENT_AGENTS.filter((a) => a.state === "working").map((a) => ({
          id: a.id,
          name: a.name,
          time: a.updated,
          sub: a.project,
          dot: "working" as const,
          unread: false,
        })),
        ...RECENT_ACTIVITY.slice(0, 2).map((a) => ({
          id: a.id,
          name: a.headline,
          time: a.time,
          sub: `${a.actor} · ${a.kind}`,
          dot: "working" as const,
          unread: false,
        })),
      ];
    }
    return [
      ...RECENT_AGENTS.filter((a) => a.state !== "working").map((a) => ({
        id: a.id,
        name: a.name,
        time: a.updated,
        sub: a.project,
        dot: "neutral" as const,
        unread: false,
      })),
      ...RECENT_ACTIVITY.slice(2).map((a) => ({
        id: a.id,
        name: a.headline,
        time: a.time,
        sub: `${a.actor} · ${a.kind}`,
        dot: "neutral" as const,
        unread: false,
      })),
    ];
  }, [lens]);

  return (
    <>
      <div className={styles.lensList}>
        {LENSES.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`${styles.lens} ${lens === l.id ? styles.lensOn : ""}`}
            onClick={() => setLens(l.id)}
          >
            <span className={styles.lensLabel}>
              {l.attn ? <span className={styles.lensDot} /> : null}
              {l.label}
            </span>
            <span className={styles.lensCount}>{counts[l.id]}</span>
          </button>
        ))}
      </div>
      <div className={styles.railScroll}>
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span>{LENSES.find((l) => l.id === lens)?.label}</span>
          </div>
          {rows.length === 0 ? (
            <div className={styles.empty}>Nothing here</div>
          ) : (
            rows.map((r) => (
              <SidebarRow
                key={r.id}
                name={r.name}
                time={r.time}
                sub={r.sub}
                dot={r.dot}
                unread={r.unread}
              />
            ))
          )}
        </section>
      </div>
    </>
  );
}

function SidebarRow({
  name,
  time,
  sub,
  dot,
  unread,
}: {
  name: string;
  time: string;
  sub?: string;
  dot: "working" | "neutral" | "attn";
  unread?: boolean;
}) {
  const dotClass =
    dot === "attn" ? styles.dotAttn : dot === "working" ? styles.dotWorking : styles.dotNeutral;

  return (
    <div className={`${styles.row} ${unread ? styles.rowUnread : ""}`}>
      <span className={`${styles.dot} ${dotClass}`} />
      <div className={styles.rowBody}>
        <div className={styles.rowTop}>
          <span className={styles.rowName}>{name}</span>
          <span className={styles.rowTime}>{time}</span>
        </div>
        {sub ? <span className={styles.rowSub}>{sub}</span> : null}
      </div>
    </div>
  );
}
