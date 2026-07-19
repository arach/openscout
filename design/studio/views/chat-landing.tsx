"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Chat · Landing (unscoped /chat center — messages route, nothing selected)

   The rail (ChatLeft) is the best "all agents in view" list in the app —
   grouped, unread dots, live ask states. It stays. The center under design
   today re-lists that same content as a card grid, adds 1/2/4 layout chrome
   per card, carries marketing copy, and ignores the rail's own filter route
   state. Three takes on the unscoped center:

     A · Grid       — control, what ships today, problem-flagged
     B · Jump board — shortcuts · unread · a few recents (recommended)
     C · Editorial  — the same content, text-led and quietest

   Nav stub shows the shipped Model B chrome (Home · Projects · Sessions ·
   Chat + System). Only the center is under design.
   ─────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import styles from "./chat-landing.module.css";

type Take = "grid" | "board" | "editorial";

const TAKES: { id: Take; label: string; note: string }[] = [
  { id: "grid", label: "A · Grid", note: "control — what ships today, flagged" },
  { id: "board", label: "B · Jump board", note: "recommended — shortcuts · unread · recent" },
  { id: "editorial", label: "C · Editorial", note: "quietest — same content, text-led" },
];

type Convo = {
  name: string;
  kind: "dm" | "channel";
  preview: string;
  ago: string;
  unread?: number;
  msgs?: number;
  participants?: number;
};

const UNREAD: Convo[] = [
  { name: "# scout-ops", kind: "channel", preview: "kimi: nav study is up — three models, B recommended", ago: "2m", unread: 5, msgs: 214, participants: 6 },
  { name: "kimi · studio nav study", kind: "dm", preview: "screenshots of all three takes attached", ago: "4m", unread: 2, msgs: 38 },
];

const RECENT: Convo[] = [
  { name: "claude · fix broker retry loop", kind: "dm", preview: "patching the backoff now", ago: "12m", msgs: 61 },
  { name: "talkie", kind: "dm", preview: "bridge crypto regression found", ago: "1h", msgs: 17 },
  { name: "hudson", kind: "dm", preview: "keyboard layer rebased", ago: "3h", msgs: 9 },
  { name: "# blink-standup", kind: "channel", preview: "notes posted", ago: "5h", msgs: 88, participants: 4 },
];

/* ── shared bits ──────────────────────────────────────────────────────────── */

function Flag({ n }: { n: number }) {
  return <sup className={styles.flag}>{n}</sup>;
}

function NavStub() {
  return (
    <nav className={styles.nav}>
      <div className={styles.brand}>
        <span className={styles.brandMark} />
        scout
      </div>
      <div className={styles.navTabs}>
        <span className={styles.navTab}>home</span>
        <span className={styles.navTab}>projects</span>
        <span className={styles.navTab}>sessions</span>
        <span className={styles.navTabActive}>chat</span>
      </div>
      <div className={styles.navUtils}>
        <span className={styles.navUtil}>⌘K</span>
        <span className={styles.navUtil}>system ▾</span>
        <span className={styles.navUtil}>⚙</span>
      </div>
    </nav>
  );
}

function RailStub() {
  return (
    <aside className={styles.rail}>
      <div className={styles.railTabs}>
        <span className={styles.railTabOn}>all</span>
        <span className={styles.railTab}>private</span>
        <span className={styles.railTab}>shared</span>
      </div>
      <div className={styles.railFind}>⌕ filter…&nbsp;&nbsp;(/)</div>
      <div className={styles.railRow}>
        <span className={styles.railName}># scout-ops</span>
        <span className={styles.railMetaAccent}>5 new · 2m</span>
      </div>
      <div className={styles.railRow}>
        <span className={styles.railCaret}>▾</span>
        <span className={styles.railName}>openscout</span>
        <span className={styles.railMeta}>2/3 · 4m</span>
      </div>
      <div className={`${styles.railRow} ${styles.railRowDepth}`}>
        <span className={styles.dotLive} />
        <span className={styles.railName}>kimi · studio nav study</span>
        <span className={styles.railMetaAccent}>2 · 4m</span>
      </div>
      <div className={`${styles.railRow} ${styles.railRowDepth}`}>
        <span className={styles.dotLive} />
        <span className={styles.railName}>claude · fix broker retry</span>
        <span className={styles.railMeta}>working · 12m</span>
      </div>
      <div className={styles.railRow}>
        <span className={styles.dotNeeds} />
        <span className={styles.railName}>talkie</span>
        <span className={styles.railMeta}>1h</span>
      </div>
      <div className={styles.railRow}>
        <span className={styles.dot} />
        <span className={styles.railName}>hudson</span>
        <span className={styles.railMeta}>3h</span>
      </div>
      <div className={styles.railNote}>the rail is good — grouped, unread, live ask states. it stays.</div>
    </aside>
  );
}

/* ── take A · grid (control) ──────────────────────────────────────────────── */

function GridCard({ convo, flagSizes }: { convo: Convo; flagSizes?: boolean }) {
  return (
    <article className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.cardKind}>{convo.kind === "dm" ? "direct message" : "shared channel"}</span>
        <span className={styles.cardTime}>{convo.ago}</span>
      </div>
      <div className={styles.cardHeading}>
        <span className={styles.cardTitle}>{convo.name}</span>
        <span className={styles.sizeControls}>
          <span className={styles.sizeOptOn}>1</span>
          <span className={styles.sizeOpt}>2</span>
          <span className={styles.sizeOpt}>4</span>
          {flagSizes ? <Flag n={2} /> : null}
        </span>
      </div>
      <span className={styles.cardPreview}>{convo.preview}</span>
      <span className={styles.cardFoot}>
        <span>{convo.msgs ?? 0} msgs</span>
        {convo.participants ? <span>{convo.participants} participants</span> : null}
      </span>
    </article>
  );
}

function GridTake() {
  return (
    <>
      <div className={styles.gridHead}>
        <div>
          <div className={styles.gridEyebrow}>Conversations</div>
          <div className={styles.gridTitle}>Recent chats<Flag n={1} /></div>
          <div className={styles.gridCopy}>
            All chats sorted by latest message. Promote any card into a medium tile or a 2×2 live chat panel.<Flag n={3} />
          </div>
        </div>
        <div className={styles.gridCount}><strong>6</strong><span>chats</span></div>
      </div>
      <div className={styles.grid}>
        {[...UNREAD, ...RECENT].map((c, index) => (
          <div key={c.name} className={styles.cardWrap}>
            <GridCard convo={c} flagSizes={index === 0} />
          </div>
        ))}
      </div>
      <div className={styles.legend}>
        <span><b>1</b> re-lists the rail — same conversations, same sort, minus grouping and ask states</span>
        <span><b>2</b> 1/2/4 layout chrome on every card + a localStorage schema, for what Home/Lanes do better</span>
        <span><b>3</b> marketing copy on chrome — and the grid ignores the rail’s own filter route state</span>
      </div>
    </>
  );
}

/* ── take B · jump board (recommended) ────────────────────────────────────── */

function BoardRow({ convo, showUnread }: { convo: Convo; showUnread?: boolean }) {
  return (
    <button type="button" className={styles.rwRow}>
      <span className={styles.rwRowMain}>
        <span className={styles.rwRowTitle}>{convo.name}</span>
        <span className={styles.rwRowPreview}>{convo.preview}</span>
      </span>
      <span className={styles.rwRowMeta}>
        {showUnread && convo.unread ? <span className={styles.unreadMeta}>{convo.unread} new</span> : null}
        <time>{convo.ago}</time>
      </span>
    </button>
  );
}

function BoardTake() {
  return (
    <>
      <div className={styles.rwShortcuts}>
        <button type="button" className={styles.rwShortcut}>＋ New chat</button>
        <button type="button" className={styles.rwShortcut}>⌕ Search conversations</button>
        <button type="button" className={styles.rwShortcut}>＃ Browse channels</button>
      </div>
      <div className={styles.rwSectionHead}>
        <span>Unread</span>
        <span className={styles.sectionCount}>{UNREAD.length}</span>
      </div>
      {UNREAD.map((c) => <BoardRow key={c.name} convo={c} showUnread />)}
      <div className={styles.rwSectionHead}>
        <span>Recent</span>
        <span className={styles.sectionCount}>{RECENT.length}</span>
      </div>
      {RECENT.map((c) => <BoardRow key={c.name} convo={c} />)}
      <div className={styles.rwNote}>the rail owns the full list — filters and grouping live there</div>
    </>
  );
}

/* ── take C · editorial ───────────────────────────────────────────────────── */

function EditorialTake() {
  return (
    <>
      <div className={styles.edShortcuts}>
        <button type="button">＋ new chat</button>
        <button type="button">⌕ search conversations</button>
        <button type="button">＃ browse channels</button>
      </div>
      <div className={styles.edSectionHead}>
        <span>Unread</span>
        <span className={styles.sectionCount}>{UNREAD.length}</span>
      </div>
      {UNREAD.map((c) => (
        <button key={c.name} type="button" className={styles.edRow}>
          <span className={styles.edRowTitle}>
            {c.name}
            <span className={styles.edPreview}>{c.preview}</span>
          </span>
          <span className={styles.edRowMeta}>
            <em className={styles.edUnread}>{c.unread} new</em>
            <span>{c.ago}</span>
          </span>
        </button>
      ))}
      <div className={styles.edSectionHead}>
        <span>Recent</span>
        <span className={styles.sectionCount}>{RECENT.length}</span>
      </div>
      {RECENT.map((c) => (
        <button key={c.name} type="button" className={styles.edRow}>
          <span className={styles.edRowTitle}>
            {c.name}
            <span className={styles.edPreview}>{c.preview}</span>
          </span>
          <span className={styles.edRowMeta}>
            <span>{c.ago}</span>
            <span className={styles.edArrow}>↗</span>
          </span>
        </button>
      ))}
      <div className={styles.edNote}>the rail owns the full list — filters and grouping live there</div>
    </>
  );
}

/* ── notes + ledger ───────────────────────────────────────────────────────── */

const NOTES: { title: string; body: React.ReactNode }[] = [
  { title: "The rail navigates", body: <>The center never re-lists the rail. Unread + a few recents is a <b>jump board</b>; the full grouped tree — with its filters and sort — stays in the rail where it belongs.</> },
  { title: "Unread is chat's attention", body: <>The landing surfaces <b>unread and awaiting-reply</b> only. Agent ask-states (working · needs you) stay as rail row context and on Home — the one inbox. One accent = unread.</> },
  { title: "No layout chrome", body: <>No 1/2/4 size buttons, no per-card layout persistence. If multi-panel chat comes back, it returns as <b>one explicit action</b>, not three buttons on every card.</> },
  { title: "One address per conversation", body: <>A channel row always opens the channel, a DM row always the thread — the destination never depends on which tab you happened to be on.</> },
  { title: "Filters own the rail", body: <>All / Private / Shared and sort affect the rail only. The URL never claims a filter state the center ignores.</> },
];

const LEDGER: { take: string; verdict: string }[] = [
  { take: "A · Grid", verdict: "Control. Re-lists the rail in flatter form, three layout buttons per card, marketing copy on chrome, and it ignores the rail’s own filter route state. The 2×2 live panel is the one idea worth keeping in a drawer." },
  { take: "B · Jump board", verdict: "Recommended. Shortcuts + unread + a few recents; the rail keeps the tree. Matches the shipped projects landing, so the two surfaces teach one habit." },
  { take: "C · Editorial", verdict: "Shipped. Ported to MessagesScreen.tsx (shortcuts + disjoint unread/recent, one-address routing incl. the rail fix, s-conv-board-* styles, grid + 1/2/4 + localStorage deleted). Quietest — same content, text-led, previews ride the title line." },
];

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function ChatLandingStudy() {
  const [take, setTake] = useState<Take>("board");

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · chat-landing
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Chat · Landing
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The unscoped /chat center — messages route, no conversation selected. Today a card grid
          re-lists the rail with per-card layout chrome; these are three takes on what should be
          there instead. The rail and the nav chrome are static stubs — only the center is under
          design.
        </p>
      </header>

      <div className={styles.takeSwitch}>
        {TAKES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.takeBtn} ${take === t.id ? styles.takeBtnOn : ""}`}
            onClick={() => setTake(t.id)}
          >
            <span>{t.label}</span>
            <span className={styles.takeNote}>{t.note}</span>
          </button>
        ))}
      </div>

      <div className={styles.wrap}>
        <div className={styles.frame}>
          <NavStub />
          <div className={styles.body}>
            <RailStub />
            <div className={styles.center}>
              {take === "grid" ? <GridTake /> : take === "board" ? <BoardTake /> : <EditorialTake />}
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

        <section>
          <div className={styles.noteHead}>Ledger</div>
          <div className={styles.ledgerTable}>
            {LEDGER.map((row) => (
              <div key={row.take} className={styles.ledgerRow}>
                <span className={styles.ledgerTake}>{row.take}</span>
                <span className={styles.ledgerVerdict}>{row.verdict}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
