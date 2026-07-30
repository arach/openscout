"use client";

/**
 * Studio study: Agent Lanes · loader.
 *
 * The window this study designs: the beat between opening /ops/lanes and the
 * lane deck existing. Today that beat is a centered console card with three
 * fixed step rows (packages/web/client/screens/ops/AgentLanesView.tsx:259).
 * It is honest but inert — nothing moves, nothing counts, and it says the same
 * thing at 80ms as it does at 2.4s.
 *
 * The loader only occupies the *deck region*: the lanes toolbar is already
 * painted above it, and it renders only while zero lane columns exist
 * (AgentLanesView.tsx:1118). So the treatments here have two axes —
 *
 *   · console  — keep the card, make it report (takes A, B)
 *   · deck     — skip the card, draw the destination first (takes C, D)
 *
 * Every number, state token and identity on screen maps to a field the client
 * already holds while loading (see the signals table at the foot). Where a
 * signal does not exist, it is named as a gap instead of invented: discovery
 * resolves atomically, so there is no percentage to fill, and "assemble lanes"
 * has no server event at all — it is client-derived and completes by the deck
 * simply appearing.
 *
 * Playback is a local clock over a scenario timeline. The frame timings come
 * from what the two requests actually cost: hot discovery ~200ms, a deep
 * transcript scan closer to a second, /api/tail/recent with transcript replay
 * the long pole.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EyebrowLabel } from "@/components/EyebrowLabel";
import styles from "./lanes-loader.module.css";

/* ── Signal vocabulary ────────────────────────────────────────────────── */
/* The loader's whole world is `useTailFeed` (packages/web/client/lib/
 * use-tail-feed.ts): two phases, one discovery snapshot, one event array. */

type Phase = "loading" | "ready" | "error";

type Signals = {
  /** loadState.discovery — use-tail-feed.ts:17 */
  discovery: Phase;
  /** loadState.recent — use-tail-feed.ts:18 */
  recent: Phase;
  /** discovery.totals.transcripts */
  sources: number;
  /** discovery.processes.length */
  processes: number;
  /** events.length */
  events: number;
  /** distinct sessions composed into lanes — client-derived */
  lanes: number;
  /** Measured client-side, ms from mount. Null until the phase resolves. */
  discoveryMs: number | null;
  recentMs: number | null;
  deckMs: number | null;
  /** The deck owns the region — the loader is done. */
  deck: boolean;
};

type Frame = Partial<Omit<Signals, "discoveryMs" | "recentMs" | "deckMs" | "deck">> & {
  at: number;
  /** The deck takes over on this frame. */
  deck?: boolean;
};

/** Where the loader hands off — AgentLanesView.tsx:1118-1143. */
type Exit = "deck" | "unavailable" | "empty";

type Scenario = {
  key: string;
  name: string;
  note: string;
  exit: Exit;
  frames: Frame[];
};

const HORIZON = "5m";
/** Hold on the final frame so the end state is readable before replay. */
const HOLD_MS = 900;

const SCENARIOS: Scenario[] = [
  {
    key: "warm",
    name: "Warm",
    note: "hot discovery, cached replay — clears in ~0.6s",
    exit: "deck",
    frames: [
      { at: 0, discovery: "loading", recent: "loading", sources: 0, processes: 0, events: 0, lanes: 0 },
      { at: 210, discovery: "ready", sources: 128, processes: 9 },
      { at: 520, recent: "ready", events: 500, lanes: 9 },
      { at: 610, events: 503, deck: true },
    ],
  },
  {
    key: "cold",
    name: "Cold",
    note: "deep transcript scan — the case the loader is actually for",
    exit: "deck",
    frames: [
      { at: 0, discovery: "loading", recent: "loading", sources: 0, processes: 0, events: 0, lanes: 0 },
      // The socket is live from mount, so events can land before either request.
      { at: 340, events: 3 },
      { at: 620, events: 5 },
      { at: 900, discovery: "ready", sources: 214, processes: 11 },
      { at: 1_240, events: 9 },
      { at: 2_300, recent: "ready", events: 500, lanes: 11 },
      { at: 2_430, events: 506, deck: true },
    ],
  },
  {
    key: "lone",
    name: "Just one",
    note: "one live session — the reveal must not read as a let-down",
    exit: "deck",
    frames: [
      { at: 0, discovery: "loading", recent: "loading", sources: 0, processes: 0, events: 0, lanes: 0 },
      // One live process, so the deck is sized to one cell 230ms in — long
      // before the cut. The reveal is calm, not a collapse from a wall.
      { at: 230, discovery: "ready", sources: 96, processes: 1 },
      { at: 540, recent: "ready", events: 38, lanes: 1 },
      { at: 630, events: 39, deck: true },
    ],
  },
  {
    key: "partial",
    name: "Replay fails",
    note: "discovery lands, /api/tail/recent errors — live signals survive",
    exit: "unavailable",
    frames: [
      { at: 0, discovery: "loading", recent: "loading", sources: 0, processes: 0, events: 0, lanes: 0 },
      { at: 240, discovery: "ready", sources: 98, processes: 7 },
      { at: 700, events: 4 },
      { at: 1_320, events: 6 },
      { at: 1_800, recent: "error" },
    ],
  },
  {
    key: "quiet",
    name: "Quiet",
    note: "both phases land with nothing to show",
    exit: "empty",
    frames: [
      { at: 0, discovery: "loading", recent: "loading", sources: 0, processes: 0, events: 0, lanes: 0 },
      { at: 260, discovery: "ready", sources: 0, processes: 0 },
      { at: 470, recent: "ready", events: 0, lanes: 0 },
    ],
  },
];

/* ── Fixture: identities discovery would return ───────────────────────── */
/* Shape of `discovery.transcripts[]` — source, project, branch, session id,
 * plus a couple of tail lines so a resolved lane reads as the real thing. */

type LaneSeed = {
  id: string;
  harness: string;
  project: string;
  branch: string;
  age: string;
  lines: { glyph: string; text: string }[];
};

const LANE_SEEDS: LaneSeed[] = [
  {
    id: "019fae90-2cb7",
    harness: "codex",
    project: "openscout",
    branch: "codex/new-task-runtime-catalog",
    age: "4s",
    lines: [
      { glyph: "*", text: "Edit packages/runtime/src/local-edge.ts" },
      { glyph: "=", text: "3 hunks applied" },
      { glyph: "*", text: "Bash bun test packages/runtime/src/local-edge.test.ts" },
      { glyph: "=", text: "41 pass, 0 fail" },
      { glyph: "<", text: "Catalog lookup now resolves before spawn." },
    ],
  },
  {
    id: "019fae90-3e26",
    harness: "claude",
    project: "openscout",
    branch: "studio-craft-pass",
    age: "11s",
    lines: [
      { glyph: ">", text: "make it a loader page" },
      { glyph: "*", text: "Read design/studio/lib/studio-pages.ts" },
      { glyph: "*", text: "Write views/lanes-loader.module.css" },
      { glyph: "*", text: "Bash tsc --noEmit -p tsconfig.json" },
      { glyph: "=", text: "clean" },
    ],
  },
  {
    id: "019fad02-91b4",
    harness: "codex",
    project: "hudson",
    branch: "main",
    age: "38s",
    lines: [
      { glyph: "*", text: "Bash swift build --target HudsonKit" },
      { glyph: "=", text: "Compiling HudsonKit (42 sources)" },
      { glyph: "=", text: "Build complete in 18.4s" },
      { glyph: "<", text: "The floating row is Scout-owned now." },
    ],
  },
  {
    id: "019fabc4-77aa",
    harness: "claude",
    project: "talkie",
    branch: "capture-region",
    age: "2m",
    lines: [
      { glyph: "*", text: "Edit Sources/Talkie/RegionCapture.swift" },
      { glyph: "<", text: "Region capture writes a single frame now." },
      { glyph: "~", text: "turn complete" },
    ],
  },
  {
    id: "019fa8f1-04dd",
    harness: "kimi",
    project: "openscout",
    branch: "main",
    age: "3m",
    lines: [
      { glyph: "*", text: "Grep useTailFeed packages/web/client" },
      { glyph: "=", text: "6 matches" },
      { glyph: "*", text: "Read packages/web/client/lib/use-tail-feed.ts" },
      { glyph: "<", text: "Two phases, one snapshot, one event array." },
    ],
  },
  {
    id: "019fa7b0-c210",
    harness: "grok",
    project: "openscout-staging",
    branch: "stage/settled-run-receipt",
    age: "4m",
    lines: [
      { glyph: ">", text: "verify the receipt ledger" },
      { glyph: "*", text: "Bash bun test client/screens/ops" },
      { glyph: "=", text: "561 pass" },
    ],
  },
  {
    id: "019fa5c8-b31f",
    harness: "codex",
    project: "openscout",
    branch: "codex/giga-ui-integration",
    age: "6m",
    lines: [
      { glyph: "*", text: "Edit packages/web/server/service-budgets.ts" },
      { glyph: "~", text: "awaiting review" },
    ],
  },
  {
    id: "019fa2e0-6d74",
    harness: "claude",
    project: "hudson",
    branch: "wip/voice",
    age: "9m",
    lines: [
      { glyph: ">", text: "why does the probe idle at 4% cpu" },
      { glyph: "*", text: "Bash xctrace --template SwiftUI" },
      { glyph: "=", text: "re-render storm in HUDStatusView" },
    ],
  },
];

/** Skeleton lanes drawn before discovery returns anything to count. See
 *  gaps: the client has no memory of the last roster, so this is a
 *  placeholder count, not a prediction. */
const PREFLIGHT_SKELETONS = 3;
/** Deck capacity at this study's frame width × height (4 × 2). */
const DECK_CAPACITY = 8;
/** Identity chips shown in take B before the count takes over. */
const CHIP_CAP = 6;

/* ── Playback ─────────────────────────────────────────────────────────── */

function scenarioDuration(scenario: Scenario): number {
  return scenario.frames[scenario.frames.length - 1].at + HOLD_MS;
}

function deriveSignals(scenario: Scenario, clock: number): Signals {
  const signals: Signals = {
    discovery: "loading",
    recent: "loading",
    sources: 0,
    processes: 0,
    events: 0,
    lanes: 0,
    discoveryMs: null,
    recentMs: null,
    deckMs: null,
    deck: false,
  };
  for (const frame of scenario.frames) {
    if (frame.at > clock) break;
    if (frame.discovery && frame.discovery !== signals.discovery) {
      signals.discovery = frame.discovery;
      if (frame.discovery !== "loading") signals.discoveryMs = frame.at;
    }
    if (frame.recent && frame.recent !== signals.recent) {
      signals.recent = frame.recent;
      if (frame.recent !== "loading") signals.recentMs = frame.at;
    }
    if (frame.sources !== undefined) signals.sources = frame.sources;
    if (frame.processes !== undefined) signals.processes = frame.processes;
    if (frame.events !== undefined) signals.events = frame.events;
    if (frame.lanes !== undefined) signals.lanes = frame.lanes;
    if (frame.deck) {
      signals.deck = true;
      signals.deckMs = frame.at;
    }
  }
  return signals;
}

function usePlayback(scenario: Scenario, speed: number) {
  const duration = scenarioDuration(scenario);
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(true);
  const lastTickRef = useRef(0);

  // Restart whenever the scenario changes — a half-played timeline from
  // another scenario is not a state the app can be in.
  useEffect(() => {
    setClock(0);
    setPlaying(true);
  }, [scenario.key]);

  useEffect(() => {
    if (!playing) return;
    lastTickRef.current = 0;
    let raf = 0;
    const step = (now: number) => {
      const previous = lastTickRef.current || now;
      lastTickRef.current = now;
      const delta = (now - previous) * speed;
      setClock((current) => {
        const next = current + delta;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [duration, playing, speed]);

  const replay = useCallback(() => {
    setClock(0);
    setPlaying(true);
  }, []);

  const scrub = useCallback((value: number) => {
    setPlaying(false);
    setClock(value);
  }, []);

  return { clock, duration, playing, setPlaying, replay, scrub };
}

/* ── Shared bits ──────────────────────────────────────────────────────── */

function stateToken(phase: Phase): "RUN" | "OK" | "WARN" {
  if (phase === "ready") return "OK";
  if (phase === "error") return "WARN";
  return "RUN";
}

function stateClass(phase: Phase): string {
  if (phase === "ready") return `${styles.stepState} ${styles.stateOk}`;
  if (phase === "error") return `${styles.stepState} ${styles.stateWarn}`;
  return styles.stepState;
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

function discoveryDetail(signals: Signals): string {
  if (signals.discovery === "ready") return `${plural(signals.sources, "session source")} indexed`;
  if (signals.discovery === "error") return "session source scan unavailable";
  return "scanning local transcripts and harness processes";
}

function recentDetail(signals: Signals): string {
  if (signals.recent === "ready") return `${plural(signals.events, "recent event")} merged`;
  if (signals.recent === "error") return "history replay unavailable; live signals remain enabled";
  return `reading turns and tool output for the ${HORIZON} view`;
}

/** Counter that flashes once per new value — keyed so the animation replays. */
function Num({ value }: { value: string }) {
  return (
    <span key={value} className={styles.num}>
      {value}
    </span>
  );
}

function ms(value: number | null): string {
  return value === null ? "" : `${Math.round(value)}ms`;
}

/* ── Take A · shipped ─────────────────────────────────────────────────── */

function TakeShipped({ signals }: { signals: Signals }) {
  return (
    <div className={styles.stageCenter}>
      <div className={styles.console}>
        <div className={styles.consoleHead}>
          <span className={styles.signal} aria-hidden />
          <div>
            <span className={styles.kicker}>Starting agent tail</span>
            <h2 className={styles.headline}>Loading live lanes</h2>
          </div>
          <span className={styles.headMeta}>lookback {HORIZON}</span>
        </div>
        <p className={styles.intro}>
          Scout is collecting recent local agent signals before it draws the lane deck.
        </p>
        <div className={styles.log}>
          <div className={styles.stepA}>
            <span className={stateClass(signals.discovery)}>{stateToken(signals.discovery)}</span>
            <strong className={styles.stepName}>discover sessions</strong>
            <code className={styles.stepDetail}>{discoveryDetail(signals)}</code>
          </div>
          <div className={styles.stepA}>
            <span className={stateClass(signals.recent)}>{stateToken(signals.recent)}</span>
            <strong className={styles.stepName}>replay recent tail</strong>
            <code className={styles.stepDetail}>{recentDetail(signals)}</code>
          </div>
          <div className={styles.stepA}>
            <span className={styles.stepState}>LIVE</span>
            <strong className={styles.stepName}>assemble lanes</strong>
            <code className={styles.stepDetail}>building the roster as signals arrive</code>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Take B · the ledger ──────────────────────────────────────────────── */

type LedgerStep = {
  id: string;
  phase: Phase | "derived";
  name: string;
  detail: string;
  timing: string;
  /** Exactly one step is running at a time — it carries the sweep. */
  running: boolean;
  pending: boolean;
};

function ledgerSteps(signals: Signals): LedgerStep[] {
  const assembleDetail = signals.lanes > 0
    ? `${plural(signals.lanes, "lane")} composed`
    : signals.recent === "error"
      // Replay is gone; the roster can only grow from the live socket now.
      ? `${plural(signals.events, "live signal")} in, no history`
      : signals.events > 0
        ? `${plural(signals.events, "signal")} in, waiting on replay`
        : "waiting on first signals";
  const assemblePhase: Phase | "derived" = signals.deckMs !== null ? "ready" : "derived";
  return [
    {
      id: "discover",
      phase: signals.discovery,
      name: "discover sessions",
      detail: discoveryDetail(signals),
      timing: ms(signals.discoveryMs),
      running: signals.discovery === "loading",
      pending: false,
    },
    {
      id: "replay",
      phase: signals.recent,
      name: "replay recent tail",
      detail: recentDetail(signals),
      timing: ms(signals.recentMs),
      running: signals.recent === "loading" && signals.discovery !== "loading",
      pending: signals.discovery === "loading" && signals.recent === "loading",
    },
    {
      id: "assemble",
      phase: assemblePhase,
      name: "assemble lanes",
      detail: assembleDetail,
      timing: ms(signals.deckMs),
      running: signals.recent !== "loading" && signals.deckMs === null,
      pending: signals.recent === "loading",
    },
  ];
}

function ledgerToken(step: LedgerStep): string {
  if (step.phase === "derived") return "LIVE";
  return stateToken(step.phase);
}

function ledgerTokenClass(step: LedgerStep): string {
  if (step.phase === "derived") return styles.stepState;
  return stateClass(step.phase);
}

function LedgerRows({
  signals,
  rowClass,
}: {
  signals: Signals;
  rowClass: string;
}) {
  return (
    <>
      {ledgerSteps(signals).map((step) => (
        <div
          key={step.id}
          className={[
            rowClass,
            step.running ? styles.stepRunning : null,
            step.pending ? styles.stepPending : null,
            step.phase === "ready" ? styles.stepDone : null,
          ].filter(Boolean).join(" ")}
        >
          <span className={ledgerTokenClass(step)}>{ledgerToken(step)}</span>
          <strong className={styles.stepName}>{step.name}</strong>
          <code className={styles.stepDetail}>{step.detail}</code>
          <span className={styles.timing}>{step.timing}</span>
        </div>
      ))}
    </>
  );
}

/** Phases resolved out of three. Not a percentage — nothing reports partials. */
function meterWidth(signals: Signals): string {
  let done = 0;
  if (signals.discovery !== "loading") done += 1;
  if (signals.recent !== "loading") done += 1;
  if (signals.deckMs !== null) done += 1;
  return `${(done / 3) * 100}%`;
}

function FoundChips({ signals }: { signals: Signals }) {
  if (signals.discovery !== "ready" || signals.sources === 0) return null;
  // One row of chips, most-recent first. The rest is a count, not a wall.
  const shown = LANE_SEEDS.slice(0, Math.min(CHIP_CAP, signals.sources));
  const rest = signals.sources - shown.length;
  return (
    <div className={styles.found}>
      {shown.map((seed, index) => (
        <span
          key={seed.id}
          className={styles.foundChip}
          style={{ animationDelay: `${index * 34}ms` }}
        >
          <span className={styles.chipDot} aria-hidden />
          {seed.harness} · {seed.project}
        </span>
      ))}
      {rest > 0 ? <span className={styles.foundMore}>+{rest.toLocaleString()} older</span> : null}
    </div>
  );
}

function TakeLedger({ signals, elapsed }: { signals: Signals; elapsed: number }) {
  const settled = signals.discovery !== "loading" && signals.recent !== "loading";
  // Elapsed ticks in tenths while loading, then freezes on the exact hand-off
  // time. Whole milliseconds at 60fps would just be noise.
  const total = signals.deckMs !== null
    ? ms(signals.deckMs)
    : `${(elapsed / 1000).toFixed(1)}s`;
  return (
    <div className={styles.stageCenter}>
      <div className={styles.console}>
        <div className={styles.consoleHead}>
          <span
            className={settled ? `${styles.signal} ${styles.signalDone}` : styles.signal}
            aria-hidden
          />
          <div>
            <span className={styles.kicker}>Starting agent tail</span>
            <h2 className={styles.headline}>Loading live lanes</h2>
          </div>
          <span className={styles.headMeta}>
            lookback {HORIZON} ·{" "}
            {/* Only the settled total flashes — a tenths counter that flashed
                every tick would strobe. */}
            {signals.deckMs !== null ? <Num value={total} /> : <span className={styles.tick}>{total}</span>}
          </span>
        </div>
        <p className={styles.intro}>
          Scout is collecting recent local agent signals before it draws the lane deck.
        </p>
        <div className={styles.meter} aria-hidden>
          <div className={styles.meterFill} style={{ width: meterWidth(signals) }} />
        </div>
        <div className={styles.log}>
          <LedgerRows signals={signals} rowClass={styles.stepB} />
          <FoundChips signals={signals} />
        </div>
      </div>
    </div>
  );
}

/* ── Takes C + D · the deck arrives first ─────────────────────────────── */

function SkeletonLane({ index }: { index: number }) {
  const delay = `${index * 120}ms`;
  return (
    <div className={styles.skel} aria-hidden>
      <div className={styles.skelHead}>
        <span className={styles.skelDot} style={{ animationDelay: delay }} />
        <span className={styles.skelName} style={{ animationDelay: delay }} />
        <span className={styles.skelMeta} />
      </div>
      <div className={styles.skelBars}>
        {[68, 92, 54, 80, 61, 74].map((width, row) => (
          <span
            key={width}
            className={styles.skelBar}
            style={{ width: `${width}%`, animationDelay: `${index * 120 + row * 90}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Real header from the discovery snapshot, body still waiting on lines. */
function IdentifiedLane({ seed, index }: { seed: LaneSeed; index: number }) {
  return (
    <div
      className={`${styles.card} ${styles.cardIdentified}`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className={styles.cardHead}>
        <span className={styles.cardDot} aria-hidden />
        <span className={styles.cardTitle}>{seed.harness}:{seed.id}</span>
        <span className={styles.cardWhere}>{seed.project}/{seed.branch}</span>
        <span className={styles.cardSpacer} />
        <span className={styles.cardAge}>{seed.age}</span>
      </div>
      <div className={styles.skelBars} aria-hidden>
        {[64, 88, 52, 76].map((width, row) => (
          <span
            key={width}
            className={styles.skelBar}
            style={{ width: `${width}%`, animationDelay: `${index * 100 + row * 90}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function ResolvedLane({ seed, index }: { seed: LaneSeed; index: number }) {
  return (
    <div className={styles.card} style={{ animationDelay: `${index * 45}ms` }}>
      <div className={styles.cardHead}>
        <span className={styles.cardDot} aria-hidden />
        <span className={styles.cardTitle}>{seed.harness}:{seed.id}</span>
        <span className={styles.cardWhere}>{seed.project}/{seed.branch}</span>
        <span className={styles.cardSpacer} />
        <span className={styles.cardAge}>{seed.age}</span>
      </div>
      <div className={styles.cardRows}>
        {seed.lines.map((line) => (
          <div key={line.text} className={styles.cardRow}>
            <span className={styles.cardGlyph}>{line.glyph}</span>
            <span className={styles.cardText}>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The deck region, in three states per cell.
 *
 * The pre-flight deck's problem was that its payoff arrived too late: eight
 * grey boxes until replay finished, which on a cold start is 2.3s of nothing.
 * But identity lands with *discovery*, an order of magnitude earlier — so a
 * cell takes its real header (harness, session, project, age) at ~230ms and
 * only its body waits for lines. Blank → identified → streaming.
 */
function DeckBody({ signals }: { signals: Signals }) {
  // Once discovery has landed, the cell count is the live harness process
  // count — the only field that predicts how many lanes are coming. Sources
  // would overstate wildly (every transcript on disk, not every live session).
  // No live processes means no lanes: take the cells down rather than lie.
  const count = signals.discovery === "loading"
    ? PREFLIGHT_SKELETONS
    : Math.min(signals.processes, DECK_CAPACITY);
  if (count === 0) return <div className={styles.deck} />;

  const streaming = Math.min(signals.lanes, count);
  const identified = signals.discovery === "ready";

  return (
    <div className={styles.deck}>
      {Array.from({ length: count }, (_, index) => {
        const seed = LANE_SEEDS[index % LANE_SEEDS.length];
        if (index < streaming) {
          return <ResolvedLane key={seed.id} seed={seed} index={index} />;
        }
        if (identified) {
          return <IdentifiedLane key={`id-${index}`} seed={seed} index={index} />;
        }
        return <SkeletonLane key={`blank-${index}`} index={index} />;
      })}
    </div>
  );
}

function StripCounts({ signals }: { signals: Signals }) {
  return (
    <>
      <span className={styles.stripItem}>
        <Num value={signals.sources.toLocaleString()} /> sources
      </span>
      <span className={styles.stripItem}>
        <Num value={signals.processes.toLocaleString()} /> live
      </span>
      <span className={styles.stripItem}>
        <Num value={signals.events.toLocaleString()} /> events
      </span>
      {signals.lanes > 0 ? (
        <span className={styles.stripItem}>
          <Num value={signals.lanes.toLocaleString()} /> lanes
        </span>
      ) : null}
    </>
  );
}

function TakeLedgerOnDeck({ signals }: { signals: Signals }) {
  const settled = signals.discovery !== "loading" && signals.recent !== "loading";
  return (
    <>
      <div className={styles.strip}>
        <span
          className={settled ? `${styles.stripDot} ${styles.stripDotDone}` : styles.stripDot}
          aria-hidden
        />
        <span className={styles.stripLead}>starting agent tail</span>
        <StripCounts signals={signals} />
        <span className={styles.stripSpacer} />
        <span className={styles.stripItem}>lookback {HORIZON}</span>
      </div>
      {/* The rail is a loading affordance: it retires the instant the deck
          owns the region, leaving the strip as the only chrome. */}
      {signals.deck ? null : (
        <div className={styles.railLog}>
          <LedgerRows signals={signals} rowClass={styles.railStep} />
        </div>
      )}
      <DeckBody signals={signals} />
    </>
  );
}

/* ── Take E · overlay + signal cut ────────────────────────────────────── */

/** Collapse duration. Long enough to read as one gesture, short enough that
 *  it never delays the deck you already have. */
const CUT_MS = 340;
/** The sheet's retract. Shorter — it is leaving, not performing. */
const SHEET_EXIT_MS = 260;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Progress through the hand-off gesture, 0 → 1. Derived from the clock rather
 *  than a timer so the study can be scrubbed through the exit frame by frame. */
function handoffProgress(signals: Signals, clock: number, durationMs: number): number {
  if (signals.deckMs === null) return 0;
  return clamp01((clock - signals.deckMs) / durationMs);
}

/** Ramp up over [a, b], hold, ramp down over [c, d]. */
function beat(p: number, a: number, b: number, c: number, d: number): number {
  if (p < a) return 0;
  if (p < b) return clamp01((p - a) / (b - a));
  if (p < c) return 1;
  return 1 - clamp01((p - c) / (d - c));
}

/**
 * The cut, as CSS variables. Shared by both overlay treatments so "same
 * treatment, different dock" is literally true.
 *
 * The order a CRT loses signal: content goes, the surface squeezes and
 * dissolves so only the accent line is left, then the line pulls in to a
 * point. The surface must be gone before the squeeze finishes, or the beat
 * reads as a shrinking box instead of a collapsing signal.
 *
 * This is take E's gesture only. A docked sheet gets a plain retract instead —
 * see `sheetExitVars`.
 */
function cutVars(progress: number): CSSProperties {
  const cutX = progress < 0.6
    ? 1 + 0.03 * clamp01(progress / 0.6)
    : 1.03 * (1 - clamp01((progress - 0.6) / 0.4));
  return {
    "--cut-p": progress,
    "--cut-x": cutX,
    "--cut-y": 1 - 0.97 * clamp01((progress - 0.05) / 0.37),
    "--plate-o": 1 - clamp01((progress - 0.2) / 0.3),
    "--body-o": 1 - clamp01(progress / 0.22),
    "--line-o": beat(progress, 0.25, 0.4, 0.68, 1),
    "--scrim": 1 - clamp01((progress - 0.15) / 0.45),
  } as CSSProperties;
}

function SignalCutPlate({
  signals,
  elapsed,
  progress,
}: {
  signals: Signals;
  elapsed: number;
  progress: number;
}) {
  // Gone: the deck below has been at its final size the whole time, so there
  // is nothing to reflow when this unmounts.
  if (progress >= 1) return null;

  const settled = signals.discovery !== "loading" && signals.recent !== "loading";
  const total = signals.deckMs !== null ? ms(signals.deckMs) : `${(elapsed / 1000).toFixed(1)}s`;

  return (
    <div
      className={styles.overlay}
      style={cutVars(progress)}
      role="status"
      aria-live="polite"
    >
      <div className={styles.overlayScrim} aria-hidden />
      <div className={styles.plateWrap}>
        <div className={styles.plate}>
          <div className={styles.plateBody}>
            <div className={styles.plateHead}>
              <span
                className={settled ? `${styles.stripDot} ${styles.stripDotDone}` : styles.stripDot}
                aria-hidden
              />
              <span className={styles.stripLead}>starting agent tail</span>
              <StripCounts signals={signals} />
              <span className={styles.stripSpacer} />
              <span className={styles.tick}>{total}</span>
            </div>
            <div className={styles.log}>
              <LedgerRows signals={signals} rowClass={styles.stepB} />
            </div>
          </div>
        </div>
        <span className={styles.cutLine} aria-hidden />
      </div>
    </div>
  );
}

function TakeSignalCut({
  signals,
  elapsed,
  clock,
}: {
  signals: Signals;
  elapsed: number;
  clock: number;
}) {
  return (
    <>
      <DeckBody signals={signals} />
      <SignalCutPlate
        signals={signals}
        elapsed={elapsed}
        progress={handoffProgress(signals, clock, CUT_MS)}
      />
    </>
  );
}

/* ── Take C · bottom sheet ────────────────────────────────────────────── */

/**
 * The sheet's exit: it leaves the way it arrived, downward off the bottom edge,
 * full width, and that is all.
 *
 * Deliberately *not* the signal cut. A collapse in place would read as the
 * readout turning into the deck — an evolution — and it isn't one: the deck has
 * been sitting there finished the whole time. The sheet is a thing that was
 * covering the bottom of it. So it retracts and the deck is simply there, in
 * place, unmoved.
 */
function sheetExitVars(progress: number): CSSProperties {
  return {
    "--cut-p": progress,
    // Accelerating away rather than easing out — an exit, not a presentation.
    "--sheet-y": progress ** 1.7,
    "--sheet-o": 1 - clamp01((progress - 0.35) / 0.65),
    "--body-o": 1 - clamp01((progress - 0.5) / 0.5),
    "--scrim": 1 - clamp01(progress / 0.7),
  } as CSSProperties;
}

/**
 * Same ledger, docked to the bottom edge instead of centred — an ops checklist
 * rather than a dialog. The deck above is never covered, only separated by a
 * gradient, so it costs the scrim that hid the deck settling.
 */
function SheetLedger({
  signals,
  elapsed,
  progress,
}: {
  signals: Signals;
  elapsed: number;
  progress: number;
}) {
  if (progress >= 1) return null;

  const settled = signals.discovery !== "loading" && signals.recent !== "loading";
  const total = signals.deckMs !== null ? ms(signals.deckMs) : `${(elapsed / 1000).toFixed(1)}s`;

  return (
    <div
      className={styles.sheetLayer}
      style={sheetExitVars(progress)}
      role="status"
      aria-live="polite"
    >
      <div className={styles.sheetVeil} aria-hidden />
      <div className={styles.sheetWrap}>
        <div className={styles.sheetRise}>
          <div className={styles.sheet}>
            <div className={styles.sheetBody}>
              <div className={styles.sheetHead}>
                <span
                  className={settled ? `${styles.stripDot} ${styles.stripDotDone}` : styles.stripDot}
                  aria-hidden
                />
                <span className={styles.stripLead}>starting agent tail</span>
                <StripCounts signals={signals} />
                <span className={styles.stripSpacer} />
                <span className={styles.stripItem}>lookback {HORIZON}</span>
                <span className={styles.tick}>{total}</span>
              </div>
              <div className={styles.sheetLog}>
                <LedgerRows signals={signals} rowClass={styles.sheetStep} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TakeSheet({
  signals,
  elapsed,
  clock,
}: {
  signals: Signals;
  elapsed: number;
  clock: number;
}) {
  return (
    <>
      <DeckBody signals={signals} />
      <SheetLedger
        signals={signals}
        elapsed={elapsed}
        progress={handoffProgress(signals, clock, SHEET_EXIT_MS)}
      />
    </>
  );
}

/* ── Takes ────────────────────────────────────────────────────────────── */

type TakeId = "shipped" | "ledger" | "sheet" | "both" | "cut";

const TAKES: {
  id: TakeId;
  label: string;
  note: string;
  badge?: "rec" | "flag";
  caption: string;
}[] = [
  {
    id: "shipped",
    label: "A · Shipped",
    note: "console card, three fixed rows",
    badge: "flag",
    caption:
      "What ships today. The states are real, but nothing counts, nothing times, and the third row says the same sentence for the whole wait. At 2.4s it reads as stalled.",
  },
  {
    id: "ledger",
    label: "B · Ledger",
    note: "same card, made to report",
    caption:
      "The card kept, the reporting added: measured ms per phase in tabular mono, live counters that flash on change, one sweep on the single row actually working, a hairline meter of phases resolved (not a fake percentage), and the discovered identities landing as chips the moment the snapshot arrives. Same footprint, same vocabulary — it just admits how fast it is.",
  },
  {
    id: "sheet",
    label: "C · Sheet on deck",
    note: "checklist docked bottom, deck uncovered",
    badge: "rec",
    caption:
      "The pre-flight deck's idea was right but its payoff came too late — eight grey boxes until replay finished. Fixed at the source: identity lands with discovery, so each cell takes its real header (harness, session, project, age) at ~230ms and only its body waits for lines. Blank → identified → streaming. The readout then rides the bottom edge as an ops checklist — spine, one box per item, filled as each phase lands — instead of sitting over the middle of the screen, and it leaves the way it came: straight down, full width, 260ms. No collapse in place, because a collapse would read as the readout evolving into the deck, and it isn't one — the deck has been sitting there finished the whole time. The trade: no scrim, so the deck settling is visible rather than hidden (E buys that cover back at the cost of feeling modal).",
  },
  {
    id: "both",
    label: "D · Ledger on deck",
    note: "C's skeleton, B's ledger as a rail",
    caption:
      "The composition, first attempt: pre-flight skeleton underneath, the ledger compressed into three rail rows above it. It reads well while loading — and then costs you a displacement, because the rail occupies a reserved vertical slice that has to disappear, shoving the whole deck upward at the exact moment you start reading it. Kept here for the contrast; E is the fix.",
  },
  {
    id: "cut",
    label: "E · Signal cut",
    note: "centred overlay, collapses at the middle",
    caption:
      "Same ledger, floated over the skeleton instead of given a slice of its own. The deck is at its final size from the first frame, so nothing below the overlay ever moves. Two things then get to happen invisibly under the scrim: the cell count corrects to the true roster, and the skeletons become cards — so the reveal is never a downgrade from a wall of eight to a lonely one (watch the Just one scenario). The exit is a signal cut: content fades, the plate squeezes to a bright hairline, the line pulls into a point. 340ms, one accent beat, and the deck it uncovers has been sitting there finished.",
  },
];

/* ── Study ────────────────────────────────────────────────────────────── */

const SPEEDS = [0.5, 1, 2];

const EXIT_COPY: Record<Exit, string> = {
  deck: "hands off to the lane deck",
  unavailable: "hands off to AgentLanesUnavailableState — retry tail scan",
  empty: "hands off to AgentLanesEmptyState — quiet interval",
};

export function LanesLoaderStudy() {
  const [takeId, setTakeId] = useState<TakeId>("sheet");
  const [scenarioKey, setScenarioKey] = useState(SCENARIOS[1].key);
  const [speed, setSpeed] = useState(1);

  const scenario = useMemo(
    () => SCENARIOS.find((entry) => entry.key === scenarioKey) ?? SCENARIOS[0],
    [scenarioKey],
  );
  const { clock, duration, playing, setPlaying, replay, scrub } = usePlayback(scenario, speed);
  const signals = useMemo(() => deriveSignals(scenario, clock), [scenario, clock]);
  // Elapsed stops at the last real frame — the hold after it is study chrome,
  // not time the loader actually spent.
  const elapsed = Math.min(clock, scenario.frames[scenario.frames.length - 1].at);
  const take = TAKES.find((entry) => entry.id === takeId) ?? TAKES[0];

  const finished = clock >= duration;
  const exitReached = signals.deck
    || (scenario.exit === "unavailable" && signals.recent === "error")
    || (scenario.exit === "empty" && signals.recent === "ready" && signals.sources === 0);

  return (
    <div className={styles.root}>
      <div className={styles.takes} role="tablist" aria-label="Loader takes">
        {TAKES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={takeId === entry.id}
            className={takeId === entry.id ? `${styles.take} ${styles.takeOn}` : styles.take}
            onClick={() => setTakeId(entry.id)}
          >
            <span className={styles.takeId}>{entry.label}</span>
            <span className={styles.takeNote}>{entry.note}</span>
            {entry.badge ? (
              <span
                className={[
                  styles.takeBadge,
                  entry.badge === "rec" ? styles.badgeRec : styles.badgeFlag,
                ].join(" ")}
              >
                {entry.badge === "rec" ? "port" : "today"}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className={styles.transport}>
        <div className={styles.segment} role="group" aria-label="Scenario">
          {SCENARIOS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              title={entry.note}
              className={scenarioKey === entry.key ? `${styles.seg} ${styles.segOn}` : styles.seg}
              onClick={() => setScenarioKey(entry.key)}
            >
              {entry.name}
            </button>
          ))}
        </div>
        <div className={styles.segment} role="group" aria-label="Playback">
          <button type="button" className={styles.seg} onClick={replay}>
            replay
          </button>
          <button
            type="button"
            className={styles.seg}
            onClick={() => (finished ? replay() : setPlaying(!playing))}
          >
            {finished ? "again" : playing ? "pause" : "play"}
          </button>
        </div>
        <div className={styles.segment} role="group" aria-label="Speed">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              className={speed === value ? `${styles.seg} ${styles.segOn}` : styles.seg}
              onClick={() => setSpeed(value)}
            >
              {value}×
            </button>
          ))}
        </div>
        <input
          type="range"
          className={styles.scrub}
          min={0}
          max={Math.round(duration)}
          value={Math.round(clock)}
          onChange={(event) => scrub(Number(event.target.value))}
          aria-label="Scrub timeline"
        />
        <span className={styles.clock}>t+{Math.round(clock)}ms</span>
      </div>

      <div className={styles.frame}>
        <div className={styles.toolbarGhost}>
          <span className={styles.ghostChip}>lanes</span>
          <span className={styles.ghostChip}>{HORIZON}</span>
          <span className={styles.ghostChip}>deck</span>
          <span className={styles.ghostSpacer} />
          <span>toolbar stays painted · loader owns the deck region only</span>
        </div>
        <div className={styles.stage}>
          {takeId === "shipped" ? <TakeShipped signals={signals} /> : null}
          {takeId === "ledger" ? <TakeLedger signals={signals} elapsed={elapsed} /> : null}
          {takeId === "sheet" ? (
            <TakeSheet signals={signals} elapsed={elapsed} clock={clock} />
          ) : null}
          {takeId === "both" ? <TakeLedgerOnDeck signals={signals} /> : null}
          {takeId === "cut" ? (
            <TakeSignalCut signals={signals} elapsed={elapsed} clock={clock} />
          ) : null}
        </div>
        <div className={styles.exit}>
          <span className={styles.exitMark}>{exitReached ? "→" : "·"}</span>
          <span>
            {scenario.name}: {EXIT_COPY[scenario.exit]}
            {exitReached ? "" : " — still loading"}
          </span>
        </div>
      </div>

      <p className={styles.takeNote} style={{ maxWidth: "68ch" }}>
        {take.caption}
      </p>

      <div className={styles.notes}>
        <div>
          <EyebrowLabel size="sm">Signals</EyebrowLabel>
          <p className={styles.takeNote} style={{ maxWidth: "68ch", marginTop: 6 }}>
            Everything the treatments display, and the field it comes from. No step, count or
            identity here is invented for the loader.
          </p>
        </div>
        <div className={styles.sig}>
          {[
            {
              what: "RUN / OK / WARN per phase",
              from: "loadState.discovery · loadState.recent — lib/use-tail-feed.ts:14-19",
            },
            {
              what: "sources indexed",
              from: "discovery.totals.transcripts (AgentLanesView.tsx:723)",
            },
            {
              what: "live processes",
              from: "discovery.processes.length",
            },
            {
              what: "events merged, then ticking",
              from: "events.length after mergeHydratedTailEvents / appendLiveTailEvent",
            },
            {
              what: "lanes composed",
              from: "client-derived roster length — lane columns built from tail events",
            },
            {
              what: "phase timings in ms",
              from: "measured client-side from first render, not reported by the server",
            },
            {
              what: "a cell's real header before it streams",
              from: "discovery.transcripts[] / processes[] — source · project · sessionId · mtimeMs",
            },
            {
              what: "identity chips in B",
              from: "the same snapshot, most-recent first",
            },
            {
              what: "hand-off at the foot",
              from: "the loader's three real exits — AgentLanesView.tsx:1118-1143",
            },
          ].map((row) => (
            <div key={row.what} className={styles.sigRow}>
              <span className={styles.sigWhat}>{row.what}</span>
              <span className={styles.sigFrom}>{row.from}</span>
            </div>
          ))}
        </div>

        <div>
          <EyebrowLabel size="sm">Gaps named, not filled</EyebrowLabel>
        </div>
        <ul className={styles.gaps}>
          <li className={styles.gap}>
            <span className={styles.gapMark}>!</span>
            <span>
              <strong>No partial progress exists.</strong> Both phases are single requests that
              resolve atomically, so a percentage bar or an n-of-N counter would be fiction. B&apos;s
              meter fills by <em>phases resolved</em> (0 → 1/3 → 2/3 → done) and nothing else.
            </span>
          </li>
          <li className={styles.gap}>
            <span className={styles.gapMark}>!</span>
            <span>
              <strong>&quot;assemble lanes&quot; has no signal.</strong> There is no server event for
              it; it is client work that finishes by the deck existing. It can only read LIVE and
              then retire — which is why C and D let the deck itself be the completion.
            </span>
          </li>
          <li className={styles.gap}>
            <span className={styles.gapMark}>!</span>
            <span>
              <strong>The first skeleton count is a placeholder.</strong> Before discovery resolves
              nothing predicts how many lanes are coming, so C/D/E draw {PREFLIGHT_SKELETONS} and
              then correct to <code>discovery.processes.length</code> — live harness processes, the
              one field that tracks the eventual roster. (Sources would overstate by two orders of
              magnitude: 214 transcripts on disk, 11 sessions running.) Persisting the last roster
              length would make even the first count truthful — a small, real follow-up, not
              something to fake here. The rule E follows: cells are only ever sized by evidence, and
              the sizing settles <em>under the scrim</em>, so the cut never reveals fewer lanes than
              the skeleton promised.
            </span>
          </li>
          <li className={styles.gap}>
            <span className={styles.gapMark}>!</span>
            <span>
              <strong>The event counter jumps.</strong> Replay merges ~500 events in one batch, so
              the number steps once and then increments with the socket. Ramping it smoothly would
              misrepresent the data shape — watch the <em>Cold</em> scenario, where a handful of live
              events land before either request returns.
            </span>
          </li>
          <li className={styles.gap}>
            <span className={styles.gapMark}>!</span>
            <span>
              <strong>One lane still looks odd — but not because of the loader.</strong> In{" "}
              <em>Just one</em> the deck holds a single cell from 230ms on, so nothing collapses from
              a wall down to one. It stretches to fill the region because the real grid is{" "}
              <code>repeat(auto-fit, minmax(280px, 1fr))</code>. If that reads badly it is a
              lanes-grid call — cap the stretch or left-align at low counts — and fixing it in the
              loader would only make the loader disagree with the deck it hands off to.
            </span>
          </li>
          <li className={styles.gap}>
            <span className={styles.gapMark}>!</span>
            <span>
              <strong>Stagger is presentation, not progress.</strong> Chips and skeleton→card swaps
              come from one snapshot arriving at one instant; the 34–45ms offsets are easing, and
              they collapse to zero under <code>prefers-reduced-motion</code>.
            </span>
          </li>
        </ul>

        <div>
          <EyebrowLabel size="sm">Motion budget</EyebrowLabel>
          <p className={styles.takeNote} style={{ maxWidth: "68ch", marginTop: 6 }}>
            One 900ms accent pulse on the signal dot (already shipped) · one 1.15s hairline sweep on
            the single row actually working · 180ms flash on a counter that changed · 180ms settle
            when a lane resolves · 1.6s low-amplitude skeleton shimmer. Then one hand-off gesture
            per take: C rises {220}ms on arrival and retracts {SHEET_EXIT_MS}ms downward at full
            width; E collapses in place over {CUT_MS}ms. Both are driven off the clock rather than a
            timer, so they can be scrubbed frame by frame. One accent, no categorical colour, no
            spinner, and no layout that moves. Everything above is off under{" "}
            <code>prefers-reduced-motion</code> — the cut and the retract both degrade to a plain
            fade — and the state transitions still read.
          </p>
        </div>
      </div>
    </div>
  );
}
