"use client";

/* ───────────────────────────────────────────────────────────────────────────
   App nav · three structural models

   The /projects work exposed IA problems that live one level up: two inboxes
   (home route = `inbox`, projects center = ProjectsInbox), sessions reachable
   three ways, an Ops drawer with 10 items mixing user surfaces with
   diagnostics, a deprecated directory still shipping, and a `nav.clean` flag
   that forks the app's personality instead of fixing it.

   Framing posture: Scout is an OVERVIEW-FIRST platform — not an IDE or ADE
   replacement. It watches, summarizes, and coordinates; the doing happens in
   the editor, the terminal, and the agentic harness. Every deep surface is a
   preview with a handoff, never a workbench.

   Decision: B · Work nouns is chosen. C · Project-first is shelved — people
   work in an IDE/ADE and open Scout to keep ALL agents in view; the axis is
   agents across projects, and a project-first spine makes you pick a scope
   before showing you anything (it also kills the global Sessions page, the
   very surface that does that job).

   Three models, switchable in place, with the full route inventory (24
   routes + 7 ops modes, from packages/web/client/lib/types.ts) mapped onto
   each:
     A · Status quo     — control, annotated with the problems
     B · Work nouns     — CHOSEN: Home · Projects · Sessions · Chat + ⌘K + System
     C · Project-first  — SHELVED: the project rail as the nav
   ─────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import styles from "./app-nav.module.css";

type Model = "quo" | "nouns" | "first";

const MODELS: { id: Model; label: string; note: string }[] = [
  { id: "quo", label: "A · Status quo", note: "control — 6 tabs, 14 subnav items, flagged" },
  { id: "nouns", label: "B · Work nouns", note: "chosen — 4 tabs + ⌘K + system drawer" },
  { id: "first", label: "C · Project-first", note: "shelved — the axis is agents across projects" },
];

/* ── shared bits ──────────────────────────────────────────────────────────── */

function Flag({ n }: { n: number }) {
  return <sup className={styles.flag}>{n}</sup>;
}

function Brand() {
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark} />
      scout
    </div>
  );
}

function dotClass(item: { needs?: boolean; live?: boolean }): string {
  return `${styles.dot} ${item.needs ? styles.dotNeeds : item.live ? styles.dotLive : ""}`;
}

const RAIL_PROJECTS = [
  { name: "openscout", live: true, selected: true },
  { name: "blink", live: true },
  { name: "talkie", needs: true },
  { name: "hudson" },
  { name: "preframe" },
  { name: "pi scout" },
  { name: "premotion" },
];

/* ── model A · status quo ─────────────────────────────────────────────────── */

function QuoFrame() {
  return (
    <div className={styles.frame}>
      <nav className={styles.nav}>
        <Brand />
        <div className={styles.navTabs}>
          <span className={styles.navTab}>home<Flag n={1} /></span>
          <span className={styles.navTabActive}>projects<Flag n={1} /></span>
          <span className={styles.navTab}>terminals</span>
          <span className={styles.navTab}>chat</span>
          <span className={styles.navTab}>search</span>
          <span className={styles.navTab}>ops<Flag n={3} /></span>
        </div>
      </nav>
      <div className={styles.subBar}>
        <span className={styles.subTabOn}>projects</span>
        <span className={styles.subTabDead}>directory ·deprecated<Flag n={4} /></span>
        <span className={styles.subTab}>sessions<Flag n={2} /></span>
        <span className={styles.subTab}>config</span>
      </div>
      <div className={`${styles.subBar} ${styles.subBarOps}`}>
        <span className={styles.subTab}>lanes</span>
        <span className={styles.subTab}>control</span>
        <span className={styles.subTab}>dispatch</span>
        <span className={styles.subTab}>repos<Flag n={2} /></span>
        <span className={styles.subTab}>code</span>
        <span className={styles.subTab}>providers</span>
        <span className={styles.subTab}>mesh</span>
        <span className={styles.subTab}>tail</span>
        <span className={styles.subTab}>runtime</span>
        <span className={styles.subTab}>plans</span>
      </div>
      <div className={styles.duoBody}>
        <div className={styles.ghostPane}>
          <div className={styles.ghostTitle}>home · inbox<Flag n={1} /></div>
          <div className={styles.ghostRow}>2 agents need you</div>
          <div className={styles.ghostRow}>3 sessions live</div>
          <div className={styles.ghostRow}>morning briefing</div>
        </div>
        <div className={styles.ghostPane}>
          <div className={styles.ghostTitle}>projects · inbox<Flag n={1} /></div>
          <div className={styles.ghostRow}>recent projects · 8</div>
          <div className={styles.ghostRow}>active diffs · 5</div>
          <div className={styles.ghostRow}>sessions · worktrees · rules</div>
        </div>
      </div>
      <div className={styles.legend}>
        <span><b>1</b> two inboxes — home route is `inbox`; projects center is ProjectsInbox</span>
        <span><b>2</b> sessions &amp; repos live here <i>and</i> as project facets <i>and</i> as thread rows</span>
        <span><b>3</b> ten items — user surfaces (repos, dispatch) mixed with diagnostics (tail, atop)</span>
        <span><b>4</b> deprecated directory still ships; `nav.clean` forks the personality instead of fixing it</span>
      </div>
    </div>
  );
}

/* ── model B · work nouns ─────────────────────────────────────────────────── */

function NounsFrame() {
  return (
    <div className={styles.frame}>
      <nav className={styles.nav}>
        <Brand />
        <div className={styles.navTabs}>
          <span className={styles.navTab}>home</span>
          <span className={styles.navTabActive}>projects</span>
          <span className={styles.navTab}>sessions</span>
          <span className={styles.navTab}>chat</span>
        </div>
        <div className={styles.navUtils}>
          <span className={styles.navUtil}>⌘K</span>
          <span className={`${styles.navUtil} ${styles.navUtilOn}`}>system ▾</span>
          <span className={styles.navUtil}>⚙</span>
        </div>
      </nav>
      <div className={styles.systemDrawer}>
        <span className={styles.systemLabel}>system</span>
        <span className={styles.subTab}>tail</span>
        <span className={styles.subTab}>dispatch</span>
        <span className={styles.subTab}>terminals</span>
        <span className={styles.subTab}>mesh</span>
        <span className={styles.subTab}>providers</span>
        <span className={styles.subTab}>runtime</span>
        <span className={styles.subTab}>plans</span>
        <span className={styles.subTab}>lanes</span>
      </div>
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
          <div className={styles.stubRow}><span>{"/"}{"openscout"}</span><span className={styles.stubMeta}>2 live · 23s</span></div>
          <div className={styles.stubRow}><span>{"/"}{"blink"}</span><span className={styles.stubMeta}>2 live · 26s</span></div>
          <div className={styles.stubRow}><span>{"/"}{"talkie"}</span><span className={styles.stubMetaNeeds}>1 needs you · 4d</span></div>
          <div className={styles.stubRow}><span>{"/"}{"hudson"}</span><span className={styles.stubMeta}>1h</span></div>
          <div className={styles.stubNote}>center stays as shipped — only the chrome above it changes</div>
        </div>
      </div>
      <div className={styles.legend}>
        <span><b>home</b> the one inbox — all agents in view across projects; needs-you, live, briefings</span>
        <span><b>sessions</b> watch and retrieve — observe first, takeover is the exception</span>
        <span><b>system</b> ops behind one drawer; code / repos / terminals are previews with a handoff</span>
        <span><b>gone</b> search tab → ⌘K · terminals tab → drawer · directory → deleted · nav.clean → deleted</span>
      </div>
    </div>
  );
}

/* ── model C · project-first (shelved) ────────────────────────────────────── */

function FirstFrame() {
  return (
    <div className={styles.frame}>
      <nav className={styles.nav}>
        <Brand />
        <div className={styles.navTabs}>
          <span className={styles.navTab}>home</span>
        </div>
        <div className={styles.navUtils}>
          <span className={styles.navUtil}>⌘K</span>
          <span className={styles.navUtil}>⚙</span>
        </div>
      </nav>
      <div className={styles.body}>
        <aside className={styles.rail}>
          <div className={styles.railFind}>⌕ jump anywhere</div>
          <div className={styles.railHead}>projects · the nav</div>
          {RAIL_PROJECTS.map((p) => (
            <div key={p.name} className={`${styles.railRow} ${p.selected ? styles.railRowOn : ""}`}>
              <span className={dotClass(p)} />
              <span className={styles.railName}>{"/"}{p.name}</span>
            </div>
          ))}
          <div className={styles.railDisclosure}>▸ all projects · 37 quiet</div>
          <div className={styles.railFacets}>
            <div className={styles.railFacetOn}>sessions</div>
            <div className={styles.railFacet}>code</div>
            <div className={styles.railFacet}>worktrees</div>
            <div className={styles.railFacet}>agents</div>
          </div>
        </aside>
        <div className={styles.center}>
          <div className={styles.centerHead}>
            <span className={styles.centerTitle}>{"/"}{"openscout"}</span>
            <span className={styles.centerDigest}>sessions · scoped</span>
          </div>
          <div className={styles.stubRow}><span>fix broker retry loop</span><span className={styles.stubMeta}>claude · live · 4m</span></div>
          <div className={styles.stubRow}><span>rail cleanup pass</span><span className={styles.stubMeta}>codex · live · 12m</span></div>
          <div className={styles.stubRow}><span>studio nav study</span><span className={styles.stubMeta}>kimi · 1h</span></div>
          <div className={styles.stubNote}>no global sessions/repos/terminals pages — scopes + palette instead</div>
        </div>
        <div className={styles.chatDock}>
          <span className={styles.chatDockTab}>chat · 2 unread</span>
        </div>
      </div>
      <div className={styles.legend}>
        <span><b>shelved</b> agents-across-projects is the axis — this makes you pick a scope first</span>
        <span><b>rail</b> stays a jump board, not the app’s spine</span>
        <span><b>kills</b> the global sessions page — the very “all agents in view” surface</span>
        <span><b>keep</b> chat-as-dock and palette-first retrieval as ideas for later</span>
      </div>
    </div>
  );
}

/* ── route inventory ──────────────────────────────────────────────────────── */

type Placement = { route: string; a: string; b: string; c: string };

const INVENTORY: { cluster: string; rows: Placement[] }[] = [
  {
    cluster: "attention",
    rows: [
      { route: "inbox", a: "top · Home", b: "top · Home", c: "top · Home" },
      { route: "fleet", a: "legacy home", b: "merged → Home", c: "merged → Home" },
      { route: "activity", a: "go-shortcut only", b: "Home section", c: "Home section" },
      { route: "briefings", a: "orphaned route", b: "Home section", c: "Home section" },
    ],
  },
  {
    cluster: "projects & code",
    rows: [
      { route: "agents-v2", a: "top · Projects", b: "top · Projects", c: "the rail is the nav" },
      { route: "agents", a: "subnav · .deprecated", b: "killed", c: "killed" },
      { route: "agent-info", a: "drill-in", b: "drill-in", c: "drill-in" },
      { route: "sessions", a: "Agents subnav", b: "top · Sessions", c: "facet + ⌘K" },
      { route: "code", a: "Ops subnav", b: "project facet · preview → IDE", c: "project facet · preview" },
      { route: "repos", a: "Ops subnav", b: "project facet · diff preview", c: "project facet · preview" },
      { route: "repo-diff", a: "drill-in", b: "drill-in", c: "drill-in" },
    ],
  },
  {
    cluster: "coordination",
    rows: [
      { route: "messages · conversations", a: "top · Chat", b: "top · Chat", c: "docked drawer" },
      { route: "channels", a: "Chat subnav", b: "Chat subnav", c: "drawer section" },
      { route: "work", a: "drill-in", b: "drill-in", c: "drill-in" },
      { route: "follow", a: "drill-in", b: "drill-in", c: "drill-in" },
    ],
  },
  {
    cluster: "system & diagnostics",
    rows: [
      { route: "terminal", a: "top · Terminals", b: "System · observe + handoff", c: "session mode + System" },
      { route: "broker", a: "Ops · Dispatch", b: "System drawer", c: "⌘K + System" },
      { route: "harnesses", a: "Ops · Providers", b: "System drawer", c: "System" },
      { route: "mesh", a: "Ops subnav", b: "System drawer", c: "System" },
      { route: "ops ×7 modes", a: "Ops subnav", b: "System drawer", c: "System" },
      { route: "search", a: "top · Search", b: "⌘K", c: "⌘K" },
      { route: "settings", a: "gear", b: "gear", c: "gear" },
    ],
  },
];

/* ── notes + ledger ───────────────────────────────────────────────────────── */

const NOTES: { title: string; body: React.ReactNode }[] = [
  { title: "Overview-first, never the IDE or ADE", body: <>Scout watches, summarizes, and coordinates — the doing happens in the editor, the terminal, and the agent harness. Every deep surface is a <b>preview with a handoff</b> (open in IDE, attach to session), not a workbench. A surface that grows tabs and editing is trying to be the IDE; one that runs the agent loop is trying to be the ADE.</> },
  { title: "The axis is agents across projects", body: <>People work in an IDE or ADE; they open Scout to keep <b>all agents in view at once</b>. The project is a lens applied to that picture, not a place you go. Any nav that makes you pick a scope before showing agents hides the product.</> },
  { title: "One inbox", body: <>Home is the only <b>what needs me</b> surface. The projects landing is a jump board into scopes — the moment it grows needs-you sections it becomes a second, worse Home (we tried).</> },
  { title: "Canonical addresses", body: <>Every entity has exactly one home; everywhere else links out (↗). Facets <b>preview</b>, they never re-list. Sessions get one canonical answer to “where do I find that run.”</> },
  { title: "Nouns of work up top", body: <>The bar holds the objects you think in — projects, sessions, chat. Tail, runtime, mesh, atop are operator diagnostics: palette or System drawer, never primary chrome.</> },
  { title: "One personality", body: <><code>nav.clean</code> dies. Two navs means the app doesn’t know what it is — and in lean mode the highlight already lies (repos and search light up Home).</> },
  { title: "Dead routes die", body: <>Directory .deprecated, fleet, orphaned briefings — merged or removed, not flagged. A nav that ships its own apologies teaches users to ignore it.</> },
];

const LEDGER: { take: string; verdict: string }[] = [
  { take: "A · Status quo", verdict: "Control. 6 tabs + 14 subnav items, two inboxes, sessions reachable 3+ ways, Ops a junk drawer, and a feature flag admitting it. Every /projects symptom traced back here." },
  { take: "B · Work nouns", verdict: "Chosen. Matches the posture: operators live in an IDE/ADE and open Scout to keep all agents in view — so the tabs are lenses over that picture, Home is the cross-project center of gravity, and depth is preview + handoff. Migration is mostly re-labeling and moving Ops behind one drawer." },
  { take: "C · Project-first", verdict: "Shelved. Its premise cuts against the posture: making the project the spine means picking a scope before you see your agents — but the product’s job is all agents in view across projects, and killing the global Sessions page removes the very surface that does that. Chat-as-dock and palette-first retrieval survive as ideas." },
];

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function AppNavStudy() {
  const [model, setModel] = useState<Model>("nouns");

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · shell · app-nav
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          App nav · three structural models
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Scout is an overview-first platform — not an IDE or ADE replacement. It watches,
          summarizes, and coordinates; the doing happens in the editor, the terminal, and the agent
          harness. So the nav is organized around lenses, not workbenches: three models of the whole
          shell, switched in place, with every route in packages/web mapped onto each. B is chosen;
          C is shelved — the axis is agents across projects, not the project scope.
        </p>
      </header>

      <div className={styles.takeSwitch}>
        {MODELS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`${styles.takeBtn} ${model === m.id ? styles.takeBtnOn : ""}`}
            onClick={() => setModel(m.id)}
          >
            <span>{m.label}</span>
            <span className={styles.takeNote}>{m.note}</span>
          </button>
        ))}
      </div>

      <div className={styles.wrap}>
        {model === "quo" ? <QuoFrame /> : model === "nouns" ? <NounsFrame /> : <FirstFrame />}

        <section>
          <div className={styles.noteHead}>Route inventory · every view, every model</div>
          <div className={styles.invTable}>
            <div className={`${styles.invRow} ${styles.invHead}`}>
              <span>route</span>
              <span>A · status quo</span>
              <span>B · work nouns</span>
              <span>C · project-first</span>
            </div>
            {INVENTORY.map((group) => (
              <div key={group.cluster} className={styles.invGroup}>
                <div className={styles.invCluster}>{group.cluster}</div>
                {group.rows.map((row) => (
                  <div key={row.route} className={styles.invRow}>
                    <span className={styles.invRoute}>{row.route}</span>
                    <span className={model === "quo" ? styles.invCellOn : styles.invCell}>{row.a}</span>
                    <span className={model === "nouns" ? styles.invCellOn : styles.invCell}>{row.b}</span>
                    <span className={model === "first" ? styles.invCellOn : styles.invCell}>{row.c}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

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
