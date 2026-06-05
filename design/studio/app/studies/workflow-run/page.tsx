import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const WORKFLOW_DIR =
  "/Users/art/.claude/projects/-Users-art-dev-talkie/02882166-cd21-42b3-9b01-df8912d441dc/subagents/workflows/wf_edb96359-320";

type JsonlSource = {
  file: string;
  found: boolean;
  count?: number;
  sizeBytes?: number;
  entries?: unknown[];
  parseErrors?: Array<{ line: number; error: string; raw: string }>;
  error?: string;
};

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readJsonFileSource(fileName: string) {
  const file = join(WORKFLOW_DIR, fileName);

  if (!existsSync(file)) {
    return { file, found: false, error: "missing file" };
  }

  try {
    return {
      file,
      found: true,
      sizeBytes: statSync(file).size,
      value: JSON.parse(readFileSync(file, "utf8")) as unknown,
    };
  } catch (error) {
    return { file, found: true, error: messageFromError(error) };
  }
}

function readJsonlSource(fileName: string): JsonlSource {
  const file = join(WORKFLOW_DIR, fileName);

  if (!existsSync(file)) {
    return { file, found: false, error: "missing file" };
  }

  try {
    const raw = readFileSync(file, "utf8");
    const entries: unknown[] = [];
    const parseErrors: JsonlSource["parseErrors"] = [];

    raw.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) {
        return;
      }

      try {
        entries.push(JSON.parse(line) as unknown);
      } catch (error) {
        parseErrors.push({
          line: index + 1,
          error: messageFromError(error),
          raw: line,
        });
      }
    });

    return {
      file,
      found: true,
      count: entries.length,
      sizeBytes: statSync(file).size,
      entries,
      parseErrors,
    };
  } catch (error) {
    return { file, found: true, error: messageFromError(error) };
  }
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function previewValue(value: unknown, limit = 900) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}\n...<truncated ${text.length - limit} chars>`;
}

function compactTranscriptEvent(entry: unknown) {
  const record = asRecord(entry);

  if (!record) {
    return entry;
  }

  const message = asRecord(record.message);
  const content = message?.content;

  return {
    type: record.type,
    uuid: record.uuid,
    timestamp: record.timestamp,
    agentId: record.agentId,
    cwd: record.cwd,
    sessionId: record.sessionId,
    gitBranch: record.gitBranch,
    message: message
      ? {
          role: message.role,
          contentKind: Array.isArray(content) ? "array" : typeof content,
          contentItems: Array.isArray(content) ? content.length : undefined,
          contentPreview: previewValue(content),
        }
      : undefined,
  };
}

type WorkerKind = "explore" | "synthesis";

type Worker = {
  id: string;
  fullId: string;
  label: string;
  kind: WorkerKind;
  model: string;
  events: number;
  sizeKb: number;
  resultCount: number;
  summary: string;
  session: {
    file: string;
    cwd: string;
    externalSessionId: string;
    latestTimestamp: string;
    eventCounts: Record<string, number>;
    tools: string[];
    promptExcerpt?: string;
    resultLabel: string;
    protect?: string[];
    opportunities?: string[];
    quickWins?: string[];
    signatureBet?: string;
  };
};

type JournalStep = {
  n: number;
  type: "started" | "result";
  agent: string;
  label: string;
  kind?: WorkerKind;
};

const run = {
  id: "wf_edb96359-320",
  name: "talkie-delight-scout",
  taskId: "wn342iea9",
  parentSession: "02882166-cd21-42b3-9b01-df8912d441dc",
  cwd: "/Users/art/dev/talkie",
  branch: "codex/top-band-study",
  localTime: "2026-06-03 23:06 -> 23:14 EDT",
  summary:
    "Scout every Talkie surface for concrete delight opportunities, then synthesize a prioritized set.",
  headline:
    "Talkie is mechanically excellent and visually on-brand, but emotionally flat at the seams. The mag-tape soul lives inside recording, while many state changes are silent and unrewarded.",
  signatureBet:
    "The tape transport: a living tape-head needle that travels the whole capture -> read -> play lifecycle.",
  sourceRefs: {
    parent:
      "~/.claude/projects/-Users-art-dev-talkie/02882166...jsonl",
    runDir:
      "~/.claude/projects/-Users-art-dev-talkie/02882166.../subagents/workflows/wf_edb96359-320/",
    script:
      "~/.claude/projects/-Users-art-dev-talkie/02882166.../workflows/scripts/talkie-delight-scout-wf_edb96359-320.js",
  },
};

const workers: Worker[] = [
  {
    id: "a9c4a9e0",
    fullId: "a9c4a9e0f777ab311",
    label: "AI intelligence",
    kind: "explore",
    model: "haiku-4-5",
    events: 46,
    sizeKb: 267,
    resultCount: 9,
    summary:
      "Capable but transactional. Thinking states exist, but response arrivals and AI edits lack progressive reveal or arrival weight.",
    session: {
      file: "agent-a9c4a9e0f777ab311.jsonl",
      cwd: "/Users/art/dev/talkie",
      externalSessionId: "02882166-cd21-42b3-9b01-df8912d441dc",
      latestTimestamp: "2026-06-04T03:07:38.276Z",
      eventCounts: { user: 18, attachment: 2, assistant: 26 },
      tools: ["Bash", "Read", "StructuredOutput"],
      promptExcerpt:
        "SURFACE: the intelligence layer — Ask AI, compose AI commands, revision, model selection, AI credentials. Read AskAINext, CaptureAICommandsSheet, AICredentialsNext, ComposeStore, and ComposeLocalRevisionService.",
      resultLabel:
        "Intelligence layer — Ask AI, Compose AI revisions, AI Commands, AI credentials/model selection",
      protect: [
        "Auto-save + undo model respects the user's flow.",
        "PulsingAccentDot animation is tactful and does not distract from thinking.",
        "Inline diff in Compose makes edits scannable and reviewable.",
      ],
      opportunities: [
        "Typewriter reveal on Ask AI responses",
        "Diff arrival flourish in Compose",
        "Model/provider indicator badge refresh on selection",
        "AI credential validation celebration",
      ],
    },
  },
  {
    id: "a1734246",
    fullId: "a1734246f3572587f",
    label: "macOS HUD",
    kind: "explore",
    model: "haiku-4-5",
    events: 69,
    sizeKb: 202,
    resultCount: 9,
    summary:
      "Already crafted and instrument-like. The missing delight is in capture selection feedback, preview collision cues, and timeout/body signals.",
    session: {
      file: "agent-a1734246f3572587f.jsonl",
      cwd: "/Users/art/dev/talkie",
      externalSessionId: "02882166-cd21-42b3-9b01-df8912d441dc",
      latestTimestamp: "2026-06-04T03:08:02.709Z",
      eventCounts: { user: 23, attachment: 2, assistant: 44 },
      tools: ["Bash", "Read", "StructuredOutput"],
      promptExcerpt:
        "SURFACE: the macOS capture HUD + screenshot preview + chrome. Explore apps/macos/Talkie and read the capture HUD, screenshot preview panel, status readout, and chrome/tray views.",
      resultLabel:
        "macOS capture HUD + screenshot preview + chrome (PEARL/SLATE/AMBER trio, deck-of-cards stack)",
      protect: [
        "Instrument-bay vocabulary reads as milled hardware, not a flat sticker.",
        "Wallpaper-adaptive palette trio keeps contrast without hardcoded tones.",
        "Proximity-based opacity ramps feel anticipatory, not reactive.",
      ],
      opportunities: [
        "Snap glow flash on capture mode selection",
        "Haptic tap on capture mode selection",
        "Deck-of-cards collision cue when HUD and preview overlap",
        "Palette warm-up transition when adaptive scheme changes",
      ],
    },
  },
  {
    id: "a730169b",
    fullId: "a730169b55f42a12a",
    label: "Companion bridge",
    kind: "explore",
    model: "haiku-4-5",
    events: 38,
    sizeKb: 320,
    resultCount: 16,
    summary:
      "Secure and functional, but the pairing handshake and reconnection story feel like networking rather than a magical companion link.",
    session: {
      file: "agent-a730169b55f42a12a.jsonl",
      cwd: "/Users/art/dev/talkie",
      externalSessionId: "02882166-cd21-42b3-9b01-df8912d441dc",
      latestTimestamp: "2026-06-04T03:08:02.910Z",
      eventCounts: { user: 15, attachment: 2, assistant: 21 },
      tools: ["Bash", "Read", "StructuredOutput"],
      promptExcerpt:
        "SURFACE: the Mac<->iPhone companion experience — pairing, connection status, screen mirror, and the deck mirror.",
      resultLabel:
        "Mac<->iPhone Companion Experience (Pairing Handshake, Live Connection, Reconnection, Deck Mirror)",
      protect: [
        "Pairing phase banner honestly shows where the user is in the process.",
        "Deck mirror tiles animate on tap with immediate feedback.",
        "Mag-tape waveform in DeckCockpit is a strong visual identity.",
      ],
      opportunities: [
        "Haptic pulse on successful pairing approval",
        "Fade + scale-in the pairing phase banner chips",
        "Haptic feedback on Deck tile fire + visual echo timing",
        "Animated connection status dot in BridgeDetail",
      ],
    },
  },
  {
    id: "a8e09ba9",
    fullId: "a8e09ba9a883963f0",
    label: "First run",
    kind: "explore",
    model: "haiku-4-5",
    events: 47,
    sizeKb: 245,
    resultCount: 7,
    summary:
      "The first 60 seconds are clear but under-celebrated. Permissions, sign-in, and first success need earned sensory punctuation.",
    session: {
      file: "agent-a8e09ba9a883963f0.jsonl",
      cwd: "/Users/art/dev/talkie",
      externalSessionId: "02882166-cd21-42b3-9b01-df8912d441dc",
      latestTimestamp: "2026-06-04T03:08:04.492Z",
      eventCounts: { user: 18, attachment: 2, assistant: 27 },
      tools: ["Bash", "Read", "StructuredOutput"],
      promptExcerpt:
        "SURFACE: onboarding, first-run, splash, sign-in, keyboard activation. Focus on the first launch, splash handoff, Sign in with Apple, first recording, and keyboard extension activation.",
      resultLabel:
        "Onboarding, First-Run, Splash, Sign-In, Keyboard Activation (iOS)",
      protect: [
        "Splash screen stagger creates a feeling of arrival without overload.",
        "Welcome hero pulse signals life.",
        "Sign-in auth steps form a satisfying visual state machine.",
      ],
      opportunities: [
        "Tape-head marker on first recording",
        "Centerline amber glow on permission checkmarks",
        "Splash -> Home handoff with waveform halo",
        "Sign-in -> Home completion pulse",
      ],
    },
  },
  {
    id: "a7c6f8de",
    fullId: "a7c6f8de0d035117c",
    label: "Core loop",
    kind: "explore",
    model: "haiku-4-5",
    events: 38,
    sizeKb: 246,
    resultCount: 10,
    summary:
      "Recording, composing, and dictation are mechanically sound, but key moments like start, stop, and transcript landing are quiet.",
    session: {
      file: "agent-a7c6f8de0d035117c.jsonl",
      cwd: "/Users/art/dev/talkie",
      externalSessionId: "02882166-cd21-42b3-9b01-df8912d441dc",
      latestTimestamp: "2026-06-04T03:08:21.481Z",
      eventCounts: { user: 15, attachment: 2, assistant: 21 },
      tools: ["Bash", "Read", "StructuredOutput"],
      promptExcerpt:
        "SURFACE: the core capture -> compose -> dictation loop. Read CaptureComposeNextView, ComposeNextView, RecordingSheetNext, MinimalDictationOverlayNext, ListeningBubble, VoicePivotButton, RecordingView, and WaveformView.",
      resultLabel:
        "Capture -> Compose -> Dictation Loop (RecordingSheetNext, ComposeNextView, WaveformView)",
      protect: [
        "WaveformBars staggered sine-wave cycle reads as a real level meter.",
        "VoicePivotButton brass halo earns expanded/listening states.",
        "ParticlesWaveformView is voice-reactive, not a static chart.",
      ],
      opportunities: [
        "Tape-head marker synced to waveform playhead during transcription",
        "Haptic pulse on mic start and recording-stop moments",
        "Live partial transcription animation",
        "Waveform bar height easing on arrival",
      ],
    },
  },
  {
    id: "afafa731",
    fullId: "afafa7319133bafb0",
    label: "Home/library",
    kind: "explore",
    model: "haiku-4-5",
    events: 47,
    sizeKb: 317,
    resultCount: 13,
    summary:
      "Polished hierarchy and spacing, but empty states and row interactions need a stronger first-impression and tactile response.",
    session: {
      file: "agent-afafa7319133bafb0.jsonl",
      cwd: "/Users/art/dev/talkie",
      externalSessionId: "02882166-cd21-42b3-9b01-df8912d441dc",
      latestTimestamp: "2026-06-04T03:08:24.424Z",
      eventCounts: { user: 18, attachment: 2, assistant: 27 },
      tools: ["Bash", "Read", "StructuredOutput"],
      promptExcerpt:
        "SURFACE: home, library, feed, history, and empty states. Read HomeNextView, HomeFeed, LibraryFeed, LibraryNextView, DictationHistoryNext, VoiceMemoDetailNext, and CaptureListSectionNext.",
      resultLabel: "Home, Library, Dictation History, and Empty States (iOS)",
      protect: [
        "Soft brass underline tabs with easeOut animation on Library.",
        "Content-type glyphs in list rows match the material.",
        "Haptic copy feedback appears in dictation history entries.",
      ],
      opportunities: [
        "First-empty-memo entrance animation",
        "Empty state icon idle breath",
        "Recent/Library row press background flash + haptic snap",
        "Pull-to-refresh tape-head alignment checkpoint",
      ],
    },
  },
  {
    id: "ab7466d9",
    fullId: "ab7466d90bea3b3f2",
    label: "Sensory system",
    kind: "explore",
    model: "haiku-4-5",
    events: 102,
    sizeKb: 260,
    resultCount: 10,
    summary:
      "The foundation is present, but haptics, motion, sound, and waveform identity are scattered rather than a coherent system.",
    session: {
      file: "agent-ab7466d90bea3b3f2.jsonl",
      cwd: "/Users/art/dev/talkie",
      externalSessionId: "02882166-cd21-42b3-9b01-df8912d441dc",
      latestTimestamp: "2026-06-04T03:10:04.041Z",
      eventCounts: { user: 35, attachment: 2, assistant: 65 },
      tools: ["Bash", "Read", "StructuredOutput"],
      promptExcerpt:
        "SURFACE: the cross-cutting sensory layer — motion, haptics, sound, and the mag-tape waveform identity across the whole iOS app.",
      resultLabel:
        "iOS App: Cross-cutting sensory layer (haptics, motion, sound, waveform aesthetic)",
      protect: [
        "WalkieFX synth sound design is thoughtfully crafted and modular.",
        "Particles waveform animation is organic and responsive.",
        "TalkieStatusDot phosphor pulse is subtle and theme-aware.",
      ],
      opportunities: [
        "Sonic bookends for recording lifecycle",
        "Haptic stacking by interaction class",
        "Waveform as system indicator during sync/transcription",
        "Sync state sonification with tiny tonal rises/falls",
      ],
    },
  },
  {
    id: "ad037917",
    fullId: "ad0379178b9c0022a",
    label: "Synthesis",
    kind: "synthesis",
    model: "opus-4-8",
    events: 10,
    sizeKb: 131,
    resultCount: 7,
    summary:
      "Deduped surface reports into seven themes, eight quick wins, and one signature bet around a persistent tape-head transport.",
    session: {
      file: "agent-ad0379178b9c0022a.jsonl",
      cwd: "/Users/art/dev/talkie",
      externalSessionId: "02882166-cd21-42b3-9b01-df8912d441dc",
      latestTimestamp: "2026-06-04T03:14:49.447Z",
      eventCounts: { user: 3, attachment: 2, assistant: 5 },
      tools: ["StructuredOutput"],
      resultLabel: "Synthesis",
      protect: [
        "WaveformBars staggered sine cycle",
        "VoicePivotButton brass halo",
        "ParticlesWaveformView level-proportional spawn",
      ],
      opportunities: [
        "Tape-head marker + permanent amber centerline on the live waveform",
        "Saved-memo waveform fingerprint instead of a bare checkmark",
        "Waveform never leaves — it wakes up during sync/transcription",
        "Per-bar level easing so the waveform reacts with inertia",
      ],
      quickWins: [
        "Tape-head marker + permanent amber centerline on the live waveform",
        "Haptic taxonomy utility replacing today's uniform .light",
        "Record-start/stop + dictation-toggle haptics fired on the exact frame",
        "First-ever-save fanfare gated on a settings flag",
      ],
      signatureBet:
        "The tape transport: a living tape-head needle that travels the whole capture -> read -> play lifecycle",
    },
  },
];

const journal: JournalStep[] = [
  { n: 1, type: "started", agent: "a7c6f8de", label: "core loop" },
  { n: 2, type: "started", agent: "a1734246", label: "macOS HUD" },
  { n: 3, type: "started", agent: "a730169b", label: "companion" },
  { n: 4, type: "started", agent: "ab7466d9", label: "sensory" },
  { n: 5, type: "started", agent: "a8e09ba9", label: "first run" },
  { n: 6, type: "started", agent: "afafa731", label: "home/library" },
  { n: 7, type: "started", agent: "a9c4a9e0", label: "AI" },
  { n: 8, type: "result", agent: "a9c4a9e0", label: "9 AI opportunities", kind: "explore" },
  { n: 9, type: "result", agent: "a1734246", label: "9 HUD opportunities", kind: "explore" },
  { n: 10, type: "result", agent: "a730169b", label: "16 bridge opportunities", kind: "explore" },
  { n: 11, type: "result", agent: "a8e09ba9", label: "7 first-run opportunities", kind: "explore" },
  { n: 12, type: "result", agent: "a7c6f8de", label: "10 core-loop opportunities", kind: "explore" },
  { n: 13, type: "result", agent: "afafa731", label: "13 home opportunities", kind: "explore" },
  { n: 14, type: "result", agent: "ab7466d9", label: "10 sensory opportunities", kind: "explore" },
  { n: 15, type: "started", agent: "ad037917", label: "synthesis" },
  { n: 16, type: "result", agent: "ad037917", label: "7 themes, 8 quick wins", kind: "synthesis" },
];

const coverage = [
  "Workflow group with run id, parent session, task id, transcript directory, and script path.",
  "Lead parent-session agent plus one observed agent for each workflow transcript.",
  "Source refs for parent transcript, run directory, journal, script, metadata, and agent transcripts.",
  "Relationships for member_of, leads, and spawned, enough to draw topology.",
  "Basic agent status, cwd, model, latest timestamp, event count, and source ref.",
];

const gaps = [
  "No first-class workflow_run record with phase timings, status, result summary, and output artifacts.",
  "Journal results stay buried in source refs instead of becoming run-level worker outputs.",
  "Worker labels fall back to ids; script labels and surface prompts are not projected into the UI model.",
  "Synthesis is just another subagent, not the run's final answer or handoff.",
  "No distinction between workflow bookkeeping files and session transcripts unless each source filters carefully.",
  "No compact run brief for the operator: objective, fan-out, worker findings, final synthesis, and follow-up actions.",
];

const quickWins = [
  "Project worker output summaries from journal.result into the observed topology payload.",
  "Promote the synthesis result to a workflow-level outcome when it matches the final agent phase.",
  "Capture script phases and labels as stable metadata, not just source file text.",
  "Expose workflow run refs as /workflows/:runId or nested inside the existing work detail page.",
  "Treat journal.jsonl as a workflow event ledger, never as a session transcript.",
];

const journalSource = readJsonlSource("journal.jsonl");

const runSource = {
  kind: "workflow_run",
  derived: run,
  source: {
    workflowDir: WORKFLOW_DIR,
    journal: {
      file: journalSource.file,
      found: journalSource.found,
      count: journalSource.count,
      sizeBytes: journalSource.sizeBytes,
      parseErrors: journalSource.parseErrors,
    },
    workerFiles: workers.map((worker) => ({
      agentId: worker.fullId,
      transcript: join(WORKFLOW_DIR, worker.session.file),
      meta: join(
        WORKFLOW_DIR,
        worker.session.file.replace(/\.jsonl$/, ".meta.json"),
      ),
    })),
  },
  derivedJournal: journal,
};

const proposedProjection = {
  runId: run.id,
  parentSessionId: run.parentSession,
  taskId: run.taskId,
  name: run.name,
  objective: run.summary,
  status: "completed",
  phases: ["fanout", "worker-results", "synthesis"],
  workers: workers.map((worker) => ({
    agentId: worker.fullId,
    label: worker.label,
    kind: worker.kind,
    model: worker.model,
    sourceFile: worker.session.file,
    output: worker.session.resultLabel,
  })),
  outcome: workers.find((worker) => worker.kind === "synthesis")?.session,
  sourceRefs: run.sourceRefs,
};

function journalEntrySource(index: number) {
  return journalSource.entries?.[index] ?? {
    missingSourceLine: true,
    derivedFallback: journal[index],
  };
}

function workerSource(worker: Worker) {
  const transcript = readJsonlSource(worker.session.file);
  const meta = readJsonFileSource(
    worker.session.file.replace(/\.jsonl$/, ".meta.json"),
  );
  const transcriptEntries = transcript.entries ?? [];

  return {
    kind: "workflow_worker_session",
    agentId: worker.fullId,
    label: worker.label,
    worker: {
      kind: worker.kind,
      model: worker.model,
      events: worker.events,
      sizeKb: worker.sizeKb,
      resultCount: worker.resultCount,
      summary: worker.summary,
    },
    derivedSession: worker.session,
    source: {
      meta,
      transcript: {
        file: transcript.file,
        found: transcript.found,
        count: transcript.count,
        sizeBytes: transcript.sizeBytes,
        parseErrors: transcript.parseErrors,
        firstEvents: transcriptEntries.slice(0, 2).map(compactTranscriptEvent),
        lastEvents: transcriptEntries.slice(-2).map(compactTranscriptEvent),
      },
    },
  };
}

export default function WorkflowRunStudy() {
  const exploreWorkers = workers.filter((worker) => worker.kind === "explore");
  const synthWorker = workers.find((worker) => worker.kind === "synthesis");

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <Header />
      <Overview />
      <section className="mb-10 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <ExecutionSpine />
        <RunOutput synthWorker={synthWorker} />
      </section>
      <WorkerGrid workers={exploreWorkers} />
      <CoveragePanel />
      <ModelProposal />
    </main>
  );
}

function Header() {
  return (
    <div className="mb-8 border-b border-studio-edge pb-5">
      <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · openscout · workflow observation
      </div>
      <h1 className="mt-1 font-display text-[28px] font-medium leading-none text-studio-ink">
        Workflow Run Brief
      </h1>
      <p className="mt-3 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
        A design sketch for representing a Claude workflow as one coordinated
        run: launch context, worker fan-out, journaled results, and final
        synthesis. Expand any source block to see the JSON underneath the
        recent Talkie run <code>{run.id}</code>.
      </p>
    </div>
  );
}

function Overview() {
  return (
    <section className="mb-10 grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="rounded-md border border-studio-edge bg-studio-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              run
            </div>
            <h2 className="mt-1 font-display text-[24px] font-medium leading-tight text-studio-ink">
              {run.name}
            </h2>
            <p className="mt-2 max-w-3xl font-sans text-[13px] leading-relaxed text-studio-ink-faint">
              {run.summary}
            </p>
          </div>
          <StatusBadge label="completed" tone="ok" />
        </div>

        <dl className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="run id" value={run.id} />
          <Metric label="task" value={run.taskId} />
          <Metric label="workers" value="7 + 1" />
          <Metric label="journal" value="16 events" />
        </dl>
        <SourceDisclosure
          defaultOpen
          label="run source"
          meta="derived object + filesystem refs"
          value={runSource}
        />
      </div>

      <div className="rounded-md border border-studio-edge bg-studio-surface p-5">
        <div className="mb-4 text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          source refs
        </div>
        <SourceRow label="parent" value={run.sourceRefs.parent} />
        <SourceRow label="run dir" value={run.sourceRefs.runDir} />
        <SourceRow label="script" value={run.sourceRefs.script} />
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-studio-edge pt-4">
          <Metric label="cwd" value={run.cwd.split("/").slice(-2).join("/")} />
          <Metric label="time" value={run.localTime} />
        </div>
      </div>
    </section>
  );
}

function ExecutionSpine() {
  return (
    <section className="rounded-md border border-studio-edge bg-studio-surface p-5">
      <SectionHead title="Execution spine" meta="journal.jsonl -> run lifecycle" />
      <div className="mt-5 grid gap-2">
        {journal.map((step, index) => (
          <div
            key={step.n}
            className="rounded border border-studio-edge bg-studio-canvas-alt px-3 py-2"
          >
            <div className="grid grid-cols-[34px_88px_minmax(0,1fr)] items-center gap-3">
              <span className="font-mono text-[10px] text-studio-ink-faint">
                {String(step.n).padStart(2, "0")}
              </span>
              <span
                className={`inline-flex h-6 items-center justify-center rounded-sm border px-2 font-mono text-[9px] uppercase tracking-ch ${
                  step.type === "result"
                    ? "border-scout-accent/40 bg-scout-accent-soft text-scout-accent"
                    : "border-studio-edge-strong bg-studio-canvas text-studio-ink-faint"
                }`}
              >
                {step.type}
              </span>
              <div className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-[10px] text-studio-ink-muted">
                    {step.agent}
                  </span>
                  <span className="truncate font-sans text-[13px] text-studio-ink">
                    {step.label}
                  </span>
                </div>
              </div>
            </div>
            <SourceDisclosure
              compact
              label={`journal line ${step.n}`}
              meta={journalSource.file.split("/").pop()}
              value={journalEntrySource(index)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function RunOutput({ synthWorker }: { synthWorker?: Worker }) {
  return (
    <aside className="rounded-md border border-studio-edge bg-studio-surface p-5">
      <SectionHead title="Final synthesis" meta="promote this to run outcome" />
      <p className="mt-5 font-display text-[19px] leading-snug text-studio-ink">
        {run.headline}
      </p>
      <div className="mt-5 rounded border border-scout-accent/40 bg-scout-accent-soft p-4">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-scout-accent">
          signature bet
        </div>
        <p className="mt-2 font-sans text-[13px] leading-relaxed text-studio-ink">
          {run.signatureBet}
        </p>
      </div>
      {synthWorker ? (
        <>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <Metric label="themes" value={String(synthWorker.resultCount)} />
            <Metric label="quick wins" value="8" />
            <Metric label="model" value={synthWorker.model} />
          </div>
          <SourceDisclosure
            label="synthesis source"
            meta={synthWorker.session.file}
            value={workerSource(synthWorker)}
          />
        </>
      ) : null}
    </aside>
  );
}

function WorkerGrid({ workers: items }: { workers: Worker[] }) {
  return (
    <section className="mb-10">
      <SectionHead title="Worker findings" meta="seven parallel surface scouts" />
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((worker) => (
          <article
            key={worker.id}
            className="rounded-md border border-studio-edge bg-studio-surface p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
                  {worker.id}
                </div>
                <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-studio-ink">
                  {worker.label}
                </h3>
              </div>
              <StatusBadge label={`${worker.resultCount} opps`} tone="neutral" />
            </div>
            <p className="mt-3 min-h-[72px] font-sans text-[13px] leading-relaxed text-studio-ink-faint">
              {worker.summary}
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-studio-edge pt-3">
              <Metric label="events" value={String(worker.events)} />
              <Metric label="size" value={`${worker.sizeKb} KB`} />
              <Metric label="model" value={worker.model} />
            </div>
            <SourceDisclosure
              label="session source"
              meta={worker.session.file}
              value={workerSource(worker)}
            />
          </article>
        ))}
      </div>
    </section>
  );
}

function CoveragePanel() {
  return (
    <section className="mb-10 grid gap-5 lg:grid-cols-2">
      <ListPanel
        title="Covered today"
        meta="observed topology"
        items={coverage}
        tone="ok"
      />
      <ListPanel
        title="Missing shape"
        meta="needed for first-class support"
        items={gaps}
        tone="warn"
      />
    </section>
  );
}

function ModelProposal() {
  return (
    <section className="rounded-md border border-studio-edge bg-studio-surface p-5">
      <SectionHead title="Proposed projection" meta="smallest useful model" />
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded border border-studio-edge bg-studio-canvas-alt p-4">
          <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            workflow_run
          </div>
          <SourceDisclosure
            defaultOpen
            compact
            label="projection source"
            meta="candidate JSON shape"
            value={proposedProjection}
          />
        </div>
        <ListPanel
          title="Near-term UI moves"
          meta="good enough to try"
          items={quickWins}
          tone="neutral"
        />
      </div>
    </section>
  );
}

function SourceDisclosure({
  label,
  meta,
  value,
  defaultOpen = false,
  compact = false,
}: {
  label: string;
  meta?: string;
  value: unknown;
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const text = JSON.stringify(value, null, 2) ?? String(value);

  return (
    <details
      className={`${compact ? "mt-2" : "mt-4"} min-w-0 max-w-full rounded border border-studio-edge bg-studio-canvas`}
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-mono text-[10px] uppercase tracking-ch text-studio-ink-muted marker:hidden [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <span className="truncate text-right text-[9px] text-studio-ink-faint">
          {meta ?? "json"}
        </span>
      </summary>
      <pre className="max-h-96 min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words border-t border-studio-edge bg-studio-canvas-alt p-3 font-mono text-[10px] leading-relaxed text-studio-ink-muted">
        {text}
      </pre>
    </details>
  );
}

function SectionHead({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="font-display text-[20px] font-medium tracking-tight text-studio-ink">
        {title}
      </h2>
      <span className="font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
        {meta}
      </span>
      <span className="h-px flex-1 bg-studio-edge" />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-studio-edge bg-studio-canvas-alt px-3 py-2">
      <dt className="truncate font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
        {label}
      </dt>
      <dd className="mt-1 truncate font-mono text-[11px] text-studio-ink">
        {value}
      </dd>
    </div>
  );
}

function SourceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 border-t border-studio-edge py-3 first:border-t-0 first:pt-0">
      <span className="font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
        {label}
      </span>
      <span className="truncate font-mono text-[10px] text-studio-ink-muted">
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "ok" | "warn" | "neutral" }) {
  const cls =
    tone === "ok"
      ? "border-status-ok-fg/40 bg-status-ok-bg text-status-ok-fg"
      : tone === "warn"
        ? "border-status-warn-fg/40 bg-status-warn-bg text-status-warn-fg"
        : "border-studio-edge-strong bg-status-neutral-bg text-status-neutral-fg";
  return (
    <span className={`inline-flex rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-ch ${cls}`}>
      {label}
    </span>
  );
}

function ListPanel({
  title,
  meta,
  items,
  tone,
}: {
  title: string;
  meta: string;
  items: string[];
  tone: "ok" | "warn" | "neutral";
}) {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface p-5">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="font-display text-[20px] font-medium tracking-tight text-studio-ink">
            {title}
          </h2>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
            {meta}
          </div>
        </div>
        <StatusBadge label={String(items.length)} tone={tone} />
      </div>
      <ul className="grid gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="grid grid-cols-[10px_minmax(0,1fr)] gap-3 rounded border border-studio-edge bg-studio-canvas-alt px-3 py-2"
          >
            <span className="mt-[7px] h-1.5 w-1.5 rounded-sm bg-scout-accent" />
            <span className="font-sans text-[13px] leading-relaxed text-studio-ink-faint">
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
