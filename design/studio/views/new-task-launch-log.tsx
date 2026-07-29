"use client";

/**
 * Studio study: New task · launch log.
 *
 * The window this study designs: the beat between "send" in the /dispatch
 * New task modal (packages/web/client/screens/agents/NewChatComposer.tsx)
 * and the conversation being live. Today that beat is a spinner. The
 * proposal: the modal's composer — which just gave up its purpose — becomes
 * a launch ledger that logs the real backstage actions as they complete.
 *
 * Terminal-flavored, deliberately not a terminal: mono type, tabular
 * timings, lines that appear as work lands — but no prompt, no cursor, no
 * input, nothing to click. It is a readout, not a call to action. In the
 * best case it flies: the fast path clears in under two seconds and the
 * ledger reads as one confident cascade into the open conversation.
 *
 * Every line maps to a real stage of the submit pipeline — see the
 * vocabulary section at the foot of the study. No invented steps.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Search, X } from "lucide-react";
import { EyebrowLabel } from "@/components/EyebrowLabel";
import { RuntimePicker, type RuntimeValue } from "@/components/RuntimePicker";

/* ── Fixture: the submission from the reference capture ───────────────── */

type DemoProject = {
  id: string;
  title: string;
  path: string;
};

type DemoSubmission = {
  project: DemoProject;
  harness: string;
  model: string;
  effort: string;
  task: string;
};

const RECENT_PROJECTS: DemoProject[] = [
  {
    id: "openscout-native-new-chat-return-submit",
    title: "Openscout Native New Chat Return Submit",
    path: "~/dev/openscout-native-new-chat-return-submit",
  },
  { id: "openscout", title: "OpenScout", path: "~/dev/openscout" },
  { id: "talkie", title: "Talkie", path: "~/dev/talkie" },
];

const SUBMISSION: DemoSubmission = {
  project: RECENT_PROJECTS[0],
  harness: "Claude Code",
  model: "Opus 5",
  effort: "Medium",
  task: "Wire the return-key submit path through the native new-chat composer.",
};

/* ── Stage vocabulary ─────────────────────────────────────────────────── */
/* Every line is a real stage of the submit pipeline, labelled with the
 * identifier the code uses (control-event names, dispatch-job states, tmux
 * verbs). Traced end-to-end through create-openscout-web-server.ts →
 * broker-delivery-acceptance-service.ts → broker-local-invocation-service.ts
 * → local-agents.ts; see the vocabulary table at the foot of the study. */

type Stage = {
  /** Unique key within a scenario. */
  id: string;
  /** The code-side identifier, printed verbatim — the left column. */
  label: string;
  /** Right-hand detail: ids, states, real summary strings. Truncates. */
  detail?: string;
  /** Representative duration for playback, ms. */
  ms: number;
  /** Where the stage lives — rendered in the vocabulary table only. */
  source?: string;
};

type Scenario = {
  key: string;
  name: string;
  note: string;
  stages: Stage[];
};

/** Shared head of every scenario: accept → deliver → flight minted. */
const ACCEPT_STAGES: Stage[] = [
  {
    id: "sessions.create",
    label: "POST /api/sessions",
    detail: "new session · claude · opus 5 · medium",
    ms: 140,
    source: "packages/web/server/create-openscout-web-server.ts:5589",
  },
  {
    id: "session.cardless",
    label: "session.registered",
    detail: "cardless · tmux · ~/dev/openscout-native-new-chat-return-submit",
    ms: 26,
    source: "packages/runtime/src/broker-cardless-session.ts:141",
  },
  {
    id: "conversation.upserted",
    label: "conversation.upserted",
    detail: "direct · operator ↔ session",
    ms: 9,
    source: "packages/runtime/src/broker-delivery-acceptance-service.ts:921",
  },
  {
    id: "message.posted",
    label: "message.posted",
    detail: "msg-ms66n5sl-ac6oex · durable",
    ms: 12,
    source: "packages/runtime/src/broker.ts:605",
  },
  {
    id: "invocation.requested",
    label: "invocation.requested",
    detail: "consult · ensure-awake",
    ms: 18,
    source: "packages/runtime/src/broker.ts:712",
  },
  {
    id: "flight.waking",
    label: "flight.updated",
    detail: "waking — “waking on claude.”",
    ms: 10,
    source: "packages/runtime/src/broker-invocation-dispatch-service.ts:114",
  },
];

/** Shared tail: the harness actually comes up and speaks. */
const SPAWN_STAGES = (spawnMs: number, readyMs: number, firstMs: number, cold?: boolean): Stage[] => [
  {
    id: "tmux.spawn",
    label: "tmux.new-session",
    detail: "-x160 -y48 · launch.sh · pipe-pane",
    ms: spawnMs,
    source: "packages/runtime/src/local-agents.ts:4160",
  },
  {
    id: "tmux.ready",
    label: "harness.ready",
    detail: cold ? "cold start · polling composer at 250ms" : "composer up · prompt pasted",
    ms: readyMs,
    source: "packages/runtime/src/local-agents.ts:3564",
  },
  {
    id: "tail.first",
    label: "tail.assistant",
    detail: "first tokens",
    ms: firstMs,
    source: "packages/runtime/src/tail/types.ts:18",
  },
];

const DISPATCH_STAGES: Stage[] = [
  {
    id: "dispatch.job",
    label: "dispatch.job",
    detail: "running · lease broker:studio-m2 · 30s",
    ms: 48,
    source: "packages/runtime/src/broker-dispatch-job.ts:3",
  },
  {
    id: "endpoint.active",
    label: "endpoint.upserted",
    detail: "active · scout-cardless-session",
    ms: 16,
    source: "packages/runtime/src/broker-local-invocation-service.ts:297",
  },
  {
    id: "flight.running",
    label: "flight.updated",
    detail: "running — acknowledged via spawn",
    ms: 52,
    source: "packages/runtime/src/broker-local-invocation-service.ts:308",
  },
];

const SCENARIOS: Scenario[] = [
  {
    key: "fast",
    name: "Fast path",
    note: "Warm machine · the whole pipeline clears in about three seconds, most of it the harness itself coming up.",
    stages: [...ACCEPT_STAGES, ...DISPATCH_STAGES, ...SPAWN_STAGES(420, 1350, 820)],
  },
  {
    key: "cold",
    name: "Cold spawn",
    note: "First worker on this project · the ready gate holds (it may poll up to 20s) and the counter earns its keep.",
    stages: [...ACCEPT_STAGES, ...DISPATCH_STAGES, ...SPAWN_STAGES(680, 4900, 1400, true)],
  },
  {
    key: "queued",
    name: "Queued until online",
    note: "No runnable endpoint yet · the flight parks as queued_until_online, the 5s agent sync finds one, dispatch resumes. Stated in ink, not alarm.",
    stages: [
      ...ACCEPT_STAGES,
      {
        id: "endpoint.resolve",
        label: "endpoint.resolve",
        detail: "no runnable endpoint",
        ms: 180,
        source: "packages/runtime/src/broker-local-endpoint-resolver.ts:97",
      },
      {
        id: "flight.queued",
        label: "flight.updated",
        detail: "queued — queued_until_online",
        ms: 12,
        source: "packages/runtime/src/broker-local-invocation-service.ts:268",
      },
      {
        id: "agents.sync",
        label: "agents.sync",
        detail: "local agents rescanned · 5s cycle",
        ms: 3400,
        source: "packages/runtime/src/broker-daemon.ts:260",
      },
      ...DISPATCH_STAGES.slice(1),
      ...SPAWN_STAGES(460, 1500, 850),
    ],
  },
];

/* ── Utilities ────────────────────────────────────────────────────────── */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/* ── Playback ─────────────────────────────────────────────────────────── */

type StageState = { status: "pending" | "active" | "done"; liveMs: number };

/**
 * The ledger's render cadence: a row never appears less than this many ms
 * after the previous one, even when the stage itself cleared in 12ms. The
 * printed duration is always the stage's real one — the cadence only paces
 * how fast the eye is asked to read. A production port does the same thing
 * by draining its event queue at this rhythm.
 */
const ROW_CADENCE_MS = 70;
/** Beat between the last row settling and the handoff line. */
const HANDOFF_HOLD_MS = 350;

/**
 * Drives the ledger off one rAF clock. All state derives from elapsed time
 * against a precomputed schedule, so pausing React updates can never desync
 * the sequence. Two clocks per stage: the REAL window (rStart→rEnd, what the
 * counter and printed ms report) and the VISIBLE time (vStart, when the row
 * is allowed to appear — real start, or the cadence, whichever is later).
 */
function useLaunchPlayback(
  scenario: Scenario,
  speed: number,
  playToken: number,
  onDone?: () => void,
) {
  const [now, setNow] = useState(0);
  const rafRef = useRef(0);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const schedule = useMemo(() => {
    let realCursor = 0;
    let lastVisible = -ROW_CADENCE_MS;
    return scenario.stages.map((stage) => {
      const rStart = realCursor;
      realCursor += stage.ms;
      const vStart = Math.max(lastVisible + ROW_CADENCE_MS, rStart);
      lastVisible = vStart;
      return { rStart, rEnd: realCursor, vStart };
    });
  }, [scenario]);

  const finishAt = useMemo(() => {
    const last = schedule[schedule.length - 1];
    return Math.max(last?.rEnd ?? 0, last?.vStart ?? 0) + HANDOFF_HOLD_MS;
  }, [schedule]);

  useEffect(() => {
    doneRef.current = false;
    setNow(0);
    const startedAt = performance.now();
    const tick = (frameNow: number) => {
      const elapsed = (frameNow - startedAt) / speed;
      setNow(elapsed);
      if (elapsed >= finishAt) {
        if (!doneRef.current) {
          doneRef.current = true;
          onDoneRef.current?.();
        }
        return;
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafRef.current);
  }, [scenario, speed, playToken, finishAt]);

  const states: StageState[] = useMemo(
    () =>
      scenario.stages.map((stage, index) => {
        const slot = schedule[index];
        if (now < slot.vStart) return { status: "pending", liveMs: 0 };
        if (now >= slot.rEnd) return { status: "done", liveMs: stage.ms };
        return { status: "active", liveMs: Math.max(0, now - slot.rStart) };
      }),
    [scenario, schedule, now],
  );

  const totalReal = schedule[schedule.length - 1]?.rEnd ?? 0;
  return { states, totalMs: Math.min(now, totalReal), done: now >= finishAt };
}

/* ── Ledger ───────────────────────────────────────────────────────────── */

function StageGlyph({ status }: { status: StageState["status"] }) {
  if (status === "done") {
    return <span className="h-1 w-1 rounded-full bg-studio-ink-muted" aria-hidden />;
  }
  if (status === "active") {
    return (
      <span className="relative grid h-2.5 w-2.5 place-items-center" aria-hidden>
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-30"
          style={{ background: "var(--scout-accent)" }}
        />
        <span
          className="h-[5px] w-[5px] rounded-full"
          style={{ background: "var(--scout-accent)" }}
        />
      </span>
    );
  }
  return (
    <span
      className="h-1 w-1 rounded-full border border-studio-edge-strong"
      aria-hidden
    />
  );
}

function LedgerRow({ stage, state }: { stage: Stage; state: StageState }) {
  const active = state.status === "active";
  return (
    <div
      className={cx(
        "flex h-[22px] items-center gap-2 px-3 font-mono text-xs",
        "motion-safe:animate-[launch-row-in_140ms_ease-out]",
      )}
    >
      <span className="grid w-2.5 shrink-0 place-items-center">
        <StageGlyph status={state.status} />
      </span>
      <span
        className={cx(
          "shrink-0",
          active ? "text-studio-ink" : "text-studio-ink-muted",
        )}
      >
        {stage.label}
      </span>
      {stage.detail ? (
        <span className="min-w-0 truncate text-studio-ink-faint">{stage.detail}</span>
      ) : null}
      <span
        className={cx(
          "ml-auto shrink-0 tabular-nums",
          active ? "text-studio-ink" : "text-studio-ink-faint",
        )}
      >
        {fmtMs(state.liveMs)}
      </span>
    </div>
  );
}

function LaunchLedger({
  scenario,
  states,
  totalMs,
}: {
  scenario: Scenario;
  states: StageState[];
  totalMs: number;
}) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-studio-edge bg-studio-canvas">
      <style>{`
        @keyframes launch-row-in {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="flex items-center justify-between border-b border-studio-edge px-3 py-1.5">
        <span className="font-mono text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          launch
        </span>
        <span className="font-mono text-2xs tabular-nums text-studio-ink-faint">
          t+{(totalMs / 1000).toFixed(2)}s
        </span>
      </div>
      <div className="py-1.5">
        {scenario.stages.map((stage, index) =>
          states[index].status === "pending" ? null : (
            <LedgerRow key={stage.id + index} stage={stage} state={states[index]} />
          ),
        )}
      </div>
    </div>
  );
}

/* ── The New task modal, reproduced ───────────────────────────────────── */

type ModalPhase = "compose" | "launch" | "open";

function NewTaskModalDemo({
  scenario,
  speed,
}: {
  scenario: Scenario;
  speed: number;
}) {
  const [phase, setPhase] = useState<ModalPhase>("compose");
  const [playToken, setPlayToken] = useState(0);
  const [submission, setSubmission] = useState<DemoSubmission>(SUBMISSION);

  const begin = useCallback((nextSubmission: DemoSubmission) => {
    setSubmission(nextSubmission);
    setPlayToken((token) => token + 1);
    setPhase("launch");
  }, []);

  const reset = useCallback(() => setPhase("compose"), []);

  return (
    <div className="w-[500px] max-w-full">
      <div className="overflow-hidden rounded-xl border border-studio-edge bg-studio-surface shadow-[0_18px_50px_-24px_rgba(0,0,0,0.5)]">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <span className="font-sans text-md font-medium text-studio-ink">New task</span>
          <button
            type="button"
            aria-label="Close"
            className="grid h-6 w-6 place-items-center rounded text-studio-ink-faint hover:text-studio-ink"
          >
            <X size={13} />
          </button>
        </div>

        {phase === "compose" ? (
          <ComposeBody onSend={begin} />
        ) : (
          <LaunchBody
            scenario={scenario}
            speed={speed}
            playToken={playToken}
            phase={phase}
            submission={submission}
            onDone={() => setPhase("open")}
            onReplay={reset}
          />
        )}
      </div>
    </div>
  );
}

function ComposeBody({ onSend }: { onSend: (submission: DemoSubmission) => void }) {
  const [draft, setDraft] = useState(SUBMISSION.task);
  const [project, setProject] = useState<DemoProject | null>(SUBMISSION.project);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeValue>({
    harness: "claude",
    model: "opus",
    effort: "medium",
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const projectMatches = RECENT_PROJECTS.filter((candidate) => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) return true;
    return `${candidate.title} ${candidate.path}`.toLowerCase().includes(query);
  });

  const submit = () => {
    if (!project) {
      setProjectError("Choose a project before starting this task.");
      setProjectOpen(true);
      return;
    }
    const harnessLabel = runtime.harness === "claude"
      ? "Claude Code"
      : runtime.harness === "codex"
        ? "Codex"
        : "Grok";
    const modelLabel = runtime.model === "opus"
      ? "Opus"
      : runtime.model === "sonnet"
        ? "Sonnet"
        : runtime.model || "Default";
    onSend({
      project,
      harness: harnessLabel,
      model: modelLabel,
      effort: runtime.effort.charAt(0).toUpperCase() + runtime.effort.slice(1),
      task: draft.trim(),
    });
  };

  const insertCommand = () => {
    setDraft((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}/`);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="px-4 pb-4 pt-1">
      {/* Destination is a quiet readout until the operator asks to change it. */}
      <div className="border-b border-studio-edge pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="w-14 shrink-0 font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-studio-ink-faint">
            Project
          </span>
          <button
            type="button"
            aria-expanded={projectOpen}
            aria-controls="launch-study-project-picker"
            onClick={() => {
              setProjectOpen((current) => !current);
              setProjectError(null);
            }}
            className="group flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-studio-panel"
          >
            <span
              className={cx(
                "min-w-0 truncate font-sans text-xs",
                project ? "text-studio-ink-muted" : "text-studio-ink-faint",
              )}
            >
              {project?.title ?? "Choose when ready"}
            </span>
            {project ? (
              <span className="min-w-0 flex-1 truncate font-mono text-2xs text-studio-ink-faint">
                {project.path}
              </span>
            ) : null}
            <ChevronDown
              size={11}
              className={cx(
                "ml-auto shrink-0 text-studio-ink-faint transition-transform",
                projectOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        </div>

        {projectError ? (
          <p className="ml-16 mt-1 font-sans text-xs text-red-400" role="alert">
            {projectError}
          </p>
        ) : null}

        {projectOpen ? (
          <div id="launch-study-project-picker" className="ml-16 mt-1.5 border-t border-studio-edge pt-2">
            <div className="flex h-8 items-center gap-2 rounded-md border border-studio-edge px-2.5">
              <Search size={12} className="shrink-0 text-studio-ink-faint" aria-hidden />
              <input
                value={projectQuery}
                onChange={(event) => setProjectQuery(event.target.value)}
                placeholder="Filter recent projects…"
                aria-label="Filter projects"
                className="min-w-0 flex-1 border-0 bg-transparent font-sans text-xs text-studio-ink outline-none placeholder:text-studio-ink-faint"
              />
            </div>
            <div className="mt-1 grid gap-0.5">
              {projectMatches.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => {
                    setProject(candidate);
                    setProjectOpen(false);
                    setProjectQuery("");
                    setProjectError(null);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                  className="flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-studio-panel"
                >
                  <span className="min-w-0 flex-1 truncate font-sans text-xs text-studio-ink-muted">
                    {candidate.title}
                  </span>
                  <span className="max-w-[48%] truncate font-mono text-2xs text-studio-ink-faint">
                    {candidate.path}
                  </span>
                  {candidate.id === project?.id ? <Check size={11} aria-hidden /> : null}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setProject(null);
                  setProjectOpen(false);
                  setProjectQuery("");
                }}
                className="mt-1 border-t border-studio-edge px-2 pt-2 text-left font-mono text-2xs text-studio-ink-faint hover:text-studio-ink"
              >
                Clear project
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* The draft owns the modal. Runtime and commands live at its foot. */}
      <div className="relative mt-3 rounded-[10px] border border-studio-edge-strong">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={7}
          autoFocus
          aria-label="Describe the task"
          placeholder="Describe the task, or leave blank…"
          className="block min-h-[154px] w-full resize-none border-0 bg-transparent px-3 pb-3 pt-3 font-sans text-sm leading-relaxed text-studio-ink outline-none placeholder:text-studio-ink-faint"
        />
        <div className="flex items-center gap-1.5 border-t border-studio-edge px-2 py-2">
          <button
            type="button"
            onClick={insertCommand}
            className="flex h-7 items-center gap-1 rounded-md px-2 font-mono text-2xs text-studio-ink-faint hover:bg-studio-panel hover:text-studio-ink"
          >
            <span className="text-studio-ink-muted" aria-hidden>/</span>
            Commands
          </button>
          <span className="ml-auto" />
          <RuntimePicker value={runtime} onChange={setRuntime} variant="rail" placement="up" />
          <button
            type="button"
            aria-label="Send"
            onClick={submit}
            className="grid h-7 w-7 place-items-center rounded-full bg-studio-ink text-studio-canvas transition-transform hover:scale-105"
          >
            <ArrowUp size={14} strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}

function LaunchBody({
  scenario,
  speed,
  playToken,
  phase,
  submission,
  onDone,
  onReplay,
}: {
  scenario: Scenario;
  speed: number;
  playToken: number;
  phase: ModalPhase;
  submission: DemoSubmission;
  onDone: () => void;
  onReplay: () => void;
}) {
  const { states, totalMs } = useLaunchPlayback(scenario, speed, playToken, onDone);

  return (
    <div className="px-4 pb-4 pt-2">
      {/* The routing decisions, compressed to one settled line. */}
      <div className="flex min-w-0 items-center gap-1.5 pb-2 font-mono text-2xs text-studio-ink-faint">
        <span className="min-w-0 truncate">{submission.project.path}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0 lowercase">
          {submission.harness} · {submission.model} · {submission.effort}
        </span>
      </div>

      {/* The task itself, held above the ledger. */}
      <p className="border-l border-studio-edge-strong pl-2.5 font-sans text-sm leading-snug text-studio-ink-muted">
        {submission.task || "New session without an opening message."}
      </p>

      <div className="mt-3">
        <LaunchLedger scenario={scenario} states={states} totalMs={totalMs} />
      </div>

      {phase === "open" ? (
        <div className="mt-3 flex items-center gap-2 motion-safe:animate-[launch-row-in_240ms_ease-out]">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: "var(--scout-accent)" }}
            aria-hidden
          />
          <span className="font-sans text-sm text-studio-ink">Conversation open</span>
          <button
            type="button"
            onClick={onReplay}
            className="focus-ring ml-auto rounded-md border border-studio-edge px-2 py-1 font-mono text-2xs uppercase tracking-[0.12em] text-studio-ink-muted hover:text-studio-ink"
          >
            Replay
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ── Study assembly ───────────────────────────────────────────────────── */

export function NewTaskLaunchLogStudy() {
  const [scenarioKey, setScenarioKey] = useState("fast");
  const [slowed, setSlowed] = useState(false);
  const scenario = SCENARIOS.find((item) => item.key === scenarioKey) ?? SCENARIOS[0];

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {SCENARIOS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setScenarioKey(item.key)}
              className={cx(
                "focus-ring rounded-md border px-2.5 py-1 font-mono text-2xs uppercase tracking-[0.12em]",
                item.key === scenario.key
                  ? "border-studio-edge-strong text-studio-ink"
                  : "border-studio-edge text-studio-ink-faint hover:text-studio-ink",
              )}
            >
              {item.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSlowed((current) => !current)}
            aria-pressed={slowed}
            className={cx(
              "focus-ring ml-auto rounded-md border px-2.5 py-1 font-mono text-2xs uppercase tracking-[0.12em]",
              slowed
                ? "border-studio-edge-strong text-studio-ink"
                : "border-studio-edge text-studio-ink-faint hover:text-studio-ink",
            )}
          >
            {slowed ? "4× slow" : "recorded"}
          </button>
        </div>
        <p className="max-w-prose font-sans text-md text-studio-ink-faint">{scenario.note}</p>
        <NewTaskModalDemo
          key={`${scenario.key}-${slowed}`}
          scenario={scenario}
          speed={slowed ? 4 : 1}
        />
      </section>

      <section className="border-t border-studio-edge pt-6">
        <EyebrowLabel as="h2" className="mb-3">
          Design notes
        </EyebrowLabel>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {NOTES.map((note) => (
            <div key={note.title} className="min-w-0">
              <div className="font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-studio-ink">
                {note.title}
              </div>
              <p className="mt-2 font-sans text-md leading-relaxed text-studio-ink-faint">
                {note.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-studio-edge pt-6">
        <EyebrowLabel as="h2" className="mb-3">
          Today, and the wiring
        </EyebrowLabel>
        <div className="max-w-prose space-y-3 font-sans text-md leading-relaxed text-studio-ink-faint">
          <p>
            <strong className="font-medium text-studio-ink">What ships today:</strong> on send the
            composer disables behind a spinner (“Routing capture · Starting a project-routed chat
            in /…”), the client navigates the moment the HTTP accept returns, and the conversation
            opens on a staged placeholder flight — “Request accepted; waiting for worker
            activity.” — that reads <em>Queued</em>/<em>Starting</em> until the reply lands. Every
            stage between accept and reply happens invisibly
            (<code className="font-mono text-sm">NewChatComposer.tsx:861</code>,{" "}
            <code className="font-mono text-sm">client-turn-transition.ts:55</code>).
          </p>
          <p>
            <strong className="font-medium text-studio-ink">The wiring already exists:</strong>{" "}
            everything above the tmux lines crosses the broker’s{" "}
            <code className="font-mono text-sm">control.events</code> WebSocket today —{" "}
            <code className="font-mono text-sm">message.posted</code>,{" "}
            <code className="font-mono text-sm">invocation.requested</code>,{" "}
            <code className="font-mono text-sm">flight.updated</code> — with a since-cursor backlog,
            and the web server already projects flight states to lifecycle states
            (queued → dispatching → working) in{" "}
            <code className="font-mono text-sm">watchScoutMessages</code>, unused by this modal
            (<code className="font-mono text-sm">lib/sse.ts:44</code>,{" "}
            <code className="font-mono text-sm">core/broker/service.ts:3148</code>). The ledger is
            mostly plumbing-to-pixels, not new machinery.
          </p>
          <p>
            <strong className="font-medium text-studio-ink">The two honest gaps:</strong> the{" "}
            <code className="font-mono text-sm">tmux.new-session</code> and{" "}
            <code className="font-mono text-sm">harness.ready</code> lines are visible only in
            runtime logs today — surfacing them needs one new control-event emission from{" "}
            <code className="font-mono text-sm">local-agents.ts</code>; until then the ledger holds
            an active “waiting for first tokens” line between{" "}
            <code className="font-mono text-sm">flight.updated · running</code> and{" "}
            <code className="font-mono text-sm">tail.assistant</code>. And the handoff itself is a
            product rule: hold the modal through the cascade, navigate on flight running or first
            tokens — whichever lands first — with a soft cap (~8s, per the
            web-message-job-lifecycle targets) after which the ledger rides into the conversation
            as the pending turn’s placard instead of blocking it.
          </p>
        </div>
      </section>

      <section className="border-t border-studio-edge pt-6">
        <EyebrowLabel as="h2" className="mb-3">
          Vocabulary — every line, grounded
        </EyebrowLabel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-studio-edge">
                <th className="py-1.5 pr-4 font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-studio-ink-faint">
                  Line
                </th>
                <th className="py-1.5 pr-4 font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-studio-ink-faint">
                  What it is
                </th>
                <th className="py-1.5 font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-studio-ink-faint">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {VOCAB.map((row) => (
                <tr key={row.line + row.source} className="border-b border-studio-edge align-top">
                  <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-studio-ink">
                    {row.line}
                  </td>
                  <td className="max-w-prose py-2 pr-4 font-sans text-sm leading-relaxed text-studio-ink-muted">
                    {row.what}
                  </td>
                  <td className="py-2 font-mono text-2xs text-studio-ink-faint">{row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ── Vocabulary table data ────────────────────────────────────────────── */

const VOCAB: Array<{ line: string; what: string; source: string }> = [
  {
    line: "POST /api/sessions",
    what: "The one submit request: validates target and execution, allocates the provisional agent handle, and returns before any worker exists.",
    source: "packages/web/server/create-openscout-web-server.ts:5589",
  },
  {
    line: "session.registered",
    what: "Cardless project session: a session-kind actor and endpoint registered against the project path. Claude's default spawn transport is tmux; no worktree is created — the session runs in the project root.",
    source: "packages/runtime/src/broker-cardless-session.ts:141",
  },
  {
    line: "conversation.upserted",
    what: "Direct conversation ensured between the operator and the session actor.",
    source: "packages/runtime/src/broker-delivery-acceptance-service.ts:921",
  },
  {
    line: "message.posted",
    what: "The task text becomes the canonical durable operator message — the first control event the ledger can print from the backlog.",
    source: "packages/runtime/src/broker.ts:605",
  },
  {
    line: "invocation.requested",
    what: "Consult invocation minted with ensure-awake; the flight and a durable dispatch job are persisted together.",
    source: "packages/runtime/src/broker.ts:712",
  },
  {
    line: "flight.updated · waking",
    what: "FlightState is queued · waking · running · waiting · completed · failed · cancelled. Ensure-awake starts at waking, with the real summary “‹name› waking on ‹harness›.”",
    source: "packages/protocol/src/invocations.ts:13",
  },
  {
    line: "dispatch.job",
    what: "Durable dispatch job with a 30s lease — survives a broker restart, retries with attempts and lastError. Today invisible to every UI.",
    source: "packages/runtime/src/broker-dispatch-job.ts:3",
  },
  {
    line: "endpoint.resolve · queued_until_online",
    what: "When no endpoint is runnable the flight parks as queued with dispatchOutcome queued_until_online instead of failing; the 5s local-agent sync un-parks it.",
    source: "packages/runtime/src/broker-local-invocation-service.ts:268",
  },
  {
    line: "endpoint.upserted · active",
    what: "The session endpoint goes hot for this invocation.",
    source: "packages/runtime/src/broker-local-invocation-service.ts:297",
  },
  {
    line: "flight.updated · running",
    what: "The dispatch acknowledgment, with its real strategy vocabulary: spawn · attach · wake · steer · queued.",
    source: "packages/runtime/src/broker-local-invocation-helpers.ts:247",
  },
  {
    line: "tmux.new-session",
    what: "The harness process actually launches: launch.sh written, tmux new-session -x160 -y48 in the project root, pane piped to stdout.log.",
    source: "packages/runtime/src/local-agents.ts:4160",
  },
  {
    line: "harness.ready",
    what: "The ready gate polls the pane for a live composer (250ms, capped at 20s), then pastes and submits the prompt.",
    source: "packages/runtime/src/local-agents.ts:3564",
  },
  {
    line: "tail.assistant",
    what: "First tokens over the tail firehose — the ledger's job is done and the conversation takes over.",
    source: "packages/runtime/src/tail/types.ts:18",
  },
];

/* ── Notes ────────────────────────────────────────────────────────────── */

const NOTES: Array<{ title: string; body: string }> = [
  {
    title: "Line grammar",
    body:
      "One line per stage, 22px, never wraps: a lowercase verb phrase in mono, the identifying detail (ids, paths, route) faint beside it, the real duration right-aligned in tabular figures. Settled lines recede to muted ink; only the line doing work holds full ink.",
  },
  {
    title: "Cadence vs honesty",
    body:
      "Rows drain onto the ledger at a ≥70ms rhythm so the cascade is legible even when three stages clear in 80ms — but every printed duration is the stage's measured one, and the header clock is wall time from send. The rhythm is smoothed; the numbers never are.",
  },
  {
    title: "Accent spend",
    body:
      "One emerald: the pulse on the line currently working, inherited at the end by the conversation-open dot. Completed rows settle to ink, and the queued_until_online line stays ink too — a parked flight is information, not an alarm, and the ledger has no second color to spend.",
  },
  {
    title: "Not a terminal",
    body:
      "No prompt glyph, no cursor, no input, nothing clickable inside the plate — dot marks instead of $, a hairline border instead of scrollback. The moment the conversation opens the ledger's job is over; production navigates, and the plate never asks for a click.",
  },
];
