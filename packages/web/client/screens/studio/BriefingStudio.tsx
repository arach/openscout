import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";

import {
  briefGenerationSequence,
  mockBriefObservations,
  totalSequenceDuration,
  type BriefStep,
} from "./brief-sequence.ts";

import {
  BriefSequenceView,
  SamplePanel,
  buildInitialRuntime,
  stepIcon,
  type RuntimeStep,
  type StepState,
} from "../../components/brief-sequence/index.tsx";

import "./briefing-studio.css";

type Phase = "idle" | "generating" | "done";
type View = "logs" | "sequence" | "carousel";

const SPEEDS: { value: number; label: string }[] = [
  { value: 0.5, label: "0.5x" },
  { value: 1, label: "1x" },
  { value: 2, label: "2x" },
  { value: 4, label: "4x" },
];

const VIEWS: { id: View; label: string }[] = [
  { id: "logs", label: "LOGS" },
  { id: "sequence", label: "SEQUENCE" },
  { id: "carousel", label: "CAROUSEL" },
];

const QUICK_SCAN: { id: string; text: string; accent?: "warn" | "err" }[] = [
  { id: "qa", text: "47 agents available · 5 active right now" },
  { id: "qb", text: "3 broker errors flagged on workspace-hero", accent: "warn" },
  { id: "qc", text: "1 idle agent on hkshell · last activity 6h ago", accent: "warn" },
];

const VIEW_STORAGE_KEY = "openscout.studio.briefing.view";

function resolveInitialView(): View {
  if (typeof window === "undefined") return "sequence";
  try {
    const fromUrl = new URL(window.location.href).searchParams.get("view");
    if (fromUrl === "logs" || fromUrl === "sequence" || fromUrl === "carousel") {
      window.localStorage.setItem(VIEW_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "logs" || stored === "sequence" || stored === "carousel") return stored;
  } catch {
    /* swallow */
  }
  return "sequence";
}

function persistView(view: View): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* swallow */
  }
}

function closeStudio(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("studio");
  window.history.replaceState({}, "", url.toString());
  window.location.reload();
}

export function BriefingStudio() {
  const steps = briefGenerationSequence;
  const totalDuration = useMemo(() => totalSequenceDuration(steps), [steps]);

  const [view, setView] = useState<View>(resolveInitialView);
  const [speed, setSpeed] = useState<number>(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [playing, setPlaying] = useState<boolean>(false);
  const [runtime, setRuntime] = useState<RuntimeStep[]>(() =>
    buildInitialRuntime(steps),
  );

  const rafRef = useRef<number | null>(null);
  const stepStartRef = useRef<number | null>(null);
  const stepIndexRef = useRef<number>(0);

  const setViewPersistent = useCallback((next: View) => {
    setView(next);
    persistView(next);
  }, []);

  const goIdle = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stepStartRef.current = null;
    stepIndexRef.current = 0;
    setRuntime(buildInitialRuntime(steps));
    setPhase("idle");
    setPlaying(false);
  }, [steps]);

  const startGeneration = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stepStartRef.current = null;
    stepIndexRef.current = 0;
    setRuntime(buildInitialRuntime(steps));
    setPhase("generating");
    setPlaying(true);
  }, [steps]);

  useEffect(() => {
    if (phase !== "generating" || !playing) return;

    const tick = (now: number) => {
      // Capture the step index up-front so the closures we hand to setRuntime
      // don't read a future value of the ref (it gets incremented later in
      // this tick when the step completes).
      const idx = stepIndexRef.current;

      if (idx >= steps.length) {
        setPhase("done");
        setPlaying(false);
        return;
      }
      const step = steps[idx]!;
      const stepDur = step.duration / speed;

      if (stepStartRef.current === null) {
        stepStartRef.current = now;
        setRuntime((prev) => {
          const next = [...prev];
          if (next[idx] && next[idx]!.state !== "done") {
            next[idx] = { ...next[idx]!, state: "active", progress: 0 };
          }
          return next;
        });
      }

      const elapsed = now - (stepStartRef.current ?? now);
      const progress = Math.min(1, elapsed / stepDur);

      setRuntime((prev) => {
        const next = [...prev];
        if (next[idx] && next[idx]!.state !== "done") {
          next[idx] = { ...next[idx]!, state: "active", progress };
        }
        return next;
      });

      if (progress >= 1) {
        setRuntime((prev) => {
          const next = [...prev];
          if (next[idx]) {
            next[idx] = { ...next[idx]!, state: "done", progress: 1 };
          }
          return next;
        });
        stepIndexRef.current = idx + 1;
        stepStartRef.current = null;
        if (idx + 1 >= steps.length) {
          setPhase("done");
          setPlaying(false);
          return;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [phase, playing, steps, speed]);

  const elapsedReal = useMemo(() => {
    let acc = 0;
    for (const r of runtime) {
      if (r.state === "done") acc += r.step.duration / speed;
      else if (r.state === "active") acc += (r.step.duration * r.progress) / speed;
    }
    return acc;
  }, [runtime, speed]);

  return (
    <div className="bstudio" data-view={view} data-phase={phase} data-scout-theme="">
      <header className="bstudio-bar">
        <div className="bstudio-bar-l">
          <Bot size={14} className="bstudio-mark" />
          <span className="bstudio-title">BRIEFING STUDIO</span>
          <span className="bstudio-sep">·</span>
          <span className="bstudio-meta">sandbox · no backend calls</span>
        </div>
        <div className="bstudio-bar-r">
          <button
            type="button"
            className="bstudio-close"
            onClick={closeStudio}
            title="Exit studio"
            aria-label="Exit studio"
          >
            <X size={13} />
          </button>
        </div>
      </header>

      <section className="bstudio-controls">
        <div className="bstudio-ctrl-group">
          <button
            type="button"
            className="bstudio-btn"
            onClick={goIdle}
            title="Return to idle preview"
          >
            <RotateCcw size={11} />
            <span>reset</span>
          </button>
          {phase === "generating" && (
            <button
              type="button"
              className="bstudio-btn"
              onClick={() => setPlaying((p) => !p)}
              title={playing ? "Pause" : "Resume"}
            >
              {playing ? <Pause size={11} /> : <Play size={11} />}
              <span>{playing ? "pause" : "resume"}</span>
            </button>
          )}
        </div>

        <div className="bstudio-ctrl-group">
          <span className="bstudio-ctrl-label">view</span>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`bstudio-chip${view === v.id ? " bstudio-chip--active" : ""}`}
              onClick={() => setViewPersistent(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="bstudio-ctrl-group">
          <span className="bstudio-ctrl-label">speed</span>
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`bstudio-chip${speed === s.value ? " bstudio-chip--active" : ""}`}
              onClick={() => setSpeed(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="bstudio-ctrl-group bstudio-ctrl-group--meta">
          <span className="bstudio-ctrl-label">phase</span>
          <span className="bstudio-meta bstudio-phase-tag">{phase.toUpperCase()}</span>
          <span className="bstudio-sep">/</span>
          <span className="bstudio-ctrl-label">elapsed</span>
          <span className="bstudio-meta tabular-nums">
            {(elapsedReal / 1000).toFixed(2)}s
          </span>
          <span className="bstudio-sep">/</span>
          <span className="bstudio-meta tabular-nums">
            {(totalDuration / 1000 / speed).toFixed(2)}s
          </span>
        </div>
      </section>

      <section className="bstudio-stage">
        <div className="bstudio-card" data-view={view}>
          <div className="bstudio-card-title">
            <Bot size={12} className="bstudio-card-glyph" />
            <span>BRIEFING</span>
            <span className="bstudio-sep">·</span>
            <span>SUN 17 MAY · 14:23</span>
            <span className="bstudio-card-status">
              {phase === "idle" ? "QUIET" : phase === "done" ? "READY" : "BUILDING"}
            </span>
          </div>

          {phase === "idle" && <IdlePreview onStart={startGeneration} />}

          {phase === "generating" && view === "logs" && <LogsView runtime={runtime} />}
          {phase === "generating" && view === "sequence" && <BriefSequenceView runtime={runtime} />}
          {phase === "generating" && view === "carousel" && <CarouselView runtime={runtime} />}

          {phase === "done" && <SynthesizedBrief />}
        </div>
      </section>
    </div>
  );
}

/* ── Idle preview — quick-scan + CTA ─────────────────────────────── */

function IdlePreview({ onStart }: { onStart: () => void }) {
  return (
    <div className="bstudio-idle">
      <div className="bstudio-idle-scan">
        <span className="bstudio-idle-label">QUICK SCAN</span>
        <ul className="bstudio-idle-list">
          {QUICK_SCAN.map((q) => (
            <li
              key={q.id}
              className={`bstudio-idle-item${q.accent ? ` bstudio-idle-item--${q.accent}` : ""}`}
            >
              <span className="bstudio-idle-bullet" aria-hidden="true">›</span>
              <span>{q.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="bstudio-idle-pitch">
        <p className="bstudio-idle-copy">
          <Sparkles size={11} className="bstudio-idle-sparkle" aria-hidden="true" />
          Ranger can synthesize a full briefing across recent sessions,
          broker activity, plans in motion, and anomalies.
        </p>
        <button type="button" className="bstudio-cta" onClick={onStart}>
          [▸ generate brief]
        </button>
      </div>
    </div>
  );
}

/* ── View 1 — LOGS: compact step rows, no body expansion ─────────── */

function LogsView({ runtime }: { runtime: RuntimeStep[] }) {
  return (
    <div className="bstudio-logs">
      {runtime.map((r) => (
        <LogRow key={r.step.id} runtime={r} />
      ))}
    </div>
  );
}

function LogRow({ runtime }: { runtime: RuntimeStep }) {
  const { step, state } = runtime;
  return (
    <div className="bstudio-log-row" data-state={state}>
      <span className="bstudio-log-state" aria-hidden="true">
        {state === "done" ? (
          <CheckCircle2 size={11} />
        ) : state === "active" ? (
          <Loader2 size={11} className="bstudio-spin" />
        ) : (
          <span className="bstudio-log-pending">·</span>
        )}
      </span>
      <span className="bstudio-log-label">{step.label}</span>
      <span className="bstudio-log-leader" aria-hidden="true" />
      <span
        className={`bstudio-log-result${
          step.countTone ? ` bstudio-log-result--${step.countTone}` : ""
        }`}
      >
        {state === "done" ? step.result : state === "active" ? "scanning…" : ""}
      </span>
    </div>
  );
}

/* ── View 2 — SEQUENCE: shared with Home's BRIEFING panel, see ────
   `components/brief-sequence/index.tsx`. Imported above as
   `BriefSequenceView`. ──────────────────────────────────────────── */

/* ── View 3 — CAROUSEL: one full screen per step + progress stepper ── */

function CarouselView({ runtime }: { runtime: RuntimeStep[] }) {
  // Pick the step to display: the active one, else the last done.
  const activeIdx = runtime.findIndex((r) => r.state === "active");
  let displayedIdx = activeIdx;
  if (displayedIdx < 0) {
    for (let i = runtime.length - 1; i >= 0; i--) {
      if (runtime[i]?.state === "done") {
        displayedIdx = i;
        break;
      }
    }
  }
  if (displayedIdx < 0) displayedIdx = 0;
  const r = runtime[displayedIdx]!;
  const Icon = stepIcon(r.step.kind);
  const stepProgress = r.state === "done" ? 1 : r.state === "active" ? r.progress : 0;
  const actionLabel =
    r.state === "done" ? "scanned" : r.state === "active" ? "scanning" : "pending";

  return (
    <div className="bstudio-carousel">
      <Stepper runtime={runtime} activeIdx={displayedIdx} />

      <div className="bstudio-carousel-screen" key={r.step.id}>
        <div className="bstudio-carousel-now">
          <Icon size={13} className="bstudio-carousel-now-icon" />
          <span className="bstudio-carousel-now-action">{actionLabel}</span>
          <span className="bstudio-carousel-now-label">{r.step.label}</span>
          <span className="bstudio-carousel-now-counter">
            {displayedIdx + 1} / {runtime.length}
          </span>
        </div>

        <div
          className="bstudio-carousel-progress"
          role="progressbar"
          aria-valuenow={Math.round(stepProgress * 100)}
        >
          <span
            className="bstudio-carousel-progress-fill"
            style={{ width: `${stepProgress * 100}%` }}
          />
        </div>

        <div className="bstudio-carousel-body">
          <SamplePanel sample={r.step.sample} />
        </div>
      </div>
    </div>
  );
}

function Stepper({
  runtime,
  activeIdx,
}: {
  runtime: RuntimeStep[];
  activeIdx: number;
}) {
  return (
    <div className="bstudio-stepper" role="list" aria-label="brief generation progress">
      {runtime.map((r, i) => {
        // The line that fills as the active step progresses lives on the
        // pip that COMES AFTER the active one (it's the line leading into it).
        const isAfterActive = i > 0 && runtime[i - 1]?.state === "active";
        const fillPct = isAfterActive ? (runtime[i - 1]!.progress * 100).toFixed(1) : null;
        const style = fillPct !== null
          ? ({ "--pip-fill": `${fillPct}%` } as React.CSSProperties)
          : undefined;
        return (
          <div
            key={r.step.id}
            className="bstudio-stepper-pip"
            data-state={r.state}
            data-current={i === activeIdx || undefined}
            data-fill={isAfterActive || undefined}
            style={style}
            role="listitem"
          >
            <span className="bstudio-stepper-circle" aria-hidden="true">
              {r.state === "done" ? <CheckCircle2 size={10} /> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}


/* ── Final synthesized brief — the real report ───────────────────── */

function SynthesizedBrief() {
  return (
    <div className="bstudio-brief">
      <div className="bstudio-brief-head">
        <span className="bstudio-brief-eyebrow">SYNTHESIZED</span>
        <span className="bstudio-brief-meta">
          7 sessions · 20 broker msgs · 4,891 tail events · 2 plans · 1 idle
        </span>
      </div>

      <div className="bstudio-brief-list">
        {mockBriefObservations.map((obs, i) => (
          <div
            key={obs.id}
            className={`bstudio-brief-line${obs.tone ? ` bstudio-brief-line--${obs.tone}` : ""}`}
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <Target size={11} className="bstudio-brief-icon" strokeWidth={1.7} aria-hidden="true" />
            <div className="bstudio-brief-line-body">
              <span>{obs.text}</span>
              {obs.refs && obs.refs.length > 0 && (
                <span className="bstudio-brief-refs">
                  {obs.refs.map((r) => (
                    <span key={r.label} className="bstudio-brief-ref">
                      {r.label}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="bstudio-brief-actions">
        <button type="button" className="bstudio-btn">
          <Play size={11} />
          <span>play brief aloud</span>
        </button>
        <button type="button" className="bstudio-btn">
          <Sparkles size={11} />
          <span>open ops</span>
        </button>
      </div>
    </div>
  );
}
