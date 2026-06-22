"use client";

import { useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { ScoutWindow } from "@/components/scout/ScoutWindow";
import {
  ScoutPageHeader,
  ScoutGhostButton,
  ScoutIconButton,
  ScoutHeaderDivider,
  ScoutInspector,
} from "@/components/scout/ScoutSurface";
import styles from "./scout-tail.module.css";

/**
 * Scout — Tail.
 *
 * The implementation spec for `ScoutTailView`, now built on the shared
 * main-view kit (`ScoutSurface`) so its header and inspector ARE the same
 * objects Repos/Agents render — not look-alikes:
 *
 *   · ScoutPageHeader — the 52px bar: "Tail" + LIVE, then the Pause follow-toggle
 *                       and refresh / open-web as ranked-down utilities.
 *   · one filter toolbar (view-specific): search + source + right-aligned chips.
 *   · ScoutInspector  — `| TAIL` + LIVE head over a card of identity + labeled
 *                       KV groups (Coverage, Sources), the Repos/Agents shape.
 */

type KindKey = "user" | "assistant" | "tool" | "toolResult" | "system" | "other";

/* kind → { chip label, filter label, token tone }. The Swift `ScoutTailEventKind`
   already carries `label`/`title`/`glyph`; this locks the per-kind tone to a
   semantic token (no raw system colors). */
const KINDS: Record<KindKey, { label: string; title: string; tone: string }> = {
  user: { label: "USER", title: "User", tone: "var(--s-accent)" },
  assistant: { label: "ASST", title: "Assistant", tone: "var(--s-ok)" },
  tool: { label: "TOOL", title: "Tool", tone: "var(--s-warn)" },
  toolResult: { label: "OUT", title: "Output", tone: "var(--s-info)" },
  system: { label: "SYS", title: "System", tone: "var(--s-muted)" },
  other: { label: "EVT", title: "Other", tone: "var(--s-dim)" },
};

const KIND_ORDER: KindKey[] = ["user", "assistant", "tool", "toolResult", "system", "other"];

/* Events carry the four facet fields (harness · origin · project · kind) so a
   pick in the inspector Distribution actually filters this stream. */
type Ev = { t: string; src: string; harness: string; origin: string; project: string; kind: KindKey; html: string };

const EVENTS: Ev[] = [
  { t: "14:21:08", src: "@talkie", harness: "claude", origin: "native", project: "talkie", kind: "assistant", html: "render overlay settings before the first send — no skin flash on cold open" },
  { t: "14:21:03", src: "@scout", harness: "claude", origin: "scout", project: "openscout", kind: "tool", html: "Edit <code>service.ts</code> — repo-watch web converge" },
  { t: "14:20:58", src: "@scout", harness: "claude", origin: "scout", project: "openscout", kind: "toolResult", html: "<code>+1,108 −231</code> · 27 files" },
  { t: "14:20:55", src: "@hudson", harness: "claude", origin: "scout", project: "openscout", kind: "tool", html: "Read <code>HudNavigationSidebar.swift</code> · 412 lines" },
  { t: "14:20:51", src: "@codex", harness: "codex", origin: "scout", project: "openscout", kind: "system", html: "session <code>relay-openscout-codex</code> started · tmux" },
  { t: "14:20:44", src: "@art", harness: "claude", origin: "native", project: "openscout", kind: "user", html: "take both — and surface the active theme in the inspector" },
  { t: "14:20:40", src: "@talkie", harness: "claude", origin: "native", project: "talkie", kind: "other", html: "permission-mode: acceptEdits" },
  { t: "14:20:31", src: "@lattices", harness: "codex", origin: "scout", project: "openscout", kind: "assistant", html: "rebased main onto origin — 2 ahead, clean" },
  { t: "14:20:22", src: "@scout", harness: "claude", origin: "scout", project: "openscout", kind: "toolResult", html: "Bash <code>./node_modules/.bin/tsc</code> — ok, 0 errors" },
  { t: "14:20:09", src: "@hudson", harness: "claude", origin: "scout", project: "openscout", kind: "tool", html: "Grep <code>data-scout-skin</code> · 6 matches" },
];

const FILTERS: ({ key: "all"; title: string } | { key: KindKey; title: string })[] = [
  { key: "all", title: "All" },
  ...KIND_ORDER.map((k) => ({ key: k, title: KINDS[k].title })),
];

/* A pick from the inspector Distribution (or a kind chip): which facet, which
   value. `null` = no filter. */
type FacetFilter = { facet: string; value: string } | null;

function eventMatches(e: Ev, filter: FacetFilter): boolean {
  if (!filter) return true;
  switch (filter.facet) {
    case "sources": return e.harness === filter.value;
    case "origins": return e.origin === filter.value;
    case "kinds": return KINDS[e.kind].title === filter.value;
    case "projects": return e.project === filter.value;
    default: return true;
  }
}

/* Inspector sample data — mirrors the native `ScoutTailInspector`, but
   restructured into three tiers: Vitals (the headline grid), one faceted
   Distribution (Sources · Origins · Kinds · Projects, one shown at a time),
   and a quiet footer (metadata toggle + a collapsed glossary). */
const COVERAGE: { label: string; value: string }[] = [
  { label: "Logs", value: "25" },
  { label: "Processes", value: "22" },
  { label: "Sessions", value: "13" },
  { label: "Buffered", value: "700" },
];

type Facet = { key: string; title: string; items: { label: string; count: number }[] };

/* The four breakdowns the native inspector stacks vertically — here they're
   one switchable block, so the sidebar shows a single distribution at a time. */
const FACETS: Facet[] = [
  {
    key: "sources",
    title: "Sources",
    items: [
      { label: "codex", count: 468 },
      { label: "claude", count: 232 },
    ],
  },
  {
    key: "origins",
    title: "Origins",
    items: [
      { label: "scout", count: 505 },
      { label: "native", count: 195 },
    ],
  },
  {
    key: "kinds",
    title: "Kinds",
    items: [
      { label: "Tool result", count: 190 },
      { label: "Tool", count: 176 },
      { label: "System", count: 157 },
      { label: "Assistant", count: 95 },
      { label: "Other", count: 70 },
      { label: "User", count: 12 },
    ],
  },
  {
    key: "projects",
    title: "Projects",
    items: [
      { label: "talkie", count: 379 },
      { label: "openscout", count: 321 },
    ],
  },
];

/* The native "Tracks" section — documentation about what Tail watches. Demoted
   to a collapsed disclosure since it's reference, not live signal. */
const TRACKS: [string, string][] = [
  ["Transcript logs", "Claude and Codex JSONL files discovered on disk"],
  ["Live processes", "Harness process inventory and parent attribution"],
  ["Sessions", "Session IDs and short row links"],
  ["Projects", "Working directory and project labels"],
  ["Origins", "Scout-managed, Hudson-managed, or native source"],
  ["Events", "User, assistant, tool, tool result, system, other"],
];

export default function ScoutTailStudy() {
  // One shared filter, set by a Distribution row or a kind chip; it drives
  // both the inspector highlight and the visible stream.
  const [filter, setFilter] = useState<FacetFilter>(null);
  const pick = (facet: string, value: string) =>
    setFilter((cur) => (cur && cur.facet === facet && cur.value === value ? null : { facet, value }));

  const shown = EVENTS.filter((e) => eventMatches(e, filter));
  const kindActive = (title: string) => filter?.facet === "kinds" && filter.value === title;

  return (
    <ScoutStudyShell
      pageId="scout-tail"
      title="Scout — Tail"
      blurb={
        <>
          The live event stream, built on the shared <b>ScoutSurface</b> kit. The
          header is the same 52px bar Repos/Agents render (LIVE shown once here, not
          repeated below) over one <b>filter toolbar</b> (search · source ·
          right-aligned kind chips). The inspector is <b>restructured</b> into three
          tiers — flat <b>Vitals</b> readouts (Instrument language, no boxes), one
          faceted <b>Distribution</b> that folds the native Sources/Origins/Kinds/
          Projects lists into a single switchable block of share bars, and a quiet
          <b> footer</b>. Picking any distribution row — or a kind chip — filters the
          stream live.
        </>
      }
    >
      <ScoutWindow title="scout · tail">
        <div className={styles.surface}>
          {/* ── Main: header + toolbar + stream ──────────────────────── */}
          <div className={styles.main}>
            <ScoutPageHeader
              title="Tail"
              live
              counts={[
                { n: 25, label: "logs" },
                { n: 22, label: "procs", tone: "dim" },
                { n: "191.7", label: "lines/s", tone: "dim" },
              ]}
              actions={
                <>
                  <ScoutGhostButton>
                    <PauseGlyph /> Pause
                  </ScoutGhostButton>
                  <ScoutHeaderDivider />
                  <ScoutIconButton label="Refresh">
                    <RefreshGlyph />
                  </ScoutIconButton>
                  <ScoutIconButton label="Open in web">
                    <WebGlyph />
                  </ScoutIconButton>
                </>
              }
            />

            {/* Filter toolbar (view-specific) */}
            <div className={styles.toolbar}>
              <span className={styles.search}>
                <SearchGlyph /> Search
              </span>
              <span className={styles.source}>
                <TagGlyph /> All sources <Caret />
              </span>
              {/* Kind filter — single accent, no per-chip dots. The active
                  chip fills with the one accent; per-kind tone lives only in
                  the stream's KIND column, where it aids scanning. Wired to the
                  same filter the Distribution drives. */}
              <div className={styles.chips}>
                {FILTERS.map((f) => {
                  const on = f.key === "all" ? !filter : kindActive(f.title);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      className={`${styles.chip} ${on ? styles.active : ""}`}
                      onClick={() =>
                        f.key === "all" ? setFilter(null) : pick("kinds", f.title)
                      }
                    >
                      {f.title}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active-filter banner — the visible proof the inspector drives
                the stream. Only shown when a facet pick is active. */}
            {filter ? (
              <div className={styles.filterBanner}>
                <span className={styles.filterText}>
                  Showing <b>{filter.facet}</b> · {filter.value}
                </span>
                <span className={styles.filterCount}>{shown.length} events</span>
                <button type="button" className={styles.filterClear} onClick={() => setFilter(null)}>
                  Clear
                </button>
              </div>
            ) : null}

            {/* Stream */}
            <div className={styles.stream}>
              {shown.map((e, i) => (
                <div key={i} className={styles.ev}>
                  <span className={styles.evTime}>{e.t}</span>
                  <span className={styles.evSrc}>{e.src}</span>
                  <KindChip kind={e.kind} />
                  <span className={styles.evMsg} dangerouslySetInnerHTML={{ __html: e.html }} />
                </div>
              ))}
            </div>
          </div>

          {/* ── Inspector: Vitals · Distribution · footer. No LIVE badge here —
              the page header owns it, so it isn't repeated. ─────────────── */}
          <ScoutInspector type="Tail">
            <div className={styles.insp}>
              {/* Vitals — flat stat readouts (Instrument language, no boxes) */}
              <section className={styles.vitals}>
                {COVERAGE.map((m) => (
                  <div key={m.label} className={styles.stat}>
                    <span className={styles.statValue}>{m.value}</span>
                    <span className={styles.statLabel}>{m.label}</span>
                  </div>
                ))}
              </section>

              {/* Distribution — faceted; a row pick drives the shared filter */}
              <Distribution filter={filter} onPick={pick} />

              {/* Footer — settings + collapsed glossary, demoted down */}
              <div className={styles.footer}>
                <DefaultsRow />
                <TracksDisclosure />
              </div>
            </div>
          </ScoutInspector>
        </div>
      </ScoutWindow>

      {/* Vocabulary spec — the implementation reference for ScoutModels.swift */}
      <div className={styles.legendWrap} data-legend>
        <div className={styles.legendHead}>kind vocabulary · token tones</div>
        <div className={styles.legend}>
          {KIND_ORDER.map((k) => (
            <div key={k} className={styles.legendItem}>
              <KindChip kind={k} />
              <span className={styles.legendTitle}>{KINDS[k].title}</span>
              <code className={styles.legendTone}>{KINDS[k].tone.replace("var(", "").replace(")", "")}</code>
            </div>
          ))}
        </div>
      </div>
    </ScoutStudyShell>
  );
}

function KindChip({ kind }: { kind: KindKey }) {
  const k = KINDS[kind];
  return (
    <span className={styles.kind} style={{ "--chip-tone": k.tone } as React.CSSProperties}>
      {k.label}
    </span>
  );
}

/* ── Distribution — the four count-lists, switched into one faceted block ─── */
function Distribution({ filter, onPick }: { filter: FacetFilter; onPick: (facet: string, value: string) => void }) {
  const [facetKey, setFacetKey] = useState<string>("sources");
  const facet = FACETS.find((f) => f.key === facetKey) ?? FACETS[0];
  const max = Math.max(...facet.items.map((i) => i.count));
  const total = facet.items.reduce((n, i) => n + i.count, 0);

  return (
    <section className={styles.dist}>
      <div className={styles.distHead}>
        <span className={styles.groupLabel}>Distribution</span>
        <span className={styles.distTotal}>{total} events</span>
      </div>

      {/* Facet switch — only one breakdown is on screen at a time */}
      <div className={styles.segs} role="tablist">
        {FACETS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={f.key === facetKey}
            className={`${styles.seg} ${f.key === facetKey ? styles.segOn : ""}`}
            onClick={() => setFacetKey(f.key)}
          >
            {f.title}
          </button>
        ))}
      </div>

      {/* Share bars — each row reads as a mini bar chart; clicking it drives the
          shared filter, so the stream narrows to that value. */}
      <div className={styles.bars}>
        {facet.items.map((it) => {
          const on = filter?.facet === facetKey && filter.value === it.label;
          const pct = Math.round((it.count / total) * 100);
          return (
            <button
              key={it.label}
              type="button"
              className={`${styles.bar} ${on ? styles.barOn : ""}`}
              onClick={() => onPick(facetKey, it.label)}
              title={`Filter stream to ${it.label}`}
            >
              <span className={styles.barLabel}>{it.label}</span>
              <span className={styles.barTrack}>
                <span
                  className={styles.barFill}
                  style={{ width: `${Math.round((it.count / max) * 100)}%` }}
                />
              </span>
              <span className={styles.barMetric}>
                <span className={styles.barCount}>{it.count}</span>
                <span className={styles.barPct}>{pct}%</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DefaultsRow() {
  const [on, setOn] = useState(false);
  return (
    <button type="button" className={styles.toggleRow} onClick={() => setOn((o) => !o)}>
      <span className={styles.check} data-on={on}>
        {on ? <CheckGlyph /> : null}
      </span>
      <span className={styles.toggleText}>Show transcript metadata</span>
    </button>
  );
}

/* "Tracks" glossary — collapsed by default; it's reference, not live signal. */
function TracksDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.disc}>
      <button type="button" className={styles.discHead} onClick={() => setOpen((o) => !o)}>
        <span className={styles.groupLabel}>What Tail watches</span>
        <span className={styles.discCaret} data-open={open}>
          <Caret />
        </span>
      </button>
      {open ? (
        <div className={styles.tracks}>
          {TRACKS.map(([label, detail]) => (
            <div key={label} className={styles.track}>
              <span className={styles.trackLabel}>{label}</span>
              <span className={styles.trackDetail}>{detail}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8.5l3.5 3.5L13 4.5" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function TagGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7v5l9 9 5-5-9-9H3z" />
      <circle cx="7" cy="11" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
    </svg>
  );
}

function RefreshGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function WebGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  );
}

function Caret() {
  return (
    <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ marginLeft: 2 }}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
