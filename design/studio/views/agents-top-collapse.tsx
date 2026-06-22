"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Agents · Top Collapse

   The live Agents page stacks five control bands before the first card:
   global nav · left-rail (search + WORKING/READY/NOT READY segmented) ·
   the s-atop-fbar one-liner (filter search · cards/tree · time · harness chips ·
   status pills · clear) · the observed-harness-families strip · project header.
   Two searches, two status filters, ~seven operable controls.

   Thesis: the page should lead with one decision — cards vs tree — and one
   search that carries every filter (type `claude`, `codex`, `working`,
   `openscout`). Status is roster vocab → deleted, shown as an in-card activity
   signal instead. Harness folds into search. Time keeps one quiet escape hatch.

   Three takes, switchable in place:
     Before    — faithful recreation of today's pile (7 controls)
     Tucked    — middle ground: view · search · one `filters` disclosure (3)
     Ruthless  — view (hero) + search-carries-everything + time hint (2)  ◀ rec
   ─────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import styles from "./agents-top-collapse.module.css";

type Mode = "before" | "tucked" | "ruthless";

const MODES: { id: Mode; label: string; count: string; rec?: boolean }[] = [
  { id: "before", label: "Before", count: "7 controls" },
  { id: "tucked", label: "Tucked", count: "3", rec: true },
  { id: "ruthless", label: "Ruthless", count: "2" },
];

const PROJECTS = [
  { id: "openscout", name: "openscout", count: 14, on: true },
  { id: "premotion", name: "premotion", count: 2 },
  { id: "preframe", name: "preframe", count: 2 },
  { id: "pi-scout", name: "pi scout", count: 1 },
  { id: "iris", name: "iris", count: 1 },
  { id: "hudson", name: "hudson", count: 7 },
  { id: "dewey", name: "dewey", count: 2 },
  { id: "talkie", name: "talkie", count: 11 },
];

type Agent = {
  name: string;
  working: boolean;
  last: string;
  sub: string;
  meta: string;
};

const AGENTS: Agent[] = [
  { name: "Claude", working: true, last: "6s", sub: "Acknowledged — picking up the inspector polish pass next.", meta: "main · 1 session" },
  { name: "Grok", working: true, last: "35m", sub: "grok live ok", meta: "main" },
  { name: "Openscout", working: false, last: "35m", sub: "Idle since the v1 card review landed.", meta: "main · 1 session" },
  { name: "Openscout Card T5aez", working: true, last: "35m", sub: "Answer / review: the v1 card shape, then port to web.", meta: "main · 2 sessions" },
  { name: "Openscout Card Z9", working: true, last: "now", sub: "Wiring the harness families readout into the header.", meta: "main" },
  { name: "Scout", working: true, last: "now", sub: "Message stored for Scout. Will resume on next tick.", meta: "1 session · 1 active" },
];

const HARNESSES: { name: string; count: number }[] = [
  { name: "claude", count: 69 },
  { name: "codex", count: 33 },
  { name: "pi", count: 7 },
];

const STATUSES: { label: string; count: number }[] = [
  { label: "working", count: 41 },
  { label: "ready", count: 22 },
  { label: "not ready", count: 6 },
];

const TIMES = ["1h", "24h", "7d", "all"];

const LEDGER: { control: string; verdict: string; cls: string; note: React.ReactNode }[] = [
  { control: "cards / tree", verdict: "keep", cls: styles.verdictKeep, note: <>The one real <b>choose-your-own-adventure</b> — flat browse vs project→agent→session. Promoted to the hero.</> },
  { control: "two search fields", verdict: "merge", cls: styles.verdictMerge, note: <>Rail search + toolbar filter were the same job. <b>One search</b>, and it carries harness + activity + text.</> },
  { control: "status filter ×2", verdict: "kill", cls: styles.verdictKill, note: <>Roster vocab, and basically degenerate. Activity becomes an <b>in-card signal</b> (dot · last-active), not a control.</> },
  { control: "harness chips", verdict: "fold", cls: styles.verdictDemote, note: <>Real axis, but a variable-width chip pile. Type <b>claude</b> / <b>codex</b> in search instead — one keystroke.</> },
  { control: "time 1h/24h/7d/all", verdict: "demote", cls: styles.verdictDemote, note: <>Can't be typed, so it survives — as a single quiet <b>24h ▾</b> hint, defaulted, off the front line.</> },
  { control: "harness-families strip", verdict: "demote", cls: styles.verdictDemote, note: <>A diagnostic, not primary. Collapsed out of the default top; one click when you want the topology.</> },
];

export default function AgentsTopCollapsePage() {
  const [mode, setMode] = useState<Mode>("tucked");

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · agents-top-collapse
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agents · Top Collapse
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The live Agents top stacks five control bands — two searches, two status filters, time, harness, view —
          before the first card. Lead with one decision (cards vs tree) and one search that carries every filter.
          Status is roster vocab → deleted; harness and time recede. Toggle the three takes in place.
        </p>
      </header>

      <div className={styles.wrap}>
        <div className={styles.modeToggle} role="group" aria-label="Treatment">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${styles.modeBtn} ${mode === m.id ? styles.modeBtnOn : ""}`}
              onClick={() => setMode(m.id)}
            >
              {m.rec && <span className={styles.recDot} title="recommended" />}
              {m.label}
              <span className={styles.modeCount}>{m.count}</span>
            </button>
          ))}
        </div>

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
            {renderRail(mode)}
            <div className={styles.main}>
              {renderTop(mode)}
              <Content />
            </div>
          </div>
        </div>

        <section>
          <div className={styles.ledgerHead}>What happens to each control</div>
          <div className={styles.ledger}>
            {LEDGER.map((row) => (
              <div key={row.control} className={styles.ledgerCell}>
                <div className={styles.ledgerTop}>
                  <span className={styles.ledgerControl}>{row.control}</span>
                  <span className={`${styles.verdict} ${row.cls}`}>{row.verdict}</span>
                </div>
                <div className={styles.ledgerNote}>{row.note}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

/* ── left rail ────────────────────────────────────────────────────────────── */
function renderRail(mode: Mode) {
  const before = mode === "before";
  return (
    <aside className={styles.rail}>
      <div className={styles.railHead}>
        navigation <span className={styles.railKbd}>N</span>
      </div>
      {before && (
        <>
          <div className={styles.railSearch}>Search agents or session IDs…</div>
          <div className={styles.seg}>
            <span className={`${styles.segBtn} ${styles.segBtnOn}`}>Working</span>
            <span className={styles.segBtn}>Ready</span>
            <span className={styles.segBtn}>Not ready</span>
          </div>
        </>
      )}
      <div className={styles.railSubhead}>projects</div>
      <div className={styles.projList}>
        {PROJECTS.map((p) => (
          <div key={p.id} className={`${styles.projRow} ${p.on ? styles.projRowOn : ""}`}>
            <span>{p.name}</span>
            <span className={styles.projCount}>{p.count}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ── the top, per mode ────────────────────────────────────────────────────── */
function renderTop(mode: Mode) {
  if (mode === "before") return <BeforeTop />;
  if (mode === "tucked") return <TuckedTop />;
  return <RuthlessTop />;
}

function BeforeTop() {
  return (
    <>
      <div className={styles.fbar}>
        <div className={styles.fsearch}>
          <span className={styles.fsearchPrompt}>▸</span>
          filter projects · agents · sessions
          <span className={styles.fsearchKbd}>/</span>
        </div>
        <div className={styles.viewToggle}>
          <span className={`${styles.viewBtn} ${styles.viewBtnOn}`}>cards</span>
          <span className={styles.viewBtn}>tree</span>
        </div>
        <span className={styles.flabel}>time</span>
        {TIMES.map((t) => (
          <span key={t} className={`${styles.pill} ${t === "24h" ? styles.pillOn : ""}`}>{t}</span>
        ))}
        <span className={styles.flabel}>harness</span>
        {HARNESSES.map((h) => (
          <span key={h.name} className={styles.pill}>
            {h.name}
            <span className={styles.pillCt}>{h.count}</span>
          </span>
        ))}
        <span className={styles.flabel}>status</span>
        {STATUSES.map((s) => (
          <span key={s.label} className={styles.pill}>
            {s.label}
            <span className={styles.pillCt}>{s.count}</span>
          </span>
        ))}
        <span className={styles.spacer} />
        <span className={styles.pill}>clear</span>
      </div>
      <div className={styles.topology}>
        <span className={styles.topologyLabel}>Observed harness families</span>
        <span className={styles.topologyFam}>claude</span>
        <span className={styles.topologyFam}>codex</span>
        <span className={styles.topologyFam}>pi</span>
      </div>
    </>
  );
}

function TuckedTop() {
  return (
    <div className={styles.tuckRow}>
      <div className={styles.tuckView}>
        <span className={`${styles.tuckViewBtn} ${styles.tuckViewBtnOn}`}>cards</span>
        <span className={styles.tuckViewBtn}>tree</span>
      </div>
      <div className={styles.tuckSearch}>
        <span className={styles.tuckSearchPrompt}>▸</span>
        search agents, projects, sessions…
        <span className={styles.tuckSearchKbd}>/</span>
      </div>
      <span className={styles.tuckFilters}>
        filters <span className={styles.tuckFiltersCaret}>▾</span>
      </span>
    </div>
  );
}

function RuthlessTop() {
  return (
    <div className={styles.controlRow}>
      <div className={styles.viewHero}>
        <span className={`${styles.viewHeroBtn} ${styles.viewHeroBtnOn}`}>
          <span className={styles.viewHeroName}>cards</span>
          <span className={styles.viewHeroHint}>browse the fleet</span>
        </span>
        <span className={styles.viewHeroBtn}>
          <span className={styles.viewHeroName}>tree</span>
          <span className={styles.viewHeroHint}>project → agent → session</span>
        </span>
      </div>
      <div className={styles.searchBig}>
        <div className={styles.searchBigField}>
          <span className={styles.searchBigPrompt}>▸</span>
          search fleet…
          <span className={styles.searchBigKbd}>/</span>
        </div>
        <div className={styles.searchScopes}>
          <span className={styles.searchScopesLead}>scopes</span>
          <span className={styles.scopeTok}>claude</span>
          <span className={styles.scopeTok}>codex</span>
          <span className={styles.scopeTok}>working</span>
          <span className={styles.scopeTok}>openscout</span>
        </div>
      </div>
      <span className={styles.timeHint}>
        24h <span className={styles.timeHintCaret}>▾</span>
      </span>
    </div>
  );
}

/* ── content (shared) ─────────────────────────────────────────────────────── */
function Content() {
  return (
    <>
      <div className={styles.projHeader}>
        <span className={styles.projTitle}>openscout</span>
        <span className={styles.projPath}>~/dev/openscout</span>
        <span className={styles.projStat}>14 agents · 12 sessions · last now</span>
      </div>
      <div className={styles.sectionLabel}>agents</div>
      <div className={styles.cards}>
        {AGENTS.map((a) => (
          <div key={a.name} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={`${styles.dot} ${a.working ? styles.dotWorking : styles.dotIdle}`} />
              <span className={styles.cardName}>{a.name}</span>
              <span className={styles.cardLast}>{a.last}</span>
            </div>
            <div className={styles.cardSub}>{a.sub}</div>
            <div className={styles.cardMeta}>{a.meta}</div>
          </div>
        ))}
      </div>
    </>
  );
}
