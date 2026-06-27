import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Link from "next/link";
import { WorkflowMap } from "./workflow-map";

export const dynamic = "force-dynamic";

type Search = {
  run?: string;
  project?: string;
};

type JsonRecord = Record<string, unknown>;

type WorkflowCandidate = {
  runId: string;
  workflowDir: string;
  parentSessionId: string;
  parentSessionPath: string;
  projectDir: string;
  projectLabel: string;
  mtimeMs: number;
};

type JournalEvent = {
  index: number;
  type: string;
  key: string | null;
  agentId: string | null;
  result: JsonRecord | null;
  raw: JsonRecord;
};

type LaunchMeta = {
  taskId: string | null;
  summary: string | null;
  cwd: string | null;
  scriptPath: string | null;
  transcriptDir: string | null;
};

type TraceEvent = {
  index: number;
  type: string;
  role: string | null;
  tool: string | null;
  detail: string | null;
  text: string | null;
  at: number | null;
};

type WorkerTrace = {
  totalEvents: number;
  firstAt: number | null;
  typeCounts: Record<string, number>;
  toolCounts: Record<string, number>;
  finalText: string | null;
  head: TraceEvent[];
  tail: TraceEvent[];
};

type WorkerNode = {
  id: string;
  shortId: string;
  label: string;
  kind: "review" | "verification" | "synthesis" | "worker";
  status: "completed" | "running" | "observed";
  score: number | null;
  findingCount: number;
  eventCount: number;
  sizeKb: number;
  model: string | null;
  latestAt: number | null;
  startedIndex: number | null;
  resultIndex: number | null;
  prompt: string | null;
  output: string[];
  sourceFile: string;
  trace: WorkerTrace;
};

type WorkflowModel = {
  candidate: WorkflowCandidate;
  launch: LaunchMeta;
  journal: JournalEvent[];
  workers: WorkerNode[];
  completedCount: number;
  runningCount: number;
  scoreAverage: number | null;
  startedCount: number;
  resultCount: number;
};

const MAX_RECENT_RUNS = 14;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function statMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function statSizeKb(path: string): number {
  try {
    return Math.max(1, Math.round(statSync(path).size / 1024));
  } catch {
    return 0;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readJsonFile(path: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function readJsonl(path: string): JsonRecord[] {
  if (!isFile(path)) return [];
  const raw = readFileSync(path, "utf8");
  const records: JsonRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      const record = asRecord(parsed);
      if (record) records.push(record);
    } catch {
      // Claude writes JSONL while sessions are active; skip partial lines.
    }
  }
  return records;
}

function compactPath(path: string | null): string {
  if (!path) return "-";
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function shortId(value: string | null | undefined, size = 8): string {
  if (!value) return "-";
  return value.length > size ? value.slice(0, size) : value;
}

function formatAgo(ms: number | null): string {
  if (!ms) return "-";
  const delta = Math.max(0, Date.now() - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < hour) return `${Math.max(1, Math.round(delta / minute))}m ago`;
  if (delta < day) return `${Math.round(delta / hour)}h ago`;
  return `${Math.round(delta / day)}d ago`;
}

function formatClock(ms: number | null): string {
  if (!ms) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatTime(ms: number | null): string {
  if (!ms) return "--:--:--";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(contentText).filter(Boolean).join(" ");
  }
  const record = asRecord(value);
  if (!record) return "";
  return [
    record.text,
    record.content,
    record.name,
    record.summary,
    record.title,
  ].map(contentText).filter(Boolean).join(" ");
}

function eventTimestampMs(record: JsonRecord): number | null {
  const raw = stringValue(record.timestamp);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function discoverWorkflowRuns(projectFilter?: string): WorkflowCandidate[] {
  const projectsRoot = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsRoot) || !isDirectory(projectsRoot)) return [];

  const runs: WorkflowCandidate[] = [];
  for (const projectEntry of readdirSync(projectsRoot).sort()) {
    if (projectFilter && !projectEntry.toLowerCase().includes(projectFilter.toLowerCase())) {
      continue;
    }
    const projectDir = join(projectsRoot, projectEntry);
    if (!isDirectory(projectDir)) continue;

    for (const sessionEntry of readdirSync(projectDir).sort()) {
      const sessionDir = join(projectDir, sessionEntry);
      const workflowsRoot = join(sessionDir, "subagents", "workflows");
      if (!isDirectory(workflowsRoot)) continue;

      for (const runEntry of readdirSync(workflowsRoot).sort()) {
        const workflowDir = join(workflowsRoot, runEntry);
        if (!isDirectory(workflowDir)) continue;
        runs.push({
          runId: runEntry,
          workflowDir,
          parentSessionId: sessionEntry,
          parentSessionPath: join(projectDir, `${sessionEntry}.jsonl`),
          projectDir,
          projectLabel: projectEntry.replace(/^-Users-[^-]+-dev-/, "").replace(/-/g, "/"),
          mtimeMs: statMtimeMs(workflowDir),
        });
      }
    }
  }

  return runs.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function normalizeJournal(path: string): JournalEvent[] {
  return readJsonl(path).map((raw, index) => ({
    index,
    type: stringValue(raw.type) ?? "event",
    key: stringValue(raw.key),
    agentId: stringValue(raw.agentId),
    result: asRecord(raw.result),
    raw,
  }));
}

function readLaunchMeta(candidate: WorkflowCandidate): LaunchMeta {
  const empty: LaunchMeta = {
    taskId: null,
    summary: null,
    cwd: null,
    scriptPath: null,
    transcriptDir: null,
  };
  const parentEvents = readJsonl(candidate.parentSessionPath);
  for (const event of parentEvents) {
    const toolUseResult = asRecord(event.toolUseResult);
    if (stringValue(toolUseResult?.runId) !== candidate.runId) continue;
    return {
      taskId: stringValue(toolUseResult?.taskId),
      summary: stringValue(toolUseResult?.summary),
      cwd: stringValue(event.cwd),
      scriptPath: stringValue(toolUseResult?.scriptPath),
      transcriptDir: stringValue(toolUseResult?.transcriptDir),
    };
  }
  return empty;
}

function resultTitle(result: JsonRecord | null): string | null {
  if (!result) return null;
  return stringValue(result.lens)
    ?? stringValue(result.title)
    ?? stringValue(result.summary)
    ?? stringValue(result.reason)
    ?? stringValue(result.verdict);
}

function countResultItems(result: JsonRecord | null): number {
  if (!result) return 0;
  return arrayValue(result.findings).length
    || arrayValue(result.gaps).length
    || arrayValue(result.punchList).length
    || arrayValue(result.quickWins).length
    || arrayValue(result.opportunities).length;
}

function resultKind(result: JsonRecord | null): WorkerNode["kind"] {
  if (!result) return "worker";
  if (asRecord(result.scores) || arrayValue(result.punchList).length > 0) return "synthesis";
  if (typeof result.real === "boolean" || stringValue(result.refinedFix)) return "verification";
  if (arrayValue(result.findings).length > 0 || arrayValue(result.gaps).length > 0) return "review";
  return "worker";
}

function resultScore(result: JsonRecord | null): number | null {
  if (!result) return null;
  const score = numberValue(result.score);
  if (score !== null) return score;
  return numberValue(asRecord(result.scores)?.overall);
}

function resultPreview(result: JsonRecord | null): string[] {
  if (!result) return [];
  const direct = [
    stringValue(result.summary),
    stringValue(result.reason),
    stringValue(result.refinedFix),
  ].filter((value): value is string => Boolean(value));
  if (direct.length > 0) return direct.map((value) => truncate(value, 220)).slice(0, 2);

  const fromList = [
    ...arrayValue(result.findings),
    ...arrayValue(result.gaps),
    ...arrayValue(result.punchList),
    ...arrayValue(result.quickWins),
    ...arrayValue(result.opportunities),
  ].map((item) => {
    const record = asRecord(item);
    return stringValue(record?.title) ?? stringValue(record?.fix) ?? stringValue(item);
  }).filter((value): value is string => Boolean(value));

  return fromList.map((value) => truncate(value, 180)).slice(0, 3);
}

function truncate(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

function toolInputDetail(input: JsonRecord | null): string | null {
  if (!input) return null;
  const filePath = stringValue(input.file_path) ?? stringValue(input.path) ?? stringValue(input.notebook_path);
  if (filePath) return filePath.split("/").slice(-1)[0] ?? filePath;
  const probe = stringValue(input.pattern)
    ?? stringValue(input.query)
    ?? stringValue(input.command)
    ?? stringValue(input.description)
    ?? stringValue(input.prompt);
  return probe ? truncate(probe, 56) : null;
}

function compactEvent(record: JsonRecord, index: number): TraceEvent {
  const type = stringValue(record.type) ?? "event";
  const message = asRecord(record.message);
  const role = stringValue(message?.role);
  let tool: string | null = null;
  let detail: string | null = null;
  let text: string | null = null;

  const content = message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const blockRecord = asRecord(block);
      const blockType = stringValue(blockRecord?.type);
      if (blockType === "tool_use") {
        tool = stringValue(blockRecord?.name) ?? "tool";
        detail = toolInputDetail(asRecord(blockRecord?.input));
      } else if (blockType === "tool_result") {
        tool = tool ?? "tool_result";
      } else if (blockType === "text") {
        const value = stringValue(blockRecord?.text);
        if (value && !text) text = truncate(value, 96);
      }
    }
  } else if (typeof content === "string" && content.trim()) {
    text = truncate(content, 96);
  }

  return { index, type, role, tool, detail, text, at: eventTimestampMs(record) };
}

function transcriptStats(file: string) {
  const records = readJsonl(file);
  const eventCounts: Record<string, number> = {};
  const toolCounts: Record<string, number> = {};
  let latestAt: number | null = null;
  let firstAt: number | null = null;
  let prompt: string | null = null;
  let model: string | null = null;
  let finalText: string | null = null;
  const events: TraceEvent[] = [];

  records.forEach((record, index) => {
    const type = stringValue(record.type) ?? "event";
    eventCounts[type] = (eventCounts[type] ?? 0) + 1;
    const ts = eventTimestampMs(record);
    if (ts && (!latestAt || ts > latestAt)) latestAt = ts;
    if (ts && (!firstAt || ts < firstAt)) firstAt = ts;

    const message = asRecord(record.message);
    const role = stringValue(message?.role);
    if (!prompt && role === "user") {
      prompt = truncate(contentText(message?.content), 260);
    }
    const messageModel = stringValue(message?.model);
    if (messageModel) model = messageModel;

    const content = message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        const blockRecord = asRecord(block);
        if (stringValue(blockRecord?.type) === "tool_use") {
          const name = stringValue(blockRecord?.name) ?? "tool";
          toolCounts[name] = (toolCounts[name] ?? 0) + 1;
        }
      }
      if (role === "assistant") {
        const text = content
          .map((block) => (stringValue(asRecord(block)?.type) === "text" ? stringValue(asRecord(block)?.text) : null))
          .filter((value): value is string => Boolean(value))
          .join(" ");
        if (text.trim()) finalText = truncate(text, 360);
      }
    } else if (typeof content === "string" && role === "assistant" && content.trim()) {
      finalText = truncate(content, 360);
    }

    events.push(compactEvent(record, index));
  });

  const headSize = 5;
  const tailSize = 5;
  const head = events.slice(0, headSize);
  const tail = events.length > headSize + tailSize ? events.slice(events.length - tailSize) : events.slice(headSize);

  return {
    records,
    eventCounts,
    toolCounts,
    latestAt,
    firstAt,
    prompt,
    model,
    finalText,
    head,
    tail,
  };
}

function buildWorkflowModel(candidate: WorkflowCandidate): WorkflowModel {
  const journal = normalizeJournal(join(candidate.workflowDir, "journal.jsonl"));
  const startedByAgent = new Map<string, number>();
  const resultByAgent = new Map<string, JournalEvent>();

  for (const event of journal) {
    if (!event.agentId) continue;
    if (event.type === "started" && !startedByAgent.has(event.agentId)) {
      startedByAgent.set(event.agentId, event.index);
    }
    if (event.type === "result") {
      resultByAgent.set(event.agentId, event);
    }
  }

  const files = readdirSync(candidate.workflowDir)
    .filter((file) => /^agent-.*\.jsonl$/.test(file))
    .sort();

  const workers = files.map((file): WorkerNode => {
    const sourceFile = join(candidate.workflowDir, file);
    const id = file.replace(/^agent-/, "").replace(/\.jsonl$/, "");
    const resultEvent = resultByAgent.get(id) ?? null;
    const result = resultEvent?.result ?? null;
    const stats = transcriptStats(sourceFile);
    const meta = readJsonFile(sourceFile.replace(/\.jsonl$/, ".meta.json"));
    const title = resultTitle(result);
    const fallbackLabel = stringValue(meta?.agentType) ?? shortId(id);
    const score = resultScore(result);

    return {
      id,
      shortId: shortId(id),
      label: title ? truncate(title, 72) : fallbackLabel,
      kind: resultKind(result),
      status: resultEvent ? "completed" : startedByAgent.has(id) ? "running" : "observed",
      score,
      findingCount: countResultItems(result),
      eventCount: stats.records.length,
      sizeKb: statSizeKb(sourceFile),
      model: stats.model,
      latestAt: stats.latestAt,
      startedIndex: startedByAgent.get(id) ?? null,
      resultIndex: resultEvent?.index ?? null,
      prompt: stats.prompt,
      output: resultPreview(result),
      sourceFile: file,
      trace: {
        totalEvents: stats.records.length,
        firstAt: stats.firstAt,
        typeCounts: stats.eventCounts,
        toolCounts: stats.toolCounts,
        finalText: stats.finalText,
        head: stats.head,
        tail: stats.tail,
      },
    };
  }).sort((left, right) => {
    const leftOrder = left.resultIndex ?? left.startedIndex ?? 9999;
    const rightOrder = right.resultIndex ?? right.startedIndex ?? 9999;
    return leftOrder - rightOrder || left.id.localeCompare(right.id);
  });

  const completedCount = workers.filter((worker) => worker.status === "completed").length;
  const runningCount = workers.filter((worker) => worker.status === "running").length;
  const scores = workers.map((worker) => worker.score).filter((score): score is number => score !== null);

  return {
    candidate,
    launch: readLaunchMeta(candidate),
    journal,
    workers,
    completedCount,
    runningCount,
    scoreAverage: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    startedCount: journal.filter((event) => event.type === "started").length,
    resultCount: journal.filter((event) => event.type === "result").length,
  };
}

export default async function WorkflowRunStudy({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const runs = discoverWorkflowRuns(sp.project).slice(0, MAX_RECENT_RUNS);
  const selected = runs.find((run) => run.runId === sp.run) ?? runs[0] ?? null;
  const model = selected ? buildWorkflowModel(selected) : null;

  if (!model) {
    return (
      <main className="mx-auto max-w-page px-7 py-8">
        <Header runCount={0} />
        <section className="rounded-md border border-studio-edge bg-studio-surface p-5">
          <h2 className="font-display text-[22px] font-medium text-studio-ink">No Claude workflows found</h2>
          <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-studio-ink-faint">
            The study looks for workflow runs under <code>~/.claude/projects/*/*/subagents/workflows/*</code>.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <Header runCount={runs.length} />
      <RunSelector runs={runs} selected={model.candidate.runId} project={sp.project} />
      <RunOverview model={model} />
      <WorkflowMap model={model} />
      <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <JournalTimeline journal={model.journal} workers={model.workers} />
        <WorkerResults workers={model.workers} />
      </section>
      <SubagentTraces model={model} />
      <ModelNotes model={model} />
    </main>
  );
}

function Header({ runCount }: { runCount: number }) {
  return (
    <header className="mb-7 border-b border-studio-edge pb-5">
      <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        openscout / claude workflow topology
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[30px] font-medium leading-none text-studio-ink">
            Workflow Topology Lab
          </h1>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-studio-ink-faint">
            A live read-only renderer for Claude's generated workflow runs: parent session,
            fan-out workers, journal order, result shape, and source files.
          </p>
        </div>
        <Metric label="recent runs" value={String(runCount)} />
      </div>
    </header>
  );
}

function RunSelector({
  runs,
  selected,
  project,
}: {
  runs: WorkflowCandidate[];
  selected: string;
  project?: string;
}) {
  return (
    <nav className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Recent Claude workflow runs">
      {runs.map((run) => {
        const active = run.runId === selected;
        const href = `/studies/workflow-run?run=${encodeURIComponent(run.runId)}${project ? `&project=${encodeURIComponent(project)}` : ""}`;
        return (
          <Link
            key={run.workflowDir}
            href={href}
            className={`min-w-[190px] rounded-md border px-3 py-2 text-left transition ${
              active
                ? "border-scout-accent/50 bg-scout-accent-soft text-studio-ink"
                : "border-studio-edge bg-studio-surface text-studio-ink-faint hover:border-studio-edge-strong hover:text-studio-ink"
            }`}
          >
            <div className="truncate font-mono text-[10px]">{run.runId}</div>
            <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[9px] uppercase tracking-ch">
              <span className="truncate">{run.projectLabel}</span>
              <span>{formatAgo(run.mtimeMs)}</span>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}

function RunOverview({ model }: { model: WorkflowModel }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-md border border-studio-edge bg-studio-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
              selected run
            </div>
            <h2 className="mt-1 font-display text-[24px] font-medium leading-tight text-studio-ink">
              {model.launch.summary ?? model.candidate.runId}
            </h2>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-studio-ink-faint">
              {compactPath(model.candidate.workflowDir)}
            </p>
          </div>
          <StatusBadge label={model.runningCount > 0 ? "running" : "completed"} tone={model.runningCount > 0 ? "warn" : "ok"} />
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="workers" value={String(model.workers.length)} />
          <Metric label="started" value={String(model.startedCount)} />
          <Metric label="results" value={String(model.resultCount)} />
          <Metric label="avg score" value={model.scoreAverage ? String(model.scoreAverage) : "-"} />
          <Metric label="updated" value={formatClock(model.candidate.mtimeMs)} />
        </dl>
      </div>

      <div className="rounded-md border border-studio-edge bg-studio-surface p-5">
        <SectionHead title="Source" meta="read-only" />
        <div className="mt-4 grid gap-3">
          <SourceRow label="project" value={model.candidate.projectLabel} />
          <SourceRow label="parent" value={shortId(model.candidate.parentSessionId, 12)} />
          <SourceRow label="task" value={model.launch.taskId ?? "-"} />
          <SourceRow label="cwd" value={compactPath(model.launch.cwd)} />
          <SourceRow label="script" value={compactPath(model.launch.scriptPath)} />
        </div>
      </div>
    </section>
  );
}

function JournalTimeline({
  journal,
  workers,
}: {
  journal: JournalEvent[];
  workers: WorkerNode[];
}) {
  const workerById = new Map(workers.map((worker) => [worker.id, worker]));
  return (
    <section className="rounded-md border border-studio-edge bg-studio-surface p-5">
      <SectionHead title="Journal timeline" meta={`${journal.length} events`} />
      <div className="mt-5 grid max-h-[640px] gap-2 overflow-auto pr-1">
        {journal.map((event) => {
          const worker = event.agentId ? workerById.get(event.agentId) : null;
          const result = event.type === "result";
          return (
            <div
              key={`${event.index}:${event.agentId ?? "event"}`}
              className="grid grid-cols-[34px_78px_minmax(0,1fr)] items-center gap-3 rounded border border-studio-edge bg-studio-canvas-alt px-3 py-2"
            >
              <span className="font-mono text-[10px] text-studio-ink-faint">
                {String(event.index + 1).padStart(2, "0")}
              </span>
              <span
                className={`inline-flex h-6 items-center justify-center rounded-sm border px-2 font-mono text-[9px] uppercase tracking-ch ${
                  result
                    ? "border-scout-accent/40 bg-scout-accent-soft text-scout-accent"
                    : "border-studio-edge-strong bg-studio-canvas text-studio-ink-faint"
                }`}
              >
                {event.type}
              </span>
              <div className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-[10px] text-studio-ink-muted">
                    {shortId(event.agentId, 8)}
                  </span>
                  <span className="truncate text-[13px] text-studio-ink">
                    {worker?.label ?? event.key ?? "workflow event"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WorkerResults({ workers }: { workers: WorkerNode[] }) {
  const sorted = [...workers].sort((left, right) => {
    const scoreDelta = (right.score ?? -1) - (left.score ?? -1);
    if (scoreDelta !== 0) return scoreDelta;
    return right.findingCount - left.findingCount || left.shortId.localeCompare(right.shortId);
  });
  return (
    <section className="rounded-md border border-studio-edge bg-studio-surface p-5">
      <SectionHead title="Worker results" meta="ranked by score/items" />
      <div className="mt-5 grid max-h-[640px] gap-3 overflow-auto pr-1">
        {sorted.map((worker) => (
          <article key={worker.id} className="rounded border border-studio-edge bg-studio-canvas-alt p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
                  {worker.shortId} / {worker.kind}
                </div>
                <h3 className="mt-1 truncate font-display text-[17px] font-medium text-studio-ink">
                  {worker.label}
                </h3>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge
                  label={worker.score !== null ? `score ${worker.score}` : `${worker.findingCount} items`}
                  tone={worker.status === "completed" ? "ok" : "warn"}
                />
                <a
                  href={`#trace-${worker.shortId}`}
                  className="rounded-sm border border-studio-edge bg-studio-canvas px-2 py-1 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint transition hover:border-scout-accent/50 hover:text-studio-ink"
                >
                  trace ↓
                </a>
              </div>
            </div>
            {worker.output.length > 0 ? (
              <ul className="mt-3 grid gap-1.5">
                {worker.output.map((line) => (
                  <li key={line} className="text-[12.5px] leading-relaxed text-studio-ink-faint">
                    {line}
                  </li>
                ))}
              </ul>
            ) : worker.prompt ? (
              <p className="mt-3 text-[12.5px] leading-relaxed text-studio-ink-faint">
                {worker.prompt}
              </p>
            ) : null}
            <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-studio-edge pt-3">
              <Metric label="events" value={String(worker.eventCount)} />
              <Metric label="size" value={`${worker.sizeKb} KB`} />
              <Metric label="model" value={worker.model ? worker.model.replace(/^claude-/, "") : "-"} />
              <Metric label="latest" value={formatAgo(worker.latestAt)} />
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function SubagentTraces({ model }: { model: WorkflowModel }) {
  return (
    <section className="mt-6 rounded-md border border-studio-edge bg-studio-surface p-5">
      <SectionHead title="Subagent traces" meta="what each subagent did · execution order" />
      <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-studio-ink-faint">
        Each card stays tied to its node in the fan-out map and its rows in the journal. Expand a trace
        to read the transcript edges without leaving the run context.
      </p>
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {model.workers.map((worker) => (
          <TraceCard key={worker.id} worker={worker} />
        ))}
      </div>
    </section>
  );
}

function TraceCard({ worker }: { worker: WorkerNode }) {
  const accentClass =
    worker.status === "completed"
      ? "bg-scout-accent"
      : worker.status === "running"
        ? "bg-status-warn-fg"
        : "bg-studio-edge-strong";
  const journalSpan =
    worker.startedIndex !== null || worker.resultIndex !== null
      ? `${worker.startedIndex !== null ? `#${String(worker.startedIndex + 1).padStart(2, "0")}` : "--"} → ${
          worker.resultIndex !== null ? `#${String(worker.resultIndex + 1).padStart(2, "0")}` : "--"
        }`
      : "not in journal";

  return (
    <article
      id={`trace-${worker.shortId}`}
      className="scroll-mt-6 rounded-md border border-studio-edge bg-studio-canvas-alt p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
            <span className={`h-1.5 w-1.5 rounded-sm ${accentClass}`} />
            <span>{worker.shortId}</span>
            <span className="text-studio-edge-strong">/</span>
            <span>{worker.kind}</span>
            <span className="text-studio-edge-strong">/</span>
            <span>{worker.status}</span>
          </div>
          <h3 className="mt-1.5 truncate font-display text-[16px] font-medium text-studio-ink">
            {worker.label}
          </h3>
        </div>
        <StatusBadge
          label={worker.score !== null ? `score ${worker.score}` : `${worker.findingCount || worker.eventCount} ${worker.findingCount ? "items" : "events"}`}
          tone={worker.status === "completed" ? "ok" : "warn"}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="journal" value={journalSpan} />
        <Metric label="model" value={worker.model ? worker.model.replace(/^claude-/, "") : "-"} />
        <Metric label="window" value={`${formatTime(worker.trace.firstAt)}→${formatTime(worker.latestAt)}`} />
        <Metric label="events" value={`${worker.trace.totalEvents} / ${worker.sizeKb}KB`} />
      </dl>

      <TraceHistogram trace={worker.trace} />

      <div className="mt-3 grid gap-2">
        {worker.prompt ? (
          <TraceExcerpt label="task prompt" body={worker.prompt} />
        ) : null}
        {worker.output.length > 0 ? (
          <div className="rounded border border-studio-edge bg-studio-canvas px-3 py-2">
            <div className="font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">promoted result</div>
            <ul className="mt-1.5 grid gap-1">
              {worker.output.map((line) => (
                <li key={line} className="text-[12.5px] leading-relaxed text-studio-ink">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {worker.trace.finalText ? (
          <TraceExcerpt label="final message" body={worker.trace.finalText} muted />
        ) : null}
      </div>

      <details className="group mt-3 rounded border border-studio-edge bg-studio-canvas">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint transition hover:text-studio-ink">
          <span>transcript · {worker.trace.totalEvents} events</span>
          <span className="font-mono text-[10px] text-studio-ink-muted group-open:hidden">expand ↓</span>
          <span className="hidden font-mono text-[10px] text-studio-ink-muted group-open:inline">collapse ↑</span>
        </summary>
        <div className="border-t border-studio-edge px-3 py-3">
          <TranscriptStream trace={worker.trace} sourceFile={worker.sourceFile} />
        </div>
      </details>
    </article>
  );
}

function TraceExcerpt({ label, body, muted }: { label: string; body: string; muted?: boolean }) {
  return (
    <div className="rounded border border-studio-edge bg-studio-canvas px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">{label}</div>
      <p className={`mt-1.5 text-[12.5px] leading-relaxed ${muted ? "text-studio-ink-faint" : "text-studio-ink"}`}>
        {body}
      </p>
    </div>
  );
}

function TraceHistogram({ trace }: { trace: WorkerTrace }) {
  const typeEntries = Object.entries(trace.typeCounts).sort((left, right) => right[1] - left[1]);
  const toolEntries = Object.entries(trace.toolCounts).sort((left, right) => right[1] - left[1]).slice(0, 6);
  const maxTool = toolEntries.reduce((max, [, count]) => Math.max(max, count), 0);

  return (
    <div className="mt-3 rounded border border-studio-edge bg-studio-canvas px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-studio-ink-faint">
        <span className="text-[9px] uppercase tracking-ch">event mix</span>
        {typeEntries.map(([type, count]) => (
          <span key={type} className="text-studio-ink-muted">
            {type} <span className="text-studio-ink">{count}</span>
          </span>
        ))}
      </div>
      {toolEntries.length > 0 ? (
        <div className="mt-2 grid gap-1">
          {toolEntries.map(([tool, count]) => (
            <div key={tool} className="grid grid-cols-[88px_minmax(0,1fr)_28px] items-center gap-2">
              <span className="truncate font-mono text-[10px] text-studio-ink" title={tool}>{tool}</span>
              <span className="h-1.5 overflow-hidden rounded-sm bg-studio-canvas-alt">
                <span
                  className="block h-full rounded-sm bg-scout-accent/70"
                  style={{ width: `${maxTool ? Math.max(8, Math.round((count / maxTool) * 100)) : 0}%` }}
                />
              </span>
              <span className="text-right font-mono text-[10px] text-studio-ink-faint">{count}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 font-mono text-[10px] text-studio-ink-muted">no tool calls recorded</div>
      )}
    </div>
  );
}

function TranscriptStream({ trace, sourceFile }: { trace: WorkerTrace; sourceFile: string }) {
  const elided = Math.max(0, trace.totalEvents - trace.head.length - trace.tail.length);
  return (
    <div className="grid gap-1.5">
      <div className="font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
        {sourceFile}
      </div>
      {trace.head.map((event) => (
        <TraceEventRow key={`head-${event.index}`} event={event} />
      ))}
      {elided > 0 ? (
        <div className="py-1 text-center font-mono text-[9px] uppercase tracking-ch text-studio-ink-muted">
          ··· {elided} interior events elided ···
        </div>
      ) : null}
      {elided > 0
        ? trace.tail.map((event) => <TraceEventRow key={`tail-${event.index}`} event={event} />)
        : null}
    </div>
  );
}

function TraceEventRow({ event }: { event: TraceEvent }) {
  const tag = event.tool ?? event.role ?? event.type;
  const isTool = Boolean(event.tool);
  const main = isTool
    ? event.detail
      ? `${event.detail}`
      : event.text ?? ""
    : event.text ?? "";
  return (
    <div className="grid grid-cols-[26px_92px_minmax(0,1fr)_62px] items-center gap-2 rounded-sm border border-studio-edge bg-studio-canvas-alt px-2 py-1">
      <span className="font-mono text-[9px] text-studio-ink-muted">{String(event.index + 1).padStart(2, "0")}</span>
      <span
        className={`inline-flex h-5 items-center justify-center truncate rounded-sm border px-1.5 font-mono text-[8.5px] uppercase tracking-ch ${
          isTool
            ? "border-scout-accent/40 bg-scout-accent-soft text-scout-accent"
            : "border-studio-edge-strong bg-studio-canvas text-studio-ink-faint"
        }`}
        title={tag}
      >
        {tag}
      </span>
      <span className="truncate text-[11px] text-studio-ink-faint" title={main || undefined}>
        {main || (isTool ? "—" : event.type)}
      </span>
      <span className="text-right font-mono text-[9px] text-studio-ink-muted">{formatTime(event.at)}</span>
    </div>
  );
}

function ModelNotes({ model }: { model: WorkflowModel }) {
  const notes = [
    "The SVG fan-out map is useful for quickly seeing breadth, completion, and result concentration; nodes now jump to the matching trace card.",
    "The journal timeline is the clearest source of ordering; trace cards cite their journal indices instead of replaying the transcript.",
    "Subagent trace cards keep prompt, promoted result, final message, and an event histogram in context; the raw transcript stays one disclosure away.",
    "For production, this wants a workflow detail route backed by the existing observed topology reader, reusing this trace card shape.",
  ];
  return (
    <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="rounded-md border border-studio-edge bg-studio-surface p-5">
        <SectionHead title="Visualization read" meta="from this run" />
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <Metric label="review workers" value={String(model.workers.filter((worker) => worker.kind === "review").length)} />
          <Metric label="verifiers" value={String(model.workers.filter((worker) => worker.kind === "verification").length)} />
          <Metric label="synthesis" value={String(model.workers.filter((worker) => worker.kind === "synthesis").length)} />
          <Metric label="files read" value={String(model.workers.reduce((sum, worker) => sum + worker.sizeKb, 0)) + " KB"} />
        </dl>
      </div>
      <ListPanel title="Next UI moves" items={notes} />
    </section>
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
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 border-t border-studio-edge py-2 first:border-t-0 first:pt-0">
      <span className="font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
        {label}
      </span>
      <span className="truncate font-mono text-[10px] text-studio-ink-muted" title={value}>
        {value}
      </span>
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "neutral";
}) {
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

function ListPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface p-5">
      <SectionHead title={title} meta={`${items.length} notes`} />
      <ul className="mt-5 grid gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="grid grid-cols-[10px_minmax(0,1fr)] gap-3 rounded border border-studio-edge bg-studio-canvas-alt px-3 py-2"
          >
            <span className="mt-[7px] h-1.5 w-1.5 rounded-sm bg-scout-accent" />
            <span className="text-[13px] leading-relaxed text-studio-ink-faint">
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
