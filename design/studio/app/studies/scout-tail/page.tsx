"use client";

import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { ScoutWindow } from "@/components/scout/ScoutWindow";
import styles from "./page.module.css";

/**
 * Scout — Tail.
 *
 * The implementation spec for `ScoutTailView`. The deltas from today's Swift:
 * the kind dropdown menu becomes an inline filter-chip bar, and the single-char
 * glyph in each row becomes a colored KIND chip. The chip taxonomy is faithful
 * to the real harness kinds (ScoutTailEventKind: user/assistant/tool/toolResult/
 * system/other), and the tones are token-only — moving tool/toolResult off the
 * raw `.cyan`/`.orange` they use today (ScoutModels.swift:54).
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

export default function ScoutTailStudy() {
  return (
    <ScoutStudyShell
      pageId="scout-tail"
      title="Scout — Tail"
      blurb={
        <>
          The live event stream as it should ship. The kind dropdown becomes an
          inline filter-chip bar, and each row&apos;s single-char glyph becomes a
          colored KIND chip. Tones are token-only — tool/output move off the raw{" "}
          <code className="font-mono text-[11px] text-studio-ink">.cyan</code>/
          <code className="font-mono text-[11px] text-studio-ink">.orange</code> they
          use today.
        </>
      }
    >
      <ScoutWindow title="scout · tail">
        <div className={styles.tail}>
          {/* Bar: live pill + filter chips + source/search hint */}
          <div className={styles.bar}>
            <span className={styles.live}>
              <span className={styles.pip} />
              Live
            </span>
            <div className={styles.chips}>
              {FILTERS.map((f) => (
                <span
                  key={f.key}
                  className={`${styles.chip} ${f.key === "all" ? styles.active : ""}`}
                  style={f.key !== "all" ? ({ "--chip-tone": KINDS[f.key as KindKey].tone } as React.CSSProperties) : undefined}
                >
                  {f.key !== "all" ? (
                    <span className={styles.chipDot} style={{ background: KINDS[f.key as KindKey].tone }} />
                  ) : null}
                  {f.title}
                </span>
              ))}
            </div>
            <div className={styles.barRight}>
              <span className={styles.barHint}>
                <TagGlyph /> All sources
              </span>
              <span className={styles.barSearch}>
                <SearchGlyph /> Filter
              </span>
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
