"use client";

import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { ScoutWindow } from "@/components/scout/ScoutWindow";
import styles from "./tail-great.module.css";

/**
 * Tail — what great looks like.
 *
 * A north-star for the live event stream (not the spec — that's `scout-tail`).
 * The bar: a firehose that reads like a calm shell log, not a noisy ticker.
 *
 *   1. ONE LINE PER EVENT   — every row stands on its own, full identity and
 *                             all. A run from one agent stacks up and gets its
 *                             vertical space; runs are separated by breathing
 *                             room, never collapsed or de-duped.
 *   2. CLEAN ACTIONS        — tool calls read like shell history
 *                             (`Read views/scout-tail.tsx`, `git log -4`);
 *                             results collapse to an outcome (`→ 247 lines`).
 *   3. KIND = GLYPH + COLOR — each kind carries a shape AND a hue, so it reads
 *                             at a glance and survives without color. Signal
 *                             (User/Assistant/Tool) is crisp; the machine bulk
 *                             (OUT/SYS/EVT) recedes.
 *   4. ONE STATE            — Follow or Pause. No "live" theatrics; the toggle
 *                             is the whole truth.
 *
 * Rendered through the real `--s-*` skins so what reads here can ship.
 */

type KindKey = "user" | "assistant" | "tool" | "toolResult" | "system" | "other";

const KINDS: Record<KindKey, { label: string; tone: string }> = {
  user: { label: "USER", tone: "var(--s-accent)" },
  assistant: { label: "ASST", tone: "var(--s-ok)" },
  tool: { label: "TOOL", tone: "var(--s-warn)" },
  toolResult: { label: "OUT", tone: "var(--s-muted)" },
  system: { label: "SYS", tone: "var(--s-dim)" },
  other: { label: "EVT", tone: "var(--s-dim)" },
};

const SIGNAL: Set<KindKey> = new Set(["user", "assistant", "tool"]);

type IdTier = "agent" | "project" | "proc";

type Ev = { t: string; id: string; tier: IdTier; kind: KindKey; html: string };

/* A believable slice: agent runs (call → result on its own line, identity
   repeated every row), a human turn, a bare process, cross-harness agents. */
const EVENTS: Ev[] = [
  { t: "09:42:18", id: "@scout", tier: "agent", kind: "tool", html: "Read <code>views/scout-tail.tsx</code>" },
  { t: "09:42:18", id: "@scout", tier: "agent", kind: "toolResult", html: "→ 247 lines" },
  { t: "09:42:21", id: "@scout", tier: "agent", kind: "tool", html: "Edit <code>broker/service.ts</code>" },
  { t: "09:42:21", id: "@scout", tier: "agent", kind: "toolResult", html: "→ <span class=\"add\">+12</span> <span class=\"del\">−3</span>" },
  { t: "09:42:24", id: "@scout", tier: "agent", kind: "tool", html: "<code>git log --oneline -4</code>" },
  { t: "09:42:25", id: "@scout", tier: "agent", kind: "toolResult", html: "→ 4 lines" },
  { t: "09:42:31", id: "@scout", tier: "agent", kind: "assistant", html: "rebased main onto origin — 2 ahead, clean" },

  { t: "09:42:40", id: "@art", tier: "agent", kind: "user", html: "take both — and surface the active theme in the inspector" },

  { t: "09:42:44", id: "@hudson", tier: "agent", kind: "tool", html: "Grep <code>data-scout-skin</code>" },
  { t: "09:42:44", id: "@hudson", tier: "agent", kind: "toolResult", html: "→ 6 matches · 6 files" },
  { t: "09:42:48", id: "@hudson", tier: "agent", kind: "tool", html: "Read <code>HudNavigationSidebar.swift</code>" },
  { t: "09:42:48", id: "@hudson", tier: "agent", kind: "toolResult", html: "→ 412 lines" },

  { t: "09:42:52", id: "codex·4894", tier: "proc", kind: "system", html: "session <code>relay-openscout-codex</code> started · tmux" },

  { t: "09:42:58", id: "@lattices", tier: "agent", kind: "assistant", html: "bundle built in 4.2s · 0 warnings" },

  { t: "09:43:02", id: "talkie", tier: "project", kind: "tool", html: "<code>sed -n '1,180p' studio/components/PhoneFrame.tsx</code>" },
  { t: "09:43:02", id: "talkie", tier: "project", kind: "toolResult", html: "→ 180 lines" },
  { t: "09:43:05", id: "talkie", tier: "project", kind: "other", html: "permission-mode → acceptEdits" },

  { t: "09:43:09", id: "@scout", tier: "agent", kind: "tool", html: "Write <code>tail/tool-format.ts</code>" },
  { t: "09:43:09", id: "@scout", tier: "agent", kind: "toolResult", html: "→ created · 9 tests green" },
];

const FILTERS = ["All", "Signal", "Tools", "Sessions", "Diffs"] as const;

const NOW_AGENTS: { id: string; tier: IdTier; note: string }[] = [
  { id: "@scout", tier: "agent", note: "editing · openscout" },
  { id: "@hudson", tier: "agent", note: "reading · openscout" },
  { id: "@lattices", tier: "agent", note: "building · openscout" },
  { id: "talkie", tier: "project", note: "native · talkie" },
];

const KIND_MIX: { k: KindKey; n: number }[] = [
  { k: "toolResult", n: 190 },
  { k: "tool", n: 176 },
  { k: "system", n: 157 },
  { k: "assistant", n: 95 },
  { k: "other", n: 70 },
  { k: "user", n: 12 },
];

export default function TailGreatStudy() {
  const mixTotal = KIND_MIX.reduce((n, m) => n + m.n, 0);

  return (
    <ScoutStudyShell
      pageId="tail-great"
      title="Tail — what great looks like"
      blurb={
        <>
          The north-star for the live event stream: a firehose that reads like a
          calm shell log. Every event is <b>one full line</b> with its identity —
          a run from one agent stacks up and takes its space, never collapsed.
          Tool calls read like shell history; results collapse to an outcome.
          Each kind carries a <b>glyph and a color</b>, so it reads at a glance.
          One state only: <b>Follow or Pause</b>. Rendered through the real app
          skins.
        </>
      }
    >
      <ScoutWindow title="scout · tail">
        <div className={styles.surface}>
          {/* ── Main: header + stream ────────────────────────────────── */}
          <div className={styles.main}>
            <header className={styles.head}>
              <span className={styles.identity}>
                <TailGlyph />
                <span className={styles.title}>Tail</span>
              </span>

              <span className={styles.counts}>
                <span className={styles.count}><b>25</b> logs</span>
                <span className={styles.dot}>·</span>
                <span className={styles.count}><b>22</b> procs</span>
                <span className={styles.dot}>·</span>
                <span className={styles.count}><b>13</b> sessions</span>
              </span>

              <div className={styles.headActions}>
                {/* The only state that matters: Follow ⇄ Pause. */}
                <div className={styles.follow} role="group" aria-label="Stream state">
                  <button className={`${styles.followSeg} ${styles.followOn}`}>
                    <PlayGlyph /> Follow
                  </button>
                  <button className={styles.followSeg}>
                    <PauseGlyph /> Pause
                  </button>
                </div>
                <button className={styles.icon} aria-label="Refresh"><RefreshGlyph /></button>
              </div>
            </header>

            <div className={styles.toolbar}>
              <span className={styles.search}><SearchGlyph /> Search the stream</span>
              <div className={styles.segs}>
                {FILTERS.map((f, i) => (
                  <button key={f} className={`${styles.seg} ${i === 0 ? styles.segOn : ""}`}>{f}</button>
                ))}
              </div>
            </div>

            {/* The stream — one full line per event; runs of an agent breathe. */}
            <div className={styles.stream}>
              {EVENTS.map((e, i) => {
                const newRun = i === 0 || EVENTS[i - 1].id !== e.id;
                return (
                  <div key={i} className={`${styles.row} ${newRun ? styles.runStart : ""}`}>
                    <span className={styles.time}>{e.t}</span>
                    <span className={`${styles.id} ${styles[`id_${e.tier}`]}`}>{e.id}</span>
                    <span className={styles.kindCell}>
                      <KindTag kind={e.kind} />
                    </span>
                    <span
                      className={`${styles.action} ${e.kind === "toolResult" ? styles.actionOut : ""}`}
                      dangerouslySetInnerHTML={{ __html: e.html }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Rail: a lean overview ────────────────────────────────── */}
          <aside className={styles.rail}>
            <div className={styles.railHead}>
              <span className={styles.railTick} />
              <span className={styles.railType}>OVERVIEW</span>
            </div>

            <div className={styles.railBody}>
              <section className={styles.railSection}>
                <div className={styles.groupLabel}>Active now</div>
                <div className={styles.nowList}>
                  {NOW_AGENTS.map((a) => (
                    <div key={a.id} className={styles.nowRow}>
                      <span className={`${styles.id} ${styles[`id_${a.tier}`]}`}>{a.id}</span>
                      <span className={styles.nowNote}>{a.note}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className={styles.railSection}>
                <div className={styles.groupLabel}>Kind mix · 700</div>
                <div className={styles.mix}>
                  {KIND_MIX.map((m) => {
                    const k = KINDS[m.k];
                    const pct = Math.round((m.n / mixTotal) * 100);
                    return (
                      <div key={m.k} className={styles.mixRow}>
                        <KindTag kind={m.k} />
                        <span className={styles.mixTrack}>
                          <span
                            className={styles.mixFill}
                            style={{
                              width: `${pct}%`,
                              background: SIGNAL.has(m.k)
                                ? `color-mix(in srgb, ${k.tone} 64%, transparent)`
                                : "var(--s-hairline-strong)",
                            }}
                          />
                        </span>
                        <span className={styles.mixNum}>{m.n}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </aside>
        </div>
      </ScoutWindow>
    </ScoutStudyShell>
  );
}

/* Kind = glyph + color + label. Signal kinds keep the colored tag; the machine
   bulk recedes to neutral. The glyph adds a shape cue on top of the hue. */
function KindTag({ kind }: { kind: KindKey }) {
  const k = KINDS[kind];
  const neutral = !SIGNAL.has(kind);
  return (
    <span
      className={`${styles.kind} ${neutral ? styles.kindNeutral : ""}`}
      style={{ "--chip-tone": k.tone } as React.CSSProperties}
    >
      <KindGlyph kind={kind} />
      {k.label}
    </span>
  );
}

/* Per-kind geometric marks (currentColor → inherits the tag tone). */
function KindGlyph({ kind }: { kind: KindKey }) {
  const common = { width: 9, height: 9, viewBox: "0 0 14 14", "aria-hidden": true } as const;
  switch (kind) {
    case "user": // input chevron
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 3l4 4-4 4" />
        </svg>
      );
    case "assistant": // 4-point spark
      return (
        <svg {...common} fill="currentColor">
          <path d="M7 0.5l1.3 4.2 4.2 1.3-4.2 1.3L7 13.5 5.7 7.3 1.5 6l4.2-1.3z" />
        </svg>
      );
    case "tool": // square (an action)
      return (
        <svg {...common} fill="currentColor">
          <rect x="2.5" y="2.5" width="9" height="9" rx="1.6" />
        </svg>
      );
    case "toolResult": // return arrow
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 7h8M7 4l3 3-3 3" />
        </svg>
      );
    case "system": // ring
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="7" cy="7" r="4" />
        </svg>
      );
    default: // dot
      return (
        <svg {...common} fill="currentColor">
          <circle cx="7" cy="7" r="2.2" />
        </svg>
      );
  }
}

/* Tail identity mark — a steady ECG line (matches the app sidebar). */
function TailGlyph() {
  return (
    <svg className={styles.tailGlyph} width="18" height="13" viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 7h4.2l2-4.5 3 9 2.4-6 1.6 3H21" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4 2.5l9 5.5-9 5.5z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
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

function SearchGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
