"use client";

import { useState } from "react";
import { StudyHeader } from "@/components/StudyHeader";
import styles from "./messages-home.module.css";

/**
 * Studio: /messages landing, re-cut for CTAs + full width.
 *
 * Shipped page (MessagesScreen.tsx:154-215): three whisper-weight text
 * shortcuts, a single ~700px column of undifferentiated rows in a ~2200px
 * pane, broker notices carrying the same weight as real asks (7 of 9 unread
 * in the reference capture were identical notices), and a dev note rendering
 * as UI copy. Two treatments below; both kill the note, coalesce notices,
 * and promote the CTAs to real affordances. Studio only until sign-off.
 */

type Ask = {
  from: string;
  kind: string;
  preview: string;
  age: string;
  hot?: boolean;
};

// Kind labels only — flight/session ids live in the inspector (D3).
const ASKS: Ask[] = [
  {
    from: "Openscout",
    kind: "ask",
    preview:
      "Style verdict + full spec. Read-only; no files edited. Full spec (with CSS, DOM, geometry math) written to the shared path for review.",
    age: "6m",
    hot: true,
  },
  {
    from: "Openscout",
    kind: "ask",
    preview:
      "Inspiration only — no edits made. Read SettingsDrawer.tsx AppearanceSection (L141-227), settings-drawer.css; proposal attached.",
    age: "17m",
    hot: true,
  },
  {
    from: "Openscout",
    kind: "ready",
    preview: "READY",
    age: "2h",
  },
];

const RECENT = [
  {
    name: "message-lifecycle-design",
    preview:
      "I'll re-check the worktree on the submit-terminal path, focusing on the claimed P0 fixes…",
    age: "1h",
  },
  { name: "Hudson", preview: "Editable CodeViewer surface landed; integration notes inside.", age: "6h" },
  { name: "Action", preview: "Terminal image drops verified on the branch.", age: "8h" },
];

function CommandBar({ needs }: { needs: number }) {
  // Headline counts only what needs the operator: coalesced notices are one
  // read unit and never inflate the stat.
  return (
    <div className={styles.bar}>
      <button type="button" className={styles.ctaPrimary}>
        <span>+</span> New chat
      </button>
      <button type="button" className={styles.ctaQuiet}>
        Search <span className={styles.ctaKbd}>⌘K</span>
      </button>
      <button type="button" className={styles.ctaQuiet}># Browse channels</button>
      <div className={styles.barStat}>
        <b>{needs} need a reply</b>
      </div>
    </div>
  );
}

function NoticeFold({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <>
      <div className={styles.fold} onClick={onToggle} role="button" tabIndex={0}>
        <span className={styles.foldCount}>7</span>
        broker work-request notices · #message-lifecycle-design
        <span className={styles.foldChevron}>{open ? "▾" : "▸"}</span>
      </div>
      {open &&
        ["drover-7", "bohr-7", "mendel-4"].map((agent) => (
          <div key={agent} className={styles.ask}>
            <span className={`${styles.askDot} ${styles.splitDotIdle}`} />
            <div className={styles.askBody}>
              <div className={styles.askHead}>
                <span className={styles.askFrom}>Openscout</span>
                <span className={styles.askKind}>broker notice</span>
                <span className={styles.askAge}>2h</span>
              </div>
              <p className={styles.askPreview}>
                #message-lifecycle-design has a work request for openscout-{agent}. Reply in
                the canonical thread.
              </p>
            </div>
          </div>
        ))}
    </>
  );
}

function TriageBoard() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`${styles.frame} ${styles.frameWide}`}>
      <CommandBar needs={2} />
      <div className={styles.board}>
        <div className={styles.boardMain}>
          <p className={styles.eyebrow}>
            <b>Needs you</b>
            <span className={styles.eyebrowCount}>2 asks · 1 ready</span>
          </p>
          {ASKS.map((ask) => (
            <div key={`${ask.kind}-${ask.age}`} className={styles.ask} data-hot={ask.hot || undefined}>
              <span className={styles.askDot} />
              <div className={styles.askBody}>
                <div className={styles.askHead}>
                  <span className={styles.askFrom}>{ask.from}</span>
                  <span className={styles.askKind}>{ask.kind}</span>
                  <span className={styles.askAge}>{ask.age}</span>
                </div>
                <p className={styles.askPreview}>{ask.preview}</p>
              </div>
              <div className={styles.askActs}>
                <button type="button" className={`${styles.act} ${styles.actPrimary}`}>
                  Reply
                </button>
                <button type="button" className={styles.act}>
                  Open
                </button>
              </div>
            </div>
          ))}
          <NoticeFold open={open} onToggle={() => setOpen((v) => !v)} />
        </div>
        <div className={styles.boardSide}>
          <div>
            <p className={styles.eyebrow}>
              <b>Recent</b>
            </p>
            {RECENT.map((row) => (
              <div key={row.name} className={styles.sideRow}>
                <span className={styles.sideName}>{row.name}</span>
                <span className={styles.sidePreview}>{row.preview}</span>
                <span className={styles.sideAge}>{row.age}</span>
              </div>
            ))}
          </div>
          <div>
            <p className={styles.eyebrow}>
              <b>Channels</b>
            </p>
            <div className={styles.sideRow}>
              <span className={styles.sideName}>#message-lifecycle-design</span>
              <span className={styles.sidePreview}>5 agents · 2 working</span>
            </div>
          </div>
          <div>
            <p className={styles.eyebrow}>
              <b>Start something</b>
            </p>
            <div className={styles.seed}>
              Ask the fleet… <b>“review the pagination branch”</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SplitInbox() {
  const [selected, setSelected] = useState(0);
  return (
    <div className={`${styles.frame} ${styles.frameWide}`}>
      <CommandBar needs={2} />
      <div className={styles.split}>
        <div className={styles.splitList}>
          <div className={styles.splitSection}>Needs you</div>
          {ASKS.slice(0, 2).map((ask, index) => (
            <div
              key={`${ask.kind}-${ask.age}`}
              className={styles.splitRow}
              data-on={index === selected || undefined}
              onClick={() => setSelected(index)}
            >
              <span className={styles.splitDot} />
              <span className={styles.splitFrom}>{ask.from}</span>
              <span className={styles.askAge}>{ask.age}</span>
              <span className={styles.splitPreview}>{ask.preview}</span>
            </div>
          ))}
          <div className={styles.splitSection}>Notices</div>
          <div className={styles.splitRow}>
            <span className={`${styles.splitDot} ${styles.splitDotIdle}`} />
            <span className={styles.splitFrom}>7 work requests</span>
            <span className={styles.askAge}>2h</span>
            <span className={styles.splitPreview}>#message-lifecycle-design · coalesced</span>
          </div>
          <div className={styles.splitSection}>Recent</div>
          {RECENT.map((row) => (
            <div key={row.name} className={styles.splitRow}>
              <span className={`${styles.splitDot} ${styles.splitDotIdle}`} />
              <span className={styles.splitFrom}>{row.name}</span>
              <span className={styles.askAge}>{row.age}</span>
              <span className={styles.splitPreview}>{row.preview}</span>
            </div>
          ))}
        </div>
        <div className={styles.reader}>
          <div className={styles.readerHead}>
            <span className={styles.splitDot} />
            <span className={styles.readerTitle}>Openscout</span>
            <span className={styles.readerMeta}>{ASKS[selected]!.kind} · session inspector →</span>
          </div>
          <div className={styles.readerBody}>
            {ASKS[selected]!.preview} The full report is at{" "}
            <code>/private/tmp/…/scratchpad/review-style-spec.md</code>; verdicts and the
            geometry math are inline. Reply lands in the same flight.
          </div>
          <div className={styles.composer}>
            <span className={styles.composerHint}>Reply to Openscout…</span>
            <button type="button" className={styles.composerSend}>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MessagesHomeStudy() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="studies · web · messages" title="Messages · the landing earns its width">
        SUPERSEDED by the panel review (2026-07-29): both treatments are landing pages —
        the thing the comms direction&apos;s own diagnosis kills — and B is the one-rail
        wearing different labels. The direction is now /studies/comms-one-rail: the rail
        + conversation IS the triage surface. Salvaged from here: the coalesced-notice
        fold and the &ldquo;N need a reply&rdquo; stat (now in the rail header). Kept for
        the record with the craft fixes applied.
      </StudyHeader>

      <section className="mt-8 space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
          A · Triage board — asks are cards with actions; the side column carries recent + channels
        </h2>
        <TriageBoard />
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
          B · Split inbox — list left, reading pane + inline reply right (Gmail model)
        </h2>
        <SplitInbox />
      </section>
    </main>
  );
}
