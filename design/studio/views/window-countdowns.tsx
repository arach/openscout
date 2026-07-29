"use client";

/**
 * THESIS: Treat reset time as operational data, not metadata; refuse a gallery
 * of disconnected mock cards by driving every proposal from one live state.
 * OWN-WORLD: Scout's restrained instrument panel—hairlines, quiet wells,
 * tabular mono measurements, and amber reserved for urgency.
 * STORY: Compare six Grok proposals, force edge states, then choose the grammar
 * that remains legible at desktop and rail width.
 * FIRST VIEWPORT: Decision controls and the recommended symmetric treatment
 * appear together, with the full ranked comparison immediately below.
 * FORM: A precision comparison bench inside the established Studio world;
 * narrow extension, so no concept seed or replacement visual system.
 */

import { useEffect, useMemo, useState } from "react";
import { StudyHeader } from "@/components/StudyHeader";
import styles from "./window-countdowns.module.css";

type ScenarioKey = "normal" | "imminent" | "due" | "stale";
type WidthKey = "wide" | "narrow";

type Scenario = {
  key: ScenarioKey;
  label: string;
  note: string;
  shortOffsetMs: number;
  longOffsetMs: number;
  shortUsed: number;
  longUsed: number;
};

type CountdownModel = {
  scenario: ScenarioKey;
  shortResetAt: number;
  longResetAt: number;
  shortUsed: number;
  longUsed: number;
};

const SCENARIOS: Scenario[] = [
  {
    key: "normal",
    label: "Normal",
    note: "Enough runway to scan both windows without urgency competing with usage.",
    shortOffsetMs: 1 * 3_600_000 + 48 * 60_000 + 22_000,
    longOffsetMs: 2 * 86_400_000 + 14 * 3_600_000 + 22 * 60_000 + 7_000,
    shortUsed: 62,
    longUsed: 41,
  },
  {
    key: "imminent",
    label: "Imminent",
    note: "Under six hours: time turns amber while the rest of the row stays quiet.",
    shortOffsetMs: 22 * 60_000 + 17_000,
    longOffsetMs: 5 * 3_600_000 + 41 * 60_000 + 9_000,
    shortUsed: 88,
    longUsed: 84,
  },
  {
    key: "due",
    label: "Reset due",
    note: "The deadline elapsed moments ago; usage is refreshing and should not look authoritative.",
    shortOffsetMs: -32_000,
    longOffsetMs: -74_000,
    shortUsed: 88,
    longUsed: 84,
  },
  {
    key: "stale",
    label: "Stale",
    note: "The reported reset is materially overdue; the interface names the age instead of guessing.",
    shortOffsetMs: -2 * 3_600_000 - 12 * 60_000,
    longOffsetMs: -8 * 3_600_000 - 24 * 60_000,
    shortUsed: 62,
    longUsed: 41,
  },
];

const CONCEPTS = [
  {
    rank: 1,
    name: "Symmetric dual countdowns",
    summary: "Give both reset columns one relative-time grammar; let the weekly window carry an absolute second line.",
    keeps: "Fast comparison · existing five-column model",
    costs: "Widest reset columns",
    recommended: true,
  },
  {
    rank: 2,
    name: "Pressure · reset pairs",
    summary: "Bind remaining time to its usage bar so pressure and recovery read as one measurement.",
    keeps: "Strong window ownership · compact scan",
    costs: "Denser usage cells",
    recommended: false,
  },
  {
    rank: 3,
    name: "Dual-rail reset cell",
    summary: "Stack both reset clocks in one shared rail, freeing horizontal space for the usage bars.",
    keeps: "Stable alignment · efficient width",
    costs: "Changes the five-column header",
    recommended: false,
  },
  {
    rank: 4,
    name: "Critical path first",
    summary: "Promote the window that needs attention first and retain the other as ghost context.",
    keeps: "Fastest urgent read",
    costs: "Window position changes by row",
    recommended: false,
  },
  {
    rank: 5,
    name: "Absolute schedule",
    summary: "Lead with the wall-clock deadline and add relative time only when the reset becomes imminent.",
    keeps: "Easy calendar planning",
    costs: "Less countdown-forward",
    recommended: false,
  },
  {
    rank: 6,
    name: "Countdown end-caps",
    summary: "Dock the clock at the end of each micro-bar so quota pressure and reset occupy one silhouette.",
    keeps: "Maximum density · immediate pairing",
    costs: "Highest responsive and accessibility risk",
    recommended: false,
  },
] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function durationParts(resetAt: number, nowMs: number) {
  const totalSeconds = Math.max(0, Math.floor((resetAt - nowMs) / 1000));
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
  };
}

function relativeLabel(
  resetAt: number,
  nowMs: number,
  scenario: ScenarioKey,
  form: "clock" | "words" | "tight" = "words",
): string {
  if (scenario === "due") return form === "tight" ? "due" : "due · refresh";
  if (scenario === "stale") {
    const overdueMinutes = Math.floor((nowMs - resetAt) / 60_000);
    const hours = Math.floor(overdueMinutes / 60);
    const minutes = overdueMinutes % 60;
    return form === "tight" ? `stale +${hours}h` : `stale +${hours}h ${minutes}m`;
  }
  const { days, hours, minutes, seconds } = durationParts(resetAt, nowMs);
  if (form === "clock") {
    return days > 0
      ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  if (form === "tight") {
    if (days > 0) return `${days}d${hours}h`;
    if (hours > 0) return `${hours}h${pad(minutes)}`;
    return `${minutes}m`;
  }
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${pad(seconds)}s`;
}

function absoluteLabel(resetAt: number, longWindow = false): string {
  const reset = new Date(resetAt);
  const time = reset.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return longWindow
    ? `${reset.toLocaleDateString([], { weekday: "short" })} ${time}`
    : time;
}

function stateClass(scenario: ScenarioKey): string {
  if (scenario === "imminent") return styles.imminent;
  if (scenario === "due") return styles.due;
  if (scenario === "stale") return styles.stale;
  return "";
}

function Usage({ label, used, tableCell = false }: { label: string; used: number; tableCell?: boolean }) {
  return (
    <span
      className={styles.usage}
      role={tableCell ? "cell" : undefined}
      aria-label={`${label} quota ${used} percent used`}
    >
      <span className={styles.windowLabel}>{label}</span>
      <span className={styles.bar} aria-hidden="true">
        <span className={styles.barFill} style={{ width: `${used}%` }} />
      </span>
      <strong>{used}%</strong>
    </span>
  );
}

function ResetChip({
  resetAt,
  nowMs,
  scenario,
  longWindow = false,
  tableCell = false,
}: {
  resetAt: number;
  nowMs: number;
  scenario: ScenarioKey;
  longWindow?: boolean;
  tableCell?: boolean;
}) {
  const relative = scenario === "due" ? "due" : relativeLabel(resetAt, nowMs, scenario, "clock");
  const secondary = scenario === "due"
    ? "refreshing…"
    : scenario === "stale"
      ? "provider overdue"
      : longWindow
        ? absoluteLabel(resetAt, true)
        : null;
  return (
    <span
      className={`${styles.resetChip} ${stateClass(scenario)}`}
      role={tableCell ? "cell" : undefined}
      aria-live="off"
      aria-label={`${longWindow ? "Weekly" : "Short"} quota resets ${relative}`}
    >
      <strong>
        <span aria-hidden="true">↻ </span>
        <time dateTime={new Date(resetAt).toISOString()}>{relative}</time>
      </strong>
      {secondary ? (
        scenario === "normal" || scenario === "imminent"
          ? <time dateTime={new Date(resetAt).toISOString()}>{secondary}</time>
          : <span>{secondary}</span>
      ) : null}
    </span>
  );
}

function SymmetricSpecimen({ model, nowMs, twoRows = false }: { model: CountdownModel; nowMs: number; twoRows?: boolean }) {
  const codexShortResetAt = model.scenario === "normal" || model.scenario === "imminent"
    ? model.shortResetAt + 72 * 60_000
    : model.shortResetAt;
  const codexLongResetAt = model.scenario === "normal" || model.scenario === "imminent"
    ? model.longResetAt + 9 * 3_600_000
    : model.longResetAt;
  return (
    <div className={styles.symmetricTable} role="table" aria-label="Symmetric dual countdown treatment">
      <div className={styles.fiveColumnHead} role="row">
        <span role="columnheader">service</span>
        <span role="columnheader">short window</span>
        <span role="columnheader">resets in</span>
        <span role="columnheader">long window</span>
        <span role="columnheader">resets in</span>
      </div>
      <div className={styles.fiveColumnRow} role="row">
        <span className={styles.service} role="cell">claude</span>
        <Usage label="5h" used={model.shortUsed} tableCell />
        <ResetChip resetAt={model.shortResetAt} nowMs={nowMs} scenario={model.scenario} tableCell />
        <Usage label="7d" used={model.longUsed} tableCell />
        <ResetChip resetAt={model.longResetAt} nowMs={nowMs} scenario={model.scenario} longWindow tableCell />
      </div>
      {twoRows ? (
        <div className={styles.fiveColumnRow} role="row">
          <span className={styles.service} role="cell">codex</span>
          <Usage label="5h" used={31} tableCell />
          <ResetChip resetAt={codexShortResetAt} nowMs={nowMs} scenario={model.scenario} tableCell />
          <Usage label="7d" used={94} tableCell />
          <ResetChip resetAt={codexLongResetAt} nowMs={nowMs} scenario={model.scenario} longWindow tableCell />
        </div>
      ) : null}
    </div>
  );
}

function BoundWindow({ label, used, resetAt, nowMs, scenario }: {
  label: string;
  used: number;
  resetAt: number;
  nowMs: number;
  scenario: ScenarioKey;
}) {
  return (
    <span className={styles.boundWindow} aria-label={`${label} quota ${used} percent used, resets ${relativeLabel(resetAt, nowMs, scenario)}`}>
      <span className={styles.boundReadout}>
        <span>{label}</span>
        <strong>{scenario === "due" ? "—" : `${used}%`}</strong>
        <span className={stateClass(scenario)}>· {relativeLabel(resetAt, nowMs, scenario, "tight")}</span>
      </span>
      <span className={styles.boundBar} aria-hidden="true"><span style={{ width: `${used}%` }} /></span>
    </span>
  );
}

function BoundSpecimen({ model, nowMs }: { model: CountdownModel; nowMs: number }) {
  return (
    <div className={styles.boundRow}>
      <span className={styles.service}>claude</span>
      <BoundWindow label="5h" used={model.shortUsed} resetAt={model.shortResetAt} nowMs={nowMs} scenario={model.scenario} />
      <BoundWindow label="7d" used={model.longUsed} resetAt={model.longResetAt} nowMs={nowMs} scenario={model.scenario} />
    </div>
  );
}

function DualRailSpecimen({ model, nowMs }: { model: CountdownModel; nowMs: number }) {
  return (
    <div className={styles.dualRailRow}>
      <span className={styles.service}>claude</span>
      <Usage label="5h" used={model.shortUsed} />
      <Usage label="7d" used={model.longUsed} />
      <span className={styles.resetRail} aria-live="off">
        <span className={stateClass(model.scenario)}><b>5h</b> ↻ {relativeLabel(model.shortResetAt, nowMs, model.scenario, "tight")}</span>
        <span className={stateClass(model.scenario)}><b>7d</b> ↻ {relativeLabel(model.longResetAt, nowMs, model.scenario, "tight")}</span>
      </span>
    </div>
  );
}

function CriticalSpecimen({ model, nowMs }: { model: CountdownModel; nowMs: number }) {
  const shortRelative = relativeLabel(model.shortResetAt, nowMs, model.scenario, "tight");
  const longRelative = relativeLabel(model.longResetAt, nowMs, model.scenario, "tight");
  return (
    <div className={styles.criticalTable}>
      <div className={styles.criticalRow}>
        <span className={styles.service}>claude</span>
        <span><b>5h</b> {model.shortUsed}%</span>
        <span><b>7d</b> {model.longUsed}%</span>
        <span className={`${styles.criticalReset} ${stateClass(model.scenario)}`}>↻ {shortRelative} <b>(5h)</b> <i>· 7d {longRelative}</i></span>
      </div>
      <div className={styles.criticalRow}>
        <span className={styles.service}>codex</span>
        <span><b>5h</b> 31%</span>
        <span><b>7d</b> 94%</span>
        <span className={`${styles.criticalReset} ${stateClass(model.scenario)}`}>
          ↻ {longRelative} <b>(7d)</b> <i>· 5h {shortRelative}</i>
        </span>
      </div>
    </div>
  );
}

function AbsoluteSpecimen({ model, nowMs }: { model: CountdownModel; nowMs: number }) {
  const relative = relativeLabel(model.shortResetAt, nowMs, model.scenario, "tight");
  const absolute = model.scenario === "due"
    ? `due · was ${absoluteLabel(model.shortResetAt)}`
    : model.scenario === "stale"
      ? `stale · was ${absoluteLabel(model.shortResetAt)}`
      : model.scenario === "imminent"
        ? `${relative} → ${absoluteLabel(model.shortResetAt)}`
        : absoluteLabel(model.shortResetAt);
  const longAbsolute = model.scenario === "due"
    ? `due · was ${absoluteLabel(model.longResetAt, true)}`
    : model.scenario === "stale"
      ? `stale · was ${absoluteLabel(model.longResetAt, true)}`
      : absoluteLabel(model.longResetAt, true);
  return (
    <div className={styles.absoluteRow}>
      <span className={styles.service}>claude</span>
      <Usage label="5h" used={model.shortUsed} />
      <time className={stateClass(model.scenario)} dateTime={new Date(model.shortResetAt).toISOString()}>↻ {absolute}</time>
      <Usage label="7d" used={model.longUsed} />
      <time className={stateClass(model.scenario)} dateTime={new Date(model.longResetAt).toISOString()}>↻ {longAbsolute}</time>
    </div>
  );
}

function EndcapWindow({ label, used, resetAt, nowMs, scenario }: {
  label: string;
  used: number;
  resetAt: number;
  nowMs: number;
  scenario: ScenarioKey;
}) {
  return (
    <span className={styles.endcapWindow} aria-label={`${label} quota ${used} percent used, resets ${relativeLabel(resetAt, nowMs, scenario)}`}>
      <span className={styles.endcapLabel}>{label}</span>
      <span className={styles.endcapBar} aria-hidden="true">
        <span className={styles.endcapFill} style={{ width: `${used}%` }} />
        <strong className={stateClass(scenario)}>{relativeLabel(resetAt, nowMs, scenario, "tight")}</strong>
      </span>
      <span>{used}%</span>
    </span>
  );
}

function EndcapSpecimen({ model, nowMs }: { model: CountdownModel; nowMs: number }) {
  return (
    <div className={styles.endcapRow}>
      <span className={styles.service}>claude</span>
      <EndcapWindow label="5h" used={model.shortUsed} resetAt={model.shortResetAt} nowMs={nowMs} scenario={model.scenario} />
      <EndcapWindow label="7d" used={model.longUsed} resetAt={model.longResetAt} nowMs={nowMs} scenario={model.scenario} />
    </div>
  );
}

function ConceptSpecimen({ rank, model, nowMs }: { rank: number; model: CountdownModel; nowMs: number }) {
  if (rank === 1) return <SymmetricSpecimen model={model} nowMs={nowMs} />;
  if (rank === 2) return <BoundSpecimen model={model} nowMs={nowMs} />;
  if (rank === 3) return <DualRailSpecimen model={model} nowMs={nowMs} />;
  if (rank === 4) return <CriticalSpecimen model={model} nowMs={nowMs} />;
  if (rank === 5) return <AbsoluteSpecimen model={model} nowMs={nowMs} />;
  return <EndcapSpecimen model={model} nowMs={nowMs} />;
}

export default function WindowCountdownsStudy() {
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("normal");
  const [width, setWidth] = useState<WidthKey>(() => window.innerWidth < 900 ? "narrow" : "wide");
  const [anchorMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(anchorMs);
  const scenario = SCENARIOS.find((item) => item.key === scenarioKey) ?? SCENARIOS[0];
  const model = useMemo<CountdownModel>(() => ({
    scenario: scenario.key,
    shortResetAt: anchorMs + scenario.shortOffsetMs,
    longResetAt: anchorMs + scenario.longOffsetMs,
    shortUsed: scenario.shortUsed,
    longUsed: scenario.longUsed,
  }), [anchorMs, scenario]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className={styles.page}>
      <StudyHeader eyebrow="studies · web · home" title="Window countdowns" className={styles.header}>
        Six Grok-proposed treatments for short and weekly quota resets, tested against the same live
        clock and edge states. Illustrative usage only. The recommended direction keeps both windows
        symmetric and lets urgency—not ornament—change the row.
      </StudyHeader>

      <section className={styles.bench} aria-labelledby="countdown-bench-title">
        <div className={styles.benchTop}>
          <div>
            <span className={styles.kicker}>comparison controls</span>
            <h2 id="countdown-bench-title">One state, six treatments</h2>
            <p>{scenario.note}</p>
          </div>
          <div className={styles.controls}>
            <fieldset>
              <legend>Quota state</legend>
              <div className={styles.segmented}>
                {SCENARIOS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={scenarioKey === item.key}
                    onClick={() => setScenarioKey(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Preview width</legend>
              <div className={styles.segmented}>
                {(["wide", "narrow"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={width === item}
                    onClick={() => setWidth(item)}
                  >
                    {item === "wide" ? "Desktop" : "Rail"}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </div>

        <div className={styles.recommendation} data-width={width}>
          <div className={styles.recommendationLabel}>
            <span>Grok recommendation</span>
            <strong>Symmetric dual countdowns</strong>
            <code>ref:v-lii5sm</code>
          </div>
          <div className={styles.viewport}>
            <SymmetricSpecimen model={model} nowMs={nowMs} twoRows />
          </div>
        </div>
      </section>

      <section className={styles.gallery} aria-labelledby="countdown-gallery-title" data-width={width}>
        <div className={styles.galleryHead}>
          <h2 id="countdown-gallery-title">Ranked treatments</h2>
          <p>Use the controls above to force every specimen through the same operational state.</p>
        </div>

        {CONCEPTS.map((concept) => (
          <article key={concept.rank} className={styles.concept} data-recommended={concept.recommended || undefined}>
            <header className={styles.conceptHead}>
              <span className={styles.rank}>rank {concept.rank} / 6</span>
              <div>
                <h3>{concept.name}</h3>
                <p>{concept.summary}</p>
              </div>
              {concept.recommended ? <span className={styles.recommendedTag}>recommended</span> : null}
            </header>
            <div className={styles.specimenViewport}>
              <ConceptSpecimen rank={concept.rank} model={model} nowMs={nowMs} />
            </div>
            <dl className={styles.tradeoffs}>
              <div><dt>keeps</dt><dd>{concept.keeps}</dd></div>
              <div><dt>costs</dt><dd>{concept.costs}</dd></div>
            </dl>
          </article>
        ))}
      </section>

      <footer className={styles.notes}>
        <strong>Shared behavior</strong>
        <span>Countdowns use the local clock; quota fills stay poll-driven.</span>
        <span>Amber begins under six hours.</span>
        <span>Ticking text is never an ARIA live region.</span>
      </footer>
    </main>
  );
}
