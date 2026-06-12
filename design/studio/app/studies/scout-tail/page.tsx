"use client";

import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { ScoutWindow } from "@/components/scout/ScoutWindow";
import {
  ScoutPageHeader,
  ScoutGhostButton,
  ScoutIconButton,
  ScoutHeaderDivider,
  ScoutInspector,
  ScoutInspectorCard,
  ScoutInspectorTop,
  ScoutGroup,
  ScoutKV,
} from "@/components/scout/ScoutSurface";
import styles from "./page.module.css";

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

type Ev = { t: string; src: string; kind: KindKey; html: string };

const EVENTS: Ev[] = [
  { t: "14:21:08", src: "@talkie", kind: "assistant", html: "render overlay settings before the first send — no skin flash on cold open" },
  { t: "14:21:03", src: "@scout", kind: "tool", html: "Edit <code>service.ts</code> — repo-watch web converge" },
  { t: "14:20:58", src: "@scout", kind: "toolResult", html: "<code>+1,108 −231</code> · 27 files" },
  { t: "14:20:55", src: "@hudson", kind: "tool", html: "Read <code>HudNavigationSidebar.swift</code> · 412 lines" },
  { t: "14:20:51", src: "@codex", kind: "system", html: "session <code>relay-openscout-codex</code> started · tmux" },
  { t: "14:20:44", src: "@art", kind: "user", html: "take both — and surface the active theme in the inspector" },
  { t: "14:20:40", src: "@talkie", kind: "other", html: "permission-mode: acceptEdits" },
  { t: "14:20:31", src: "@lattices", kind: "assistant", html: "rebased main onto origin — 2 ahead, clean" },
  { t: "14:20:22", src: "@scout", kind: "toolResult", html: "Bash <code>./node_modules/.bin/tsc</code> — ok, 0 errors" },
  { t: "14:20:09", src: "@hudson", kind: "tool", html: "Grep <code>data-scout-skin</code> · 6 matches" },
];

const FILTERS: ({ key: "all"; title: string } | { key: KindKey; title: string })[] = [
  { key: "all", title: "All" },
  ...KIND_ORDER.map((k) => ({ key: k, title: KINDS[k].title })),
];

/* Inspector sample data — Coverage counts + the source breakdown the native
   `ScoutTailInspector` carries. */
const COVERAGE: { label: string; value: string }[] = [
  { label: "Logs", value: "39" },
  { label: "Processes", value: "19" },
  { label: "Agents", value: "12" },
  { label: "Harnesses", value: "4" },
];

const SOURCES: { label: string; count: number }[] = [
  { label: "claude", count: 514 },
  { label: "codex", count: 188 },
  { label: "native", count: 54 },
  { label: "scout", count: 33 },
];

export default function ScoutTailStudy() {
  return (
    <ScoutStudyShell
      pageId="scout-tail"
      title="Scout — Tail"
      blurb={
        <>
          The live event stream, built on the shared <b>ScoutSurface</b> kit. The
          header is the same 52px bar Repos/Agents render (title + LIVE, ranked
          actions) over one <b>filter toolbar</b> (search · source · right-aligned
          kind chips). The inspector is the system card — <b>{`| TAIL`}</b> + status
          head over identity + labeled KV groups (Coverage, Sources). Change the
          kit once, every surface moves together.
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
                { n: 789, label: "events" },
                { n: 4, label: "sources" },
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
              <div className={styles.chips}>
                {FILTERS.map((f) => (
                  <span
                    key={f.key}
                    className={`${styles.chip} ${f.key === "all" ? styles.active : ""}`}
                  >
                    {f.key !== "all" ? (
                      <span className={styles.chipDot} style={{ background: KINDS[f.key as KindKey].tone }} />
                    ) : null}
                    {f.title}
                  </span>
                ))}
              </div>
            </div>

            {/* Stream */}
            <div className={styles.stream}>
              {EVENTS.map((e, i) => (
                <div key={i} className={styles.ev}>
                  <span className={styles.evTime}>{e.t}</span>
                  <span className={styles.evSrc}>{e.src}</span>
                  <KindChip kind={e.kind} />
                  <span className={styles.evMsg} dangerouslySetInnerHTML={{ __html: e.html }} />
                </div>
              ))}
            </div>
          </div>

          {/* ── Inspector: the shared system card ────────────────────── */}
          <ScoutInspector type="Tail" status={{ label: "Live", tone: "ok" }}>
            <ScoutInspectorCard>
              <ScoutInspectorTop
                avatar={<PulseGlyph />}
                name="Live tail"
                sub="all sources · streaming"
              />
              <ScoutGroup label="Coverage">
                {COVERAGE.map((m) => (
                  <ScoutKV key={m.label} k={m.label} v={m.value} />
                ))}
              </ScoutGroup>
              <ScoutGroup label="Sources">
                {SOURCES.map((s) => (
                  <ScoutKV key={s.label} k={s.label} v={s.count} />
                ))}
              </ScoutGroup>
            </ScoutInspectorCard>
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

function PulseGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12h3.5l2.5-6.5 4 13 2.5-6.5H21" />
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
