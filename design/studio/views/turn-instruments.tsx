"use client";

import { useState } from "react";
import { StudyHeader } from "@/components/StudyHeader";
import { ScoutSkinToggle, type ScoutSkinId } from "@/components/scout/ScoutStudyShell";
import { ScoutPageHeader } from "@/components/scout/ScoutSurface";
import styles from "./turn-instruments.module.css";

/**
 * Turn instruments — the agent turn as a live instrument, prototyped as
 * studio specimens. Source of truth: docs/design/operator-console-harvest.md
 * §2 (header / running-now / steps ledger / actions) and §3 items 2 (keycap
 * chips) and 4 (elapsed hero numeral).
 *
 * House rules under test here:
 *   · ONE accent. "Working" is motion (pulsing dot, blinking caret), never a
 *     second hue. Failure alone may use danger.
 *   · Every font size snaps to the --text-* ladder (tokens.md) — the source
 *     mock's 9.5/10.5/11.5/12.5 rungs are banned.
 *   · The elapsed numeral is FLAT. The mock boxes it; our Instrument
 *     direction bans boxes around stat readouts.
 *
 * Fixture: drover-7 mid-turn on the delivery-journal idempotency fix — 11
 * tool calls, one failed test run, currently re-checking.
 */

type Step = {
  tool: string;
  arg: string;
  result: string;
  tookMs: number;
  error?: boolean;
  live?: boolean;
  /** "42s" — only the current-ledger recreation renders relative ages. */
  ago?: string;
};

const STEPS: Step[] = [
  { tool: "Read", arg: "packages/runtime/src/broker/delivery-journal.ts", result: "412 lines", tookMs: 380 },
  { tool: "Grep", arg: "clientMessageId", result: "9 matches · 4 files", tookMs: 260 },
  { tool: "Read", arg: "packages/protocol/src/envelope.ts", result: "188 lines", tookMs: 210 },
  { tool: "Edit", arg: "delivery-journal.ts", result: "+14 −6", tookMs: 820 },
  { tool: "Bash", arg: "bun test delivery-journal", result: "87 passed", tookMs: 38_900 },
  { tool: "Read", arg: "delivery-journal.test.ts", result: "240 lines", tookMs: 300 },
  { tool: "Edit", arg: "idempotency-key.ts", result: "+22 −9", tookMs: 1_100, ago: "52s" },
  { tool: "Bash", arg: "bun test packages/runtime", result: "✕ error", tookMs: 41_200, error: true, ago: "44s" },
  { tool: "Bash", arg: "git diff --stat", result: "3 files · +41 −17", tookMs: 200, ago: "9s" },
  { tool: "Write", arg: "docs/eng/delivery-journal-notes.md", result: "96 lines", tookMs: 600, ago: "4s" },
  { tool: "Bash", arg: "bun run --cwd apps/desktop check", result: "running", tookMs: 6_300, live: true, ago: "now" },
];

const VISIBLE_STEPS = 5;
/** Took column: at this point a call reads as slow and earns full ink. */
const SLOW_MS = 10_000;

function formatTook(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ── 2 · activity sparkline ─────────────────────────────────────────
   Heights from call duration, sqrt-scaled so a 0.2s diff-stat and a
   41s test run both read. The last few bars take the accent; the error
   bar takes danger; the rest stay hairline. */

function barHeight(tookMs: number, maxMs: number, maxPx: number): number {
  const minPx = Math.max(2, Math.round(maxPx / 5));
  return minPx + Math.round((maxPx - minPx) * Math.sqrt(tookMs / maxMs));
}

function Sparkline({ large = false }: { large?: boolean }) {
  const maxMs = Math.max(...STEPS.map((s) => s.tookMs));
  const maxPx = large ? 40 : 14;
  const recentFrom = STEPS.length - 4;
  return (
    <span
      className={`${styles.spark}${large ? ` ${styles.sparkLarge}` : ""}`}
      role="img"
      aria-label="Tool-call durations, oldest to latest"
    >
      {STEPS.map((s, i) => (
        <span
          key={i}
          className={styles.sparkBar}
          data-tone={s.error ? "error" : i >= recentFrom ? "recent" : undefined}
          style={{ height: barHeight(s.tookMs, maxMs, maxPx) }}
          title={`${s.tool} ${s.arg} — ${formatTook(s.tookMs)}`}
        />
      ))}
    </span>
  );
}

/* ── 1 · steps ledger — proposed ──────────────────────────────────── */

function StepsLedger() {
  const [open, setOpen] = useState(false);
  const hidden = STEPS.length - VISIBLE_STEPS;
  const visible = open ? STEPS : STEPS.slice(-VISIBLE_STEPS);
  const firstN = open ? 1 : STEPS.length - VISIBLE_STEPS + 1;
  return (
    <div className={styles.ledger}>
      <div className={styles.ledgerHead}>
        <span>#</span>
        <span>Tool call</span>
        <span>Result</span>
        <span>Took</span>
      </div>
      <button type="button" className={styles.ledgerFold} onClick={() => setOpen((v) => !v)}>
        {open ? "↓ collapse to last 5" : `↑ ${hidden} earlier steps`}
      </button>
      {visible.map((s, i) => (
        <div
          key={i}
          className={styles.ledgerRow}
          data-error={s.error || undefined}
          data-slow={s.tookMs >= SLOW_MS || undefined}
        >
          <span className={styles.ledgerNum}>{firstN + i}</span>
          <span className={styles.ledgerCall}>
            <span className={styles.ledgerTool}>{s.tool}</span>{" "}
            <span className={styles.ledgerArg}>{s.arg}</span>
          </span>
          <span className={styles.ledgerResult}>
            {s.live ? <span className={styles.caret} style={{ height: 11, width: 6 }} /> : s.result}
          </span>
          <span className={styles.ledgerTook}>{formatTook(s.tookMs)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── 1b · the ledger as shipped today ───────────────────────────────
   A faithful recreation of WorkingTurnSteps (packages/web/client/screens/
   chat/ConversationPanels.tsx): mark · kind · prose body with the outcome
   folded in · relative time. Shown next to the proposal so the delta —
   a real Took column, failure legible at row level — is visible. */

function CurrentLedger() {
  const visible = STEPS.slice(-VISIBLE_STEPS);
  return (
    <div className={styles.currentSteps}>
      <div className={styles.currentElided}>
        {STEPS.length - VISIBLE_STEPS} earlier steps
      </div>
      <ol aria-label="Live steps in this turn">
        {visible.map((s, i) => (
          <li key={i}>
            <span className={styles.currentMark} aria-hidden="true" />
            <span className={styles.currentKind}>Tool</span>
            <span className={styles.currentBody}>
              <span className={styles.currentTool}>{s.tool}</span>
              <span className={styles.currentArg}>{s.arg}</span>
              <span className={styles.currentOutcome}>{s.result}</span>
            </span>
            <span className={styles.currentWhen}>{s.ago}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── 3 · elapsed numeral — flat ───────────────────────────────────── */

function Elapsed() {
  return (
    <div className={styles.elapsed}>
      <span className={styles.elapsedNum}>07:41</span>
      <span className={styles.elapsedMeta}>
        <span className={styles.elapsedLabel}>elapsed</span>
        <span className={styles.elapsedSince}>since 20:53:48</span>
      </span>
    </div>
  );
}

/* ── 4 · keycap chip ──────────────────────────────────────────────── */

function Key({ children }: { children: string }) {
  return <kbd className={styles.key}>{children}</kbd>;
}

/* ── the frame: one working turn, chrome from the ScoutSurface kit ── */

function Frame() {
  return (
    <div className={styles.frame}>
      <ScoutPageHeader
        title="drover-7"
        counts={[
          { n: 11, label: "tools" },
          { n: 1, label: "error", tone: "error" },
        ]}
      />
      <div className={styles.turn}>
        <div className={styles.turnHead}>
          <span className={styles.turnWho}>delivery-journal idempotency</span>
          <span className={styles.sessionChip}>session-kdxw65</span>
          <span className={styles.turnRuntime}>codex · tmux</span>
          <Sparkline />
          <span className={styles.working}>
            <span className={styles.workDot} /> Working 07:41
          </span>
        </div>
        <div className={styles.running}>
          <span className={styles.runningCmd}>bun run --cwd apps/desktop check</span>
          <span className={styles.caret} />
        </div>
        <div className={styles.turnActions}>
          <button type="button" className={styles.turnAction}>Observe</button>
          <button type="button" className={styles.turnAction}>Terminal</button>
          <button type="button" className={styles.turnAction}>Steer</button>
        </div>
      </div>
    </div>
  );
}

/* ── the study ────────────────────────────────────────────────────── */

export default function TurnInstrumentsStudy() {
  const [skin, setSkin] = useState<ScoutSkinId>(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("skin");
      if (q === "juniper-l" || q === "juniper-d" || q === "graphite") return q;
    }
    return "juniper-l";
  });
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <StudyHeader eyebrow="studies · web · comms" title="Turn · the live instrument">
          The agent turn as a work object, from the operator-console harvest:
          a steps ledger with a real Took column shown next to the ledger we
          ship today, an activity sparkline that must read at 40px in a turn
          header, a flat elapsed numeral (no box — the Instrument rule), and
          the keycap chip for the chords we actually ship. One accent only;
          working is motion; failure alone is danger.
        </StudyHeader>
        <ScoutSkinToggle skin={skin} setSkin={setSkin} />
      </div>

      <div data-scout-skin={skin}>
        <section className="mt-8 space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
            The frame — sparkline at working size, inline in the turn header
          </h2>
          <Frame />
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
            1 · Steps ledger — proposed, next to what we ship
          </h2>
          <div className={styles.specimens} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
            <div className={styles.specimen}>
              <span className={styles.specimenLabel}>
                current · WorkingTurnSteps — mark · kind · prose body · ago
              </span>
              <div className={styles.stage}>
                <CurrentLedger />
              </div>
              <p className={styles.specimenNote}>
                The outcome folds into the body as prose and durations never
                surface — a 41s test run and a 0.2s diff weigh the same.
              </p>
            </div>
            <div className={styles.specimen}>
              <span className={styles.specimenLabel}>
                proposed · # · tool call · result · took — tabular, one row per call
              </span>
              <div className={styles.stage} style={{ padding: "10px 0" }}>
                <StepsLedger />
              </div>
              <p className={styles.specimenNote}>
                Slow calls earn full ink down the Took edge; the failed run
                carries a 2px danger rule and an ✕ result — glance, scan, read
                all land. Click the fold to open the 6 earlier steps.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
            2 · Activity sparkline — the last 11 calls in 43px
          </h2>
          <div className={styles.specimens}>
            <div className={styles.specimen}>
              <span className={styles.specimenLabel}>
                real size · 11 × 3px bars, 1px gaps — the size constraint is the test
              </span>
              <div className={styles.stage}>
                <Sparkline />
              </div>
              <p className={styles.specimenNote}>
                Heights are sqrt-scaled durations. Accent marks the four most
                recent calls; the failed run is the danger bar; history stays
                hairline.
              </p>
            </div>
            <div className={styles.specimen}>
              <span className={styles.specimenLabel}>
                inspection twin · same data at 3×, for review only
              </span>
              <div className={styles.stage}>
                <Sparkline large />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
            3 · Elapsed numeral — flat: the surface is the only frame
          </h2>
          <div className={styles.specimen} style={{ maxWidth: 560 }}>
            <span className={styles.specimenLabel}>
              MM:SS at --text-9xl (48px) · tabular-nums · no box, no fill
            </span>
            <div className={styles.flatStage}>
              <Elapsed />
            </div>
            <p className={styles.specimenNote}>
              The source mock puts this in a stat card; the Instrument
              direction bans boxes around readouts, so the numeral sits
              directly on the surface.
            </p>
          </div>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-eyebrow text-studio-ink-faint">
            4 · Keycap chip — 1px border, 2px bottom edge, raised fill
          </h2>
          <div className={styles.specimen} style={{ maxWidth: 760 }}>
            <span className={styles.specimenLabel}>
              the chords we actually ship — palette, send, newline, g-prefix nav
            </span>
            <div className={styles.stage}>
              <div className={styles.keys}>
                <span className={styles.keyUnit}>
                  <Key>⌘K</Key>
                  <span className={styles.keyLabel}>palette</span>
                </span>
                <span className={styles.keyUnit}>
                  <Key>⏎</Key>
                  <span className={styles.keyLabel}>send</span>
                </span>
                <span className={styles.keyUnit}>
                  <Key>⇧⏎</Key>
                  <span className={styles.keyLabel}>newline</span>
                </span>
                <span className={styles.keyUnit}>
                  <Key>g</Key>
                  <Key>c</Key>
                  <span className={styles.keyDest}>comms</span>
                </span>
                <span className={styles.keyUnit}>
                  <Key>g</Key>
                  <Key>f</Key>
                  <span className={styles.keyDest}>tail</span>
                </span>
                <span className={styles.keyUnit}>
                  <Key>g</Key>
                  <Key>p</Key>
                  <span className={styles.keyDest}>projects</span>
                </span>
                <span className={styles.keyUnit}>
                  <Key>g</Key>
                  <Key>g</Key>
                  <span className={styles.keyDest}>top</span>
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
