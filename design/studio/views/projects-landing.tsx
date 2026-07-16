"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Projects · Landing (unscoped /projects center)

   The rail owns project navigation. The unscoped center must earn its place
   with meta value: SHORTCUTS · RECENT PROJECTS · ACTIVE DIFFS. Three takes
   on the same content, switchable in place — pick one to port to
   packages/web/client/screens/projects/ProjectsInbox.tsx.

   Hard rules learned from review:
     · No pill-filters — anything that looks like a filter chip but isn't
       clickable reads as a lie (the Views filters died for this).
     · No raw transcript paths as titles — humanize (rollout time / uuid
       prefix) or don't show the row.
     · One emerald accent = attention only (needs-you · live), never chrome.
   ─────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import styles from "./projects-landing.module.css";

type RecentProject = {
  name: string;
  root: string;
  ago: string;
  live?: number;
  needs?: number;
};

type ActiveDiff = {
  project: string;
  branch: string;
  add: number;
  del: number;
  changed: number;
};

const RECENTS: RecentProject[] = [
  { name: "openscout", root: "~/dev/openscout", ago: "23s", live: 2 },
  { name: "blink", root: "~/dev/blink", ago: "26s", live: 2 },
  { name: "talkie", root: "~/dev/talkie", ago: "4d", needs: 1 },
  { name: "hudson", root: "~/dev/hudson", ago: "1h" },
  { name: "preframe", root: "~/dev/preframe", ago: "2h" },
  { name: "pi scout", root: "~/dev/pi-scout", ago: "3h" },
  { name: "premotion", root: "~/dev/premotion", ago: "4h" },
  { name: "dewey", root: "~/dev/dewey", ago: "6h" },
];

const DIFFS: ActiveDiff[] = [
  { project: "openscout", branch: "feat/meta-landing", add: 184, del: 62, changed: 9 },
  { project: "talkie", branch: "fix/bridge-crypto", add: 128, del: 40, changed: 7 },
  { project: "hudson", branch: "feat/keyboard-layer", add: 64, del: 9, changed: 5 },
  { project: "openscout", branch: "scout/rail-cleanup", add: 18, del: 96, changed: 4 },
  { project: "blink", branch: "main", add: 42, del: 11, changed: 3 },
];

const RAIL_PROJECTS = [
  { name: "openscout", live: true },
  { name: "blink", live: true },
  { name: "talkie", needs: true },
  { name: "hudson" },
  { name: "preframe" },
  { name: "pi scout" },
  { name: "premotion" },
];

type Take = "rows" | "ledger" | "editorial";

const TAKES: { id: Take; label: string; note: string }[] = [
  { id: "rows", label: "A · Rows", note: "what shipped — hairline rows + ghost shortcuts" },
  { id: "ledger", label: "B · Ledger", note: "dense aligned columns, mono header bands" },
  { id: "editorial", label: "C · Editorial", note: "quietest — no boxes, text-led" },
];

/* ── shared bits ──────────────────────────────────────────────────────────── */

function dotClass(item: { needs?: number | boolean; live?: number | boolean }): string {
  return `${styles.dot} ${item.needs ? styles.dotNeeds : item.live ? styles.dotLive : ""}`;
}

function Shortcuts({ variant }: { variant: Take }) {
  if (variant === "editorial") {
    return (
      <div className={styles.edShortcuts}>
        <button type="button">＋ add project</button>
        <button type="button">⌕ search agents &amp; sessions</button>
        <button type="button">⇥ browse sessions</button>
      </div>
    );
  }
  if (variant === "ledger") {
    return (
      <div className={styles.ldShortcuts}>
        <button type="button"><kbd>＋</kbd> add project</button>
        <button type="button"><kbd>/</kbd> search</button>
        <button type="button"><kbd>⇥</kbd> sessions</button>
      </div>
    );
  }
  return (
    <div className={styles.rwShortcuts}>
      <button type="button" className={styles.rwShortcut}>＋ Add project</button>
      <button type="button" className={styles.rwShortcut}>⌕ Search agents &amp; sessions</button>
      <button type="button" className={styles.rwShortcut}>⇥ Browse sessions</button>
    </div>
  );
}

function SectionHead({ label, count, variant }: { label: string; count: number; variant: Take }) {
  return (
    <div className={variant === "editorial" ? styles.edSectionHead : variant === "ledger" ? styles.ldSectionHead : styles.rwSectionHead}>
      <span>{label}</span>
      <span className={styles.sectionCount}>{count}</span>
    </div>
  );
}

function NeedsTag({ n, variant }: { n: number; variant: Take }) {
  if (variant === "editorial") return <em className={styles.edNeeds}>{n} needs you</em>;
  return <b className={styles.needsTag}>{n} needs you</b>;
}

/* ── take A · rows (shipped) ──────────────────────────────────────────────── */

function RowsTake() {
  return (
    <>
      <Shortcuts variant="rows" />
      <SectionHead label="Recent projects" count={44} variant="rows" />
      {RECENTS.map((p) => (
        <button key={p.name} type="button" className={styles.rwRow}>
          <span className={dotClass(p)} />
          <span className={styles.rwRowMain}>
            <span className={styles.rwRowTitle}>{"/"}{p.name}</span>
            <span className={styles.rwRowRoot}>{p.root}</span>
          </span>
          <span className={styles.rwRowMeta}>
            {p.needs ? <NeedsTag n={p.needs} variant="rows" /> : null}
            {p.live ? <span>{p.live} live</span> : null}
            <time>{p.ago}</time>
          </span>
        </button>
      ))}
      <SectionHead label="Active diffs" count={DIFFS.length} variant="rows" />
      {DIFFS.map((d) => (
        <div key={`${d.project}:${d.branch}`} className={styles.rwDiffRow}>
          <button type="button" className={styles.rwDiffMain}>
            <span className={styles.rwDiffProject}>{"/"}{d.project}</span>
            <span className={styles.rwDiffBranch}>{d.branch}</span>
          </button>
          <span className={styles.churn}>
            <b className={styles.churnAdd}>+{d.add}</b>
            <b className={styles.churnDel}>−{d.del}</b>
            <small>{d.changed} changed</small>
          </span>
          <button type="button" className={styles.rwDiffOpen}>View diff</button>
        </div>
      ))}
    </>
  );
}

/* ── take B · ledger ──────────────────────────────────────────────────────── */

function LedgerTake() {
  return (
    <>
      <Shortcuts variant="ledger" />
      <SectionHead label="Recent projects" count={44} variant="ledger" />
      <div className={styles.ldTable}>
        <div className={`${styles.ldCols} ${styles.ldColsHead}`}>
          <span>project</span><span>root</span><span>signal</span><span>ago</span>
        </div>
        {RECENTS.map((p) => (
          <button key={p.name} type="button" className={`${styles.ldCols} ${styles.ldRow}`}>
            <span className={styles.ldName}>
              <span className={dotClass(p)} />
              {"/"}{p.name}
            </span>
            <span className={styles.ldRoot}>{p.root}</span>
            <span className={styles.ldSignal}>
              {p.needs ? <NeedsTag n={p.needs} variant="ledger" /> : p.live ? `${p.live} live` : "—"}
            </span>
            <span className={styles.ldAgo}>{p.ago}</span>
          </button>
        ))}
      </div>
      <SectionHead label="Active diffs" count={DIFFS.length} variant="ledger" />
      <div className={styles.ldTable}>
        <div className={`${styles.ldDiffCols} ${styles.ldColsHead}`}>
          <span>project</span><span>branch</span><span>churn</span><span></span>
        </div>
        {DIFFS.map((d) => (
          <div key={`${d.project}:${d.branch}`} className={`${styles.ldDiffCols} ${styles.ldRow}`}>
            <span className={styles.ldName}>{"/"}{d.project}</span>
            <span className={styles.ldRoot}>{d.branch}</span>
            <span className={styles.churn}>
              <b className={styles.churnAdd}>+{d.add}</b>
              <b className={styles.churnDel}>−{d.del}</b>
              <small>{d.changed}</small>
            </span>
            <button type="button" className={styles.ldDiffOpen}>diff →</button>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── take C · editorial ───────────────────────────────────────────────────── */

function EditorialTake() {
  return (
    <>
      <Shortcuts variant="editorial" />
      <SectionHead label="Recent projects" count={44} variant="editorial" />
      {RECENTS.map((p) => (
        <button key={p.name} type="button" className={styles.edRow}>
          <span className={styles.edRowTitle}>
            {"/"}{p.name}
            {p.live ? <i className={styles.edLive}>{p.live} live</i> : null}
            {p.needs ? <NeedsTag n={p.needs} variant="editorial" /> : null}
          </span>
          <span className={styles.edRowAgo}>{p.ago}</span>
        </button>
      ))}
      <SectionHead label="Active diffs" count={DIFFS.length} variant="editorial" />
      {DIFFS.map((d) => (
        <button key={`${d.project}:${d.branch}`} type="button" className={styles.edRow}>
          <span className={styles.edRowTitle}>
            {"/"}{d.project} <span className={styles.edDim}>{d.branch}</span>
          </span>
          <span className={styles.edDiffMeta}>
            <b className={styles.churnAdd}>+{d.add}</b>
            <b className={styles.churnDel}>−{d.del}</b>
            <span className={styles.edDim}>{d.changed} files</span>
            <span className={styles.edArrow}>↗</span>
          </span>
        </button>
      ))}
    </>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

const NOTES: { title: string; body: React.ReactNode }[] = [
  { title: "Nothing pill-shaped", body: <>Every take keeps shortcuts + stats as <b>text or bordered rows</b>, never chips. Anything that looks like a filter but isn't one is a lie — that killed the Views row.</> },
  { title: "Rows are honest destinations", body: <>Recent rows open the project; diff rows open the scoped Repos view with a diff drill. Every row answers a click with the place you expected.</> },
  { title: "Accent = attention only", body: <>Emerald marks <b>needs-you and live</b>, nothing else. Counts, labels, and chrome stay dim so the one color keeps its meaning.</> },
  { title: "Titles are human", body: <>No raw <code>.jsonl</code> paths, ever. Rows that can't be humanized (rollout time, uuid prefix) don't render.</> },
  { title: "The rail navigates", body: <>The center never re-lists all 44 projects — 8 recents is a <b>jump board</b>, the full tree stays in the rail where search lives.</> },
];

const LEDGER: { take: string; verdict: string }[] = [
  { take: "A · Rows", verdict: "Shipped baseline. Ghost buttons still flirt with pill territory; section heads duplicate the count at right." },
  { take: "B · Ledger", verdict: "Best at 44-project density — aligned columns make signals comparable. Costs a header band per section; reads more console than calm." },
  { take: "C · Editorial", verdict: "Recommended. Nothing boxed, nothing to mistake for a filter; text-led with the most air. Live/needs ride the title line as italic text, not badges." },
];

export default function ProjectsLandingStudy() {
  const [take, setTake] = useState<Take>("editorial");

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · projects-landing
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Projects · Landing
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The unscoped /projects center: shortcuts · recent projects · active diffs. Three takes on the
          same content, switched in place. The rail is a static stub — only the center is under design.
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
          <nav className={styles.nav}>
            <div className={styles.brand}>
              <span className={styles.brandMark} />
              scout
            </div>
            <div className={styles.navTabs}>
              <span className={styles.navTab}>home</span>
              <span className={styles.navTabActive}>projects</span>
              <span className={styles.navTab}>chat</span>
              <span className={styles.navTab}>repos</span>
            </div>
          </nav>

          <div className={styles.body}>
            <aside className={styles.rail}>
              <div className={styles.railFind}>⌕ find project or session</div>
              <div className={styles.railHead}>projects</div>
              {RAIL_PROJECTS.map((p) => (
                <div key={p.name} className={styles.railRow}>
                  <span className={dotClass(p)} />
                  <span className={styles.railName}>{"/"}{p.name}</span>
                </div>
              ))}
              <div className={styles.railDisclosure}>▸ all projects · 37 quiet</div>
            </aside>

            <div className={styles.center}>
              <div className={styles.centerHead}>
                <span className={styles.centerTitle}>Projects</span>
                <span className={styles.centerDigest}>44 tracked</span>
              </div>
              {take === "rows" ? <RowsTake /> : take === "ledger" ? <LedgerTake /> : <EditorialTake />}
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
