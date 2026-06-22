"use client";

import { useEffect, useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { ScoutWindow } from "@/components/scout/ScoutWindow";
import styles from "./scout-conversation-presentations.module.css";

/**
 * Scout — Conversation Presentations.
 *
 * The active-agent message stream, explored as switchable treatments (the
 * "settings" control at the top picks one). Two problems drive it:
 *
 *  1. Dead air. Today the stream shows nothing meaningful until a full reply
 *     lands. Each treatment carries a live Working turn that fills the gap with
 *     the agent's actual motion (flight state + latest activity event + a motion
 *     meter), then morphs into the reply — mirroring the web's "Currently
 *     working" panel using signal the inspector already has.
 *
 *  2. Suboptimal layout + collapse. Treatments span sender-led → alternating →
 *     reading → dense-ops. All share ONE collapse rule: the latest turn is
 *     always full, recent turns stay full, and ONLY older long turns fold —
 *     there is no "Show more" hiding what's in front of you. Folding is recency
 *     aging-out ("show less" for old), not progressive disclosure.
 */

type Treatment = "transcript" | "split" | "document" | "ledger";

const TREATMENTS: { id: Treatment; label: string; note: string }[] = [
  {
    id: "transcript",
    label: "Transcript",
    note: "Sender-led turns, today's view tightened — consecutive same-agent turns group under one head.",
  },
  {
    id: "split",
    label: "Split",
    note: "Alternating sides — you flush-right, agents flush-left. Quiet panels carry the alignment; not heavy bubbles.",
  },
  {
    id: "document",
    label: "Document",
    note: "Reading-first. Avatar in a quiet gutter, prose at a fixed measure, generous air. For reading, not monitoring.",
  },
  {
    id: "ledger",
    label: "Ledger",
    note: "Dense ops log — one row per turn, click to expand. For monitoring fast, tool-heavy conversations.",
  },
];

type Turn = {
  id: string;
  me: boolean;
  author: string;
  handle: string;
  avatar: string;
  time: string;
  long?: boolean;
  lines?: number;
  replyTo?: string;
  html: string;
};

/** Reuses the live icon-polish conversation from the app, so the treatments
 *  are read against real prose lengths, not lorem. */
const TURNS: Turn[] = [
  {
    id: "t0",
    me: true,
    author: "Art",
    handle: "@art",
    time: "11:02",
    long: true,
    lines: 6,
    html: `<p>Scout logo/icon task: parametric app-icon polish. The OpenScout/Scout cube icon should be off-black/off-white, thicker and softer than the first flat export, with subtle lighting and texture — but <strong>not</strong> blue.</p>
<p>Inspect <code>assets/scout-icon/scoutIcon.ts</code> and <code>src/host/app/apps/logo/seedTemplates/openscout-cube.js</code>. Do not copy assets into OpenScout. Propose specific parameter changes for the large app icon, the tiny favicon, and the monochrome mark. Keep edits in the parametric source and include before/after rationale plus how to rebuild.</p>`,
  },
  {
    id: "t1",
    me: false,
    author: "Atelier",
    handle: "@atelier",
    time: "11:03",
    long: true,
    lines: 7,
    replyTo: "parametric app-icon polish",
    html: `<p>Read both files. Plan, highest-impact first:</p>
<ol>
<li><strong>Thicken the cube.</strong> Bump <code>strokeWidth</code> and <code>outerBoundaryWeight</code> in <code>SCOUT_LOGO_PARAMS</code> — the flat export reads thin at small sizes.</li>
<li><strong>Warm the palette.</strong> Confirm off-black/off-white with a warm cream grain; audit for any residual blue from the night-scout variant.</li>
<li><strong>Favicon legibility.</strong> A separate <code>options.small</code> profile — scale the mark up, drop the inner detail that mud at 16px.</li>
</ol>
<p>Edits stay in the parametric source; I'll attach before/after + rebuild notes.</p>`,
  },
  {
    id: "t2",
    me: true,
    author: "Art",
    handle: "@art",
    time: "11:05",
    html: `<p>Take all three. And surface the active theme in the inspector while you're in there, so I can see which skin a conversation opened with.</p>`,
  },
  {
    id: "t3",
    me: false,
    author: "Atelier",
    handle: "@atelier",
    time: "11:08",
    long: true,
    lines: 6,
    html: `<p>On it. Pulled the params, rebuilt the export, ran a render audit.</p>
<p>The night-scout variant was leaking a faint blue rim at large sizes — traced it to <code>edgeGlow</code> sampling the wrong base. Repointed it at the warm off-black and the rim reads neutral now. No color change to the open-core.</p>`,
  },
  {
    id: "t4",
    me: true,
    author: "Art",
    handle: "@art",
    time: "11:11",
    html: `<p>How's the favicon reading at 16px?</p>`,
  },
  {
    id: "t5",
    me: false,
    author: "Atelier",
    handle: "@atelier",
    time: "11:14",
    html: `<p>Crisp now. Palette confirmed correct: warm off-black <code>#11110F</code> / off-white <code>#FFF7EA</code>, active mode open-core (not teal night-scout); grain is warm cream, rim is neutral. Render audit confirms zero blue — no color change made.</p>`,
  },
  {
    id: "t6",
    me: false,
    author: "Atelier",
    handle: "@atelier",
    time: "11:14",
    long: true,
    lines: 9,
    html: `<p>Thicker/softer, per output:</p>
<ul>
<li><strong>Large icon</strong> (<code>SCOUT_LOGO_PARAMS</code>): strokeWidth 4.7→5.6, outerBoundaryWeight 1.14→1.22, innerHoleWeight 1.34→1.42, edgeGlow 0.16→0.22 (warm halo), floorEcho 0.08→0.12 (grounding), frontEdgeLift 1.08→1.14.</li>
<li><strong>Favicon</strong> (<code>options.small</code>): markScale 1.08→1.12, strokeWidth 5.8→6.4, edgeGlow 0.08→0 (kills mud at 16px).</li>
<li><strong>Monochrome mark</strong>: single-weight outline at 6.0, no glow, no floor — reads clean in a menu bar.</li>
</ul>
<p>All edits confined to the parametric source. Rebuild: <code>bun run icons:build</code> → writes the PNG set + favicon. Before/after sheet + rationale in <code>assets/scout-icon/POLISH-NOTES.md</code>.</p>`,
  },
  {
    id: "t7",
    me: true,
    author: "Art",
    handle: "@art",
    time: "11:16",
    html: `<p>Nice. Now do the apple-touch export and double-check the monochrome mark against the dark menu bar.</p>`,
  },
];

/** Turns this many back from the end stay full regardless of length. Older long
 *  turns fold. (Production threshold is generous — ~10; tightened here so the
 *  rule is visible in a short demo.) */
const RECENT_WINDOW = 3;

/** The live feed that fills the dead-air gap — rotated in the Working turn so the
 *  stream shows motion before the reply lands. Kinds mirror the runtime's tail /
 *  activity event vocabulary (Tool / Edit / Result / Read). */
const ACTIVITY = [
  { kind: "Read", text: "assets/scout-icon/scoutIcon.ts" },
  { kind: "Edit", text: "options.touch — markScale 1.10 → 1.16" },
  { kind: "Tool", text: "icons:build — writing apple-touch-icon.png" },
  { kind: "Result", text: "menu-bar contrast pass — mono mark legible" },
];

export default function ScoutConversationPresentationsStudy() {
  // Deep-link a treatment via ?t=… so each is reviewable (and screenshot-able)
  // directly. Read in a lazy initializer so the first client render is already
  // correct — no post-hydration flash. Falls back to Transcript.
  const [treatment, setTreatment] = useState<Treatment>(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("t");
      if (t && TREATMENTS.some((x) => x.id === t)) return t as Treatment;
    }
    return "transcript";
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const active = TREATMENTS.find((t) => t.id === treatment)!;

  const toggle = (id: string) =>
    setExpanded((m) => ({ ...m, [id]: !m[id] }));

  const total = TURNS.length;

  return (
    <ScoutStudyShell
      pageId="scout-conversation-presentations"
      title="Scout — Conversation Presentations"
      blurb={
        <>
          The active-agent message stream as switchable treatments — the{" "}
          <strong className="text-studio-ink">Presentation</strong> control is
          the future macOS setting. Two goals: kill the dead air before a reply
          lands (every treatment carries a live{" "}
          <strong className="text-studio-ink">Working</strong> turn —
          flight state · latest activity · motion meter), and fix collapse so the{" "}
          <strong className="text-studio-ink">latest turn is always full</strong>{" "}
          and only <em>older</em> long turns fold. No &ldquo;Show more&rdquo; on
          what&rsquo;s in front of you.
        </>
      }
    >
      <ScoutWindow title="scout · conversation · @atelier">
        <div className={styles.surface}>
          {/* ── Presentation switcher (the "settings" control) ───────── */}
          <div className={styles.controls}>
            <span className={styles.controlsLabel}>Presentation</span>
            <div className={styles.switcher} role="tablist">
              {TREATMENTS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={t.id === treatment}
                  className={`${styles.seg} ${t.id === treatment ? styles.active : ""}`}
                  onClick={() => setTreatment(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className={styles.controlNote}>{active.note}</span>
          </div>

          {/* ── Collapse heuristic caption ───────────────────────────── */}
          <div className={styles.heuristic}>
            <b>Latest turn is always full.</b> Recent turns stay full. Only{" "}
            older long turns fold — collapse ages out, it never hides what&rsquo;s
            current.
          </div>

          {/* ── Stream ───────────────────────────────────────────────── */}
          <div className={styles.stream} data-treatment={treatment}>
            {TURNS.map((t, i) => {
              const grouped =
                (treatment === "transcript" || treatment === "document") &&
                i > 0 &&
                TURNS[i - 1].author === t.author;

              const isLast = i === total - 1;
              const aged = i < total - RECENT_WINDOW && !isLast;
              const foldable =
                treatment === "ledger" ? !isLast : Boolean(t.long) && aged;
              const folded = foldable && !expanded[t.id];

              return (
                <TurnRow
                  key={t.id}
                  t={t}
                  grouped={grouped}
                  foldable={foldable}
                  folded={folded}
                  onToggle={() => toggle(t.id)}
                />
              );
            })}

            {/* The live dead-air fix — present in every treatment. */}
            <WorkingTurn />
          </div>

          {/* ── Composer ─────────────────────────────────────────────── */}
          <div className={styles.composer}>
            <div className={styles.composerBox}>
              <span className={styles.composerField}>Message Atelier…</span>
              <button className={styles.send} aria-label="Send">
                <ArrowGlyph />
              </button>
            </div>
          </div>
        </div>
      </ScoutWindow>
    </ScoutStudyShell>
  );
}

function TurnRow({
  t,
  grouped,
  foldable,
  folded,
  onToggle,
}: {
  t: Turn;
  grouped: boolean;
  foldable: boolean;
  folded: boolean;
  onToggle: () => void;
}) {
  return (
    <article
      className={styles.turn}
      data-me={t.me}
      data-grouped={grouped}
      data-folded={folded}
    >
      <div className={styles.rail}>
        {!grouped ? (
          <span
            className={`${styles.avatar} ${t.me ? styles.avatarMe : styles.avatarAgent}`}
          >
            {t.avatar ?? t.author[0]}
          </span>
        ) : null}
      </div>
      <div className={styles.content}>
        {!grouped ? (
          <div className={styles.head}>
            <span className={styles.author}>{t.author}</span>
            <span className={styles.handle}>{t.handle}</span>
            <span className={styles.time}>{t.time}</span>
          </div>
        ) : null}

        {t.replyTo ? (
          <span className={styles.replyCtx}>
            <ReplyGlyph />
            <span className={styles.replyLabel}>reply to</span>
            <span className={styles.replyTitle}>{t.replyTo}</span>
          </span>
        ) : null}

        <div className={styles.bodyWrap}>
          <div
            className={styles.body}
            dangerouslySetInnerHTML={{ __html: t.html }}
          />
        </div>

        {foldable ? (
          <button type="button" className={styles.fold} onClick={onToggle}>
            <FoldGlyph open={!folded} />
            {folded ? (
              <>
                unfold{t.lines ? <> · {t.lines} lines</> : null}
              </>
            ) : (
              <>fold</>
            )}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function WorkingTurn() {
  const [idx, setIdx] = useState(0);
  const [secs, setSecs] = useState(11);

  useEffect(() => {
    const a = setInterval(() => setIdx((i) => (i + 1) % ACTIVITY.length), 1600);
    const b = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const evt = ACTIVITY[idx];
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <article className={`${styles.turn} ${styles.working}`} data-me={false}>
      <div className={styles.rail}>
        <span className={`${styles.avatar} ${styles.avatarAgent} ${styles.workingAvatar}`}>
          At
        </span>
      </div>
      <div className={styles.content}>
        <div className={styles.head}>
          <span className={styles.author}>Atelier</span>
          <span className={styles.flight}>
            <span className={styles.flightDot} /> Working
          </span>
          <span className={styles.time}>
            {mm}:{ss}
          </span>
        </div>

        <div className={styles.activityLine}>
          <span className={styles.kind}>{evt.kind}</span>
          <span className={styles.activityText}>{evt.text}</span>
          <span className={styles.caret} />
        </div>

        <div className={styles.meter} aria-hidden>
          {Array.from({ length: 14 }).map((_, i) => (
            <span key={i} style={{ animationDelay: `${i * 0.07}s` }} />
          ))}
        </div>
      </div>
    </article>
  );
}

/* ── Glyphs ─────────────────────────────────────────────────────────── */

function FoldGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      style={{ transform: open ? "rotate(180deg)" : undefined }}
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplyGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 17 4 12 9 7" />
      <path d="M4 12h11a4 4 0 0 1 4 4v2" />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}
