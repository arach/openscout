import type { InventoryResult } from "@/lib/inventory";
import { runCommand, type CommandRun } from "@/lib/studio/command";
import { inventoryCommand } from "@/lib/studio/commands/inventory";
import {
  parseSessionCommand,
  type NormalizedKind,
  type NormalizedRecord,
  type ParseSessionResult,
} from "@/lib/studio/commands/parse-session";
import { CommandSurface } from "@/components/studio/CommandSurface";

type Harness = "Codex" | "Claude";
type Tier = "large" | "normal" | "small";
type StageId =
  | "discover"
  | "normalize"
  | "extract"
  | "index"
  | "query"
  | "drilldown";

interface SessionSample {
  id: string;
  harness: Harness;
  tier: Tier;
  sizeBytes: number;
  events: number;
  modified: string;
  displayPath: string;
  fullPath: string;
  focus: string;
  codeArea: string;
}

interface Stage {
  id: StageId;
  label: string;
  verb: string;
  input: string;
  output: string;
  summary: string;
}

interface ProducedFile {
  name: string;
  kind: string;
  bytes: number;
  refs: string;
}

interface SearchHit {
  title: string;
  source: string;
  score: string;
  snippet: string;
}

interface PageProps {
  searchParams: Promise<{
    artifact?: string;
    q?: string;
    session?: string;
    step?: string;
  }>;
}

interface StudySelection {
  artifactName: string;
  query: string;
  sessionId: string;
  stageId: StageId;
}

const SESSIONS: SessionSample[] = [
  {
    id: "codex-large",
    harness: "Codex",
    tier: "large",
    sizeBytes: 13_623_669,
    events: 4_220,
    modified: "2026-05-29 23:29",
    displayPath: "~/.codex/sessions/2026/05/29/...019e75fd-a431...jsonl",
    fullPath:
      "/Users/arach/.codex/sessions/2026/05/29/rollout-2026-05-29T19-06-57-019e75fd-a431-76c3-82f1-8b61e94f613a.jsonl",
    focus: "large Codex context with many tool calls and iterative UI work",
    codeArea: "packages/web/client and design/studio",
  },
  {
    id: "codex-normal",
    harness: "Codex",
    tier: "normal",
    sizeBytes: 1_154_910,
    events: 494,
    modified: "2026-05-25 15:45",
    displayPath: "~/.codex/sessions/2026/05/25/...019e609c-4389...jsonl",
    fullPath:
      "/Users/arach/.codex/sessions/2026/05/25/rollout-2026-05-25T15-28-34-019e609c-4389-70e3-9fa1-9dedeea99410.jsonl",
    focus: "normal Codex edit pass with a bounded implementation surface",
    codeArea: "packages/runtime and protocol integration",
  },
  {
    id: "codex-small",
    harness: "Codex",
    tier: "small",
    sizeBytes: 34_921,
    events: 12,
    modified: "2026-05-29 00:16",
    displayPath: "~/.codex/sessions/2026/05/29/...019e71f2-958c...jsonl",
    fullPath:
      "/Users/arach/.codex/sessions/2026/05/29/rollout-2026-05-29T00-16-24-019e71f2-958c-7943-bc24-a1c2214f8b7a.jsonl",
    focus: "tiny Codex clarification thread",
    codeArea: "planning notes and command checks",
  },
  {
    id: "claude-large",
    harness: "Claude",
    tier: "large",
    sizeBytes: 55_431_537,
    events: 12_009,
    modified: "2026-05-26 02:49",
    displayPath: "~/.claude/projects/-Users-arach-dev-openscout/a00198bf...jsonl",
    fullPath:
      "/Users/arach/.claude/projects/-Users-arach-dev-openscout/a00198bf-0a6f-4011-a35b-8cc35f391868.jsonl",
    focus: "very large Claude project session with broad OpenScout context",
    codeArea: "apps/macos, packages/web, packages/runtime",
  },
  {
    id: "claude-normal",
    harness: "Claude",
    tier: "normal",
    sizeBytes: 762_408,
    events: 252,
    modified: "2026-05-23 13:11",
    displayPath: "~/.claude/projects/-Users-arach-dev-openscout/c680a795...jsonl",
    fullPath:
      "/Users/arach/.claude/projects/-Users-arach-dev-openscout/c680a795-dfc5-4d76-9a49-51b782c6a7dc.jsonl",
    focus: "normal Claude session around a focused implementation slice",
    codeArea: "docs and package-level implementation notes",
  },
  {
    id: "claude-small",
    harness: "Claude",
    tier: "small",
    sizeBytes: 2_124,
    events: 5,
    modified: "2026-05-24 21:57",
    displayPath: "~/.claude/projects/-Users-arach-dev-contextual/ada6d81e...jsonl",
    fullPath:
      "/Users/arach/.claude/projects/-Users-arach-dev-contextual/ada6d81e-bc86-44d9-9421-564768edc650.jsonl",
    focus: "micro Claude session with almost no processing pressure",
    codeArea: "contextual scratch material",
  },
];

const STAGES: Stage[] = [
  {
    id: "discover",
    label: "Discover",
    verb: "inventory",
    input: "raw harness JSONL",
    output: "session manifest",
    summary:
      "Scan local harness directories. Capture path, size, event count, mtime, and a stable session id without parsing payloads.",
  },
  {
    id: "normalize",
    label: "Normalize",
    verb: "shape",
    input: "events and tool payloads",
    output: "stable event records",
    summary:
      "Parse JSONL into a uniform event model so downstream code sees the same record shape regardless of harness.",
  },
  {
    id: "extract",
    label: "Extract",
    verb: "derive",
    input: "normalized records",
    output: "QMD-style markdown files",
    summary:
      "Write a small sidecar corpus per session: overview, decisions, files, tool calls, and event windows with source refs.",
  },
  {
    id: "index",
    label: "Index",
    verb: "compile",
    input: "derived markdown",
    output: "fuzzy and FTS rows",
    summary:
      "Compile the derived corpus into local SQLite tables. The index is rebuildable and smaller than a transcript copy.",
  },
  {
    id: "query",
    label: "Query",
    verb: "rank",
    input: "operator question",
    output: "answerable hits",
    summary:
      "Ask the derived corpus first. The LLM sees compact retrieved evidence instead of the full raw session.",
  },
  {
    id: "drilldown",
    label: "Drilldown",
    verb: "anchor",
    input: "source refs",
    output: "raw log coordinates",
    summary:
      "Follow a qmd source ref back to the raw JSONL path and event window when the answer needs ground-truth evidence.",
  },
];

const SAMPLE_QUERIES = [
  "which session touched OpenScout search?",
  "what were the unresolved decisions?",
  "raw log drilldown for this area",
  "what codebase area was I working in?",
];

const DOC_HREF = "/eng/sco-059-session-knowledge-search-exploration";

export default async function SessionSearchStudyPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const requestedSession = params.session ?? SESSIONS[0]!.id;
  const requestedStage = params.step ?? "extract";
  const selectedSession =
    SESSIONS.find((session) => session.id === requestedSession) ?? SESSIONS[0]!;
  const stageId = isStageId(requestedStage) ? requestedStage : "extract";
  const stageIndex = STAGES.findIndex((s) => s.id === stageId);
  const selectedStage = STAGES[stageIndex]!;
  const prevStage = stageIndex > 0 ? STAGES[stageIndex - 1] : undefined;
  const nextStage = stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1] : undefined;
  const producedFiles = buildProducedFiles(selectedSession);

  const selectedArtifact =
    producedFiles.find((file) => file.name === params.artifact) ??
    producedFiles[0]!;

  const query = params.q ?? SAMPLE_QUERIES[0]!;
  const queryResult = buildQueryResult(selectedSession, query);
  const selection: StudySelection = {
    artifactName: selectedArtifact.name,
    query,
    sessionId: selectedSession.id,
    stageId,
  };

  const inventoryRun = await runCommand(inventoryCommand, { since: "7d" });
  const inventory = inventoryRun.output;
  const weekFootprint = inventoryRun.error
    ? "scan failed"
    : `${formatCount(inventory.totalFiles)} files · ${formatBytes(inventory.totalBytes)} · ${inventory.windowDays} days`;

  return (
    <main className="mx-auto max-w-page px-7 py-8" data-testid="session-search-study">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-prose">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            studies / web / session-search
          </div>
          <h1 className="mt-1.5 font-display text-[22px] font-medium leading-tight tracking-tight text-studio-ink">
            Session search workbench
          </h1>
          <p className="mt-1.5 font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
            Walk a real harness session through the preparation pipeline. Each
            step explains itself and shows what it produces against the chosen
            input.
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-studio-ink-faint">
          <span>
            this week · <span className="text-studio-ink">{weekFootprint}</span>
            <span className="ml-1.5 text-studio-ink-faint/70">
              ({inventory.cached ? "cached" : `${inventory.durationMs} ms`})
            </span>
          </span>
          <span className="text-studio-edge-strong">·</span>
          <a
            href={DOC_HREF}
            className="inline-flex items-center gap-1.5 text-studio-ink hover:text-[color:var(--scout-accent)]"
          >
            SCO-059 <span aria-hidden>→</span>
          </a>
        </div>
      </header>

      {/* ── Session picker row ────────────────────────────────────── */}
      <SessionPickerRow
        sessions={SESSIONS}
        selectedId={selectedSession.id}
        selection={selection}
      />

      {/* ── Pipeline + active step panel ─────────────────────────── */}
      <div className="mt-4 overflow-hidden rounded-md border border-studio-edge bg-studio-surface">
        <PipelineStrip
          stages={STAGES}
          activeStage={stageId}
          session={selectedSession}
          selection={selection}
        />

        <StageHeader
          index={stageIndex}
          total={STAGES.length}
          stage={selectedStage}
          session={selectedSession}
          selection={selection}
          prev={prevStage}
          next={nextStage}
        />

        <StagePanel
          stage={selectedStage}
          session={selectedSession}
          selection={selection}
          producedFiles={producedFiles}
          selectedArtifact={selectedArtifact}
          query={query}
          queryResult={queryResult}
          inventoryRun={inventoryRun}
        />
      </div>

      {/* ── Week budget footer (compact) ─────────────────────────── */}
      <WeekBudgetFooter />
    </main>
  );
}

// ── Session picker (single inline row) ───────────────────────────

function SessionPickerRow({
  sessions,
  selectedId,
  selection,
}: {
  sessions: SessionSample[];
  selectedId: string;
  selection: StudySelection;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-md border border-studio-edge bg-studio-surface">
      <div className="flex items-stretch gap-px overflow-x-auto bg-studio-edge">
        <div className="flex shrink-0 items-center bg-studio-canvas-alt px-3.5 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          input
        </div>
        {sessions.map((session) => {
          const active = session.id === selectedId;
          return (
            <a
              key={session.id}
              href={studyHref(selection, {
                sessionId: session.id,
                artifactName: "overview.md",
              })}
              data-testid={`session-pill-${session.id}`}
              aria-current={active ? "true" : undefined}
              className={[
                "group flex shrink-0 items-center gap-2 px-3 py-2 transition-colors",
                active
                  ? "bg-scout-accent-soft"
                  : "bg-studio-surface hover:bg-studio-canvas-alt",
              ].join(" ")}
            >
              <TierDot tier={session.tier} />
              <span
                className={[
                  "font-mono text-[10.5px]",
                  active ? "text-studio-ink" : "text-studio-ink-faint group-hover:text-studio-ink",
                ].join(" ")}
              >
                {session.harness.toLowerCase()}/{session.tier}
              </span>
              <span className="font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
                {formatBytes(session.sizeBytes)}
              </span>
              <span className="hidden font-mono text-[9.5px] tabular-nums text-studio-ink-faint xl:inline">
                · {formatCount(session.events)} ev
              </span>
            </a>
          );
        })}
        <div className="ml-auto flex shrink-0 items-center bg-studio-surface px-3 font-mono text-[9.5px] text-studio-ink-faint">
          6 representative samples
        </div>
      </div>
    </div>
  );
}

function TierDot({ tier }: { tier: Tier }) {
  const cls: Record<Tier, string> = {
    large: "bg-status-error-fg",
    normal: "bg-status-info-fg",
    small: "bg-status-ok-fg",
  };
  return <span className={`h-2 w-2 rounded-full ${cls[tier]}`} aria-hidden />;
}

// ── Pipeline strip ───────────────────────────────────────────────

function PipelineStrip({
  stages,
  activeStage,
  session,
  selection,
}: {
  stages: Stage[];
  activeStage: StageId;
  session: SessionSample;
  selection: StudySelection;
}) {
  return (
    <div className="border-b border-studio-edge bg-studio-canvas-alt">
      <div className="flex items-stretch overflow-x-auto">
        <div className="flex shrink-0 items-center bg-studio-canvas-alt px-3.5 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          pipeline
        </div>
        {stages.map((stage, index) => {
          const active = stage.id === activeStage;
          const isLast = index === stages.length - 1;
          return (
            <div key={stage.id} className="flex flex-1 items-stretch">
              <a
                href={studyHref(selection, { stageId: stage.id })}
                data-testid={`stage-${stage.id}`}
                aria-current={active ? "true" : undefined}
                className={[
                  "group relative flex flex-1 items-center gap-2.5 px-3 py-2.5 transition-colors",
                  active
                    ? "bg-scout-accent-soft"
                    : "bg-studio-canvas-alt hover:bg-studio-surface",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] font-semibold",
                    active
                      ? "border-scout-accent bg-scout-accent text-[color:var(--studio-canvas)]"
                      : "border-studio-edge bg-studio-canvas text-studio-ink-faint",
                  ].join(" ")}
                  style={{ width: 18, height: 18 }}
                >
                  {index + 1}
                </span>
                <span
                  className={[
                    "font-sans text-[12px] font-semibold tracking-tight",
                    active ? "text-studio-ink" : "text-studio-ink-faint group-hover:text-studio-ink",
                  ].join(" ")}
                >
                  {stage.label}
                </span>
                <span className="hidden font-mono text-[9.5px] tabular-nums text-studio-ink-faint xl:inline">
                  {stageTiming(session, stage.id)}
                </span>
                {active ? (
                  <div className="absolute inset-x-0 bottom-0 h-[2px] bg-scout-accent" />
                ) : null}
              </a>
              {!isLast ? (
                <div
                  aria-hidden
                  className="flex w-4 shrink-0 items-center justify-center bg-studio-canvas-alt text-[11px] text-studio-ink-faint"
                >
                  →
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Active stage: title row with prev/next ────────────────────────

function StageHeader({
  index,
  total,
  stage,
  session,
  selection,
  prev,
  next,
}: {
  index: number;
  total: number;
  stage: Stage;
  session: SessionSample;
  selection: StudySelection;
  prev?: Stage;
  next?: Stage;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-studio-edge bg-studio-surface px-5 py-4">
      <div className="min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          step {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")} · {stage.verb}
        </div>
        <h2 className="mt-1 flex flex-wrap items-baseline gap-2 font-sans text-[16px] font-semibold tracking-tight text-studio-ink">
          {stage.label}
          <span className="font-mono text-[11px] font-normal text-studio-ink-faint">
            {stage.input} <span aria-hidden>→</span> {stage.output}
          </span>
        </h2>
        <p className="mt-1.5 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          {stage.summary}
        </p>
      </div>
      <div className="flex items-center gap-2 font-mono text-[10px]">
        {prev ? (
          <a
            href={studyHref(selection, { stageId: prev.id })}
            className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-studio-edge bg-studio-canvas-alt px-2.5 text-studio-ink-faint transition-colors hover:border-studio-edge-strong hover:text-studio-ink"
          >
            <span aria-hidden>←</span> {prev.label}
          </a>
        ) : (
          <span className="inline-flex h-8 items-center px-2.5 text-studio-ink-faint/40">
            <span aria-hidden>←</span> start
          </span>
        )}
        {next ? (
          <a
            href={studyHref(selection, { stageId: next.id })}
            className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-scout-accent bg-scout-accent-soft px-2.5 text-studio-ink transition-colors hover:border-studio-edge-strong"
          >
            {next.label} <span aria-hidden>→</span>
          </a>
        ) : (
          <span className="inline-flex h-8 items-center px-2.5 text-studio-ink-faint/40">
            end <span aria-hidden>→</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── Stage-specific panel content ─────────────────────────────────

function StagePanel({
  stage,
  session,
  selection,
  producedFiles,
  selectedArtifact,
  query,
  queryResult,
  inventoryRun,
}: {
  stage: Stage;
  session: SessionSample;
  selection: StudySelection;
  producedFiles: ProducedFile[];
  selectedArtifact: ProducedFile;
  query: string;
  queryResult: ReturnType<typeof buildQueryResult>;
  inventoryRun: CommandRun<InventoryResult>;
}) {
  switch (stage.id) {
    case "discover":
      return <DiscoverPanel session={session} inventoryRun={inventoryRun} />;
    case "normalize":
      return <NormalizePanel session={session} />;
    case "extract":
      return (
        <ExtractPanel
          session={session}
          selection={selection}
          producedFiles={producedFiles}
          selectedArtifact={selectedArtifact}
        />
      );
    case "index":
      return (
        <IndexPanel
          session={session}
          selectedArtifact={selectedArtifact}
        />
      );
    case "query":
      return (
        <QueryPanel
          session={session}
          selection={selection}
          query={query}
          result={queryResult}
        />
      );
    case "drilldown":
      return <DrilldownPanel session={session} selection={selection} />;
  }
}

// ── Stage panels ─────────────────────────────────────────────────

function DiscoverPanel({
  session,
  inventoryRun,
}: {
  session: SessionSample;
  inventoryRun: CommandRun<InventoryResult>;
}) {
  const inventory = inventoryRun.output;
  return (
    <div className="p-5">
      <CommandSurface
        shell={inventoryCommand.shell({ since: "7d" })}
        run={{
          durationMs: inventory?.durationMs ?? inventoryRun.durationMs,
          cached: inventory?.cached ?? inventoryRun.cached,
          error: inventoryRun.error ?? inventory?.error,
        }}
        body={<InventoryRowsBody inventory={inventory} session={session} />}
        footnote={
          inventory && !inventory.error ? (
            <>
              Filesystem-only — size, mtime, line count. The{" "}
              <span className="text-studio-ink">events</span> column is a real{" "}
              <code className="font-mono text-[11px] text-studio-ink">wc -l</code>{" "}
              on the {inventory.rows.length} most-recent files.{" "}
              Selected for walkthrough:{" "}
              <span className="font-mono text-[11px] text-studio-ink">
                {qmdSlug(session)}
              </span>
              .
            </>
          ) : null
        }
      />
    </div>
  );
}

function InventoryRowsBody({
  inventory,
  session: _session,
}: {
  inventory: InventoryResult | undefined;
  session: SessionSample;
}) {
  if (!inventory || inventory.error) {
    return (
      <pre className="px-3 py-2 font-mono text-[10.5px] text-studio-ink-faint">
        {inventory?.error ?? "no inventory available"}
      </pre>
    );
  }
  const harnessLabel: Record<string, string> = {
    codex: "codex",
    claude: "claude",
    "claude-subagent": "claude/sub",
  };
  const remaining = Math.max(0, inventory.totalFiles - inventory.rows.length);
  const remainingBytes = Math.max(
    0,
    inventory.totalBytes - inventory.rows.reduce((a, r) => a + r.sizeBytes, 0),
  );
  return (
    <div className="font-mono text-[10.5px]">
      <div className="grid grid-cols-[80px_minmax(0,1fr)_72px_60px_minmax(0,112px)] gap-3 border-b border-studio-edge px-3 py-1.5 text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span>harness</span>
        <span>session_id</span>
        <span className="text-right">size</span>
        <span className="text-right">events</span>
        <span className="text-right">modified</span>
      </div>
      <ul className="divide-y divide-studio-edge">
        {inventory.rows.map((row) => (
          <li
            key={row.path}
            className="grid grid-cols-[80px_minmax(0,1fr)_72px_60px_minmax(0,112px)] items-center gap-3 px-3 py-1.5"
          >
            <span className="text-studio-ink-faint">
              {harnessLabel[row.harness] ?? row.harness}
            </span>
            <span className="truncate text-studio-ink" title={row.displayPath}>
              {row.sessionId}
            </span>
            <span className="text-right tabular-nums text-studio-ink">
              {formatBytes(row.sizeBytes)}
            </span>
            <span className="text-right tabular-nums text-studio-ink">
              {row.events != null ? formatCount(row.events) : "—"}
            </span>
            <span className="text-right text-[10px] text-studio-ink-faint">
              {row.modified}
            </span>
          </li>
        ))}
        {remaining > 0 ? (
          <li className="grid grid-cols-[80px_minmax(0,1fr)_72px_60px_minmax(0,112px)] items-center gap-3 px-3 py-1.5 italic text-[10px] text-studio-ink-faint">
            <span>…</span>
            <span>{formatCount(remaining)} more in window</span>
            <span className="text-right tabular-nums">{formatBytes(remainingBytes)}</span>
            <span className="text-right">—</span>
            <span className="text-right">{inventory.windowDays}d</span>
          </li>
        ) : null}
      </ul>
      <div className="grid grid-cols-[80px_minmax(0,1fr)_72px_60px_minmax(0,112px)] gap-3 border-t border-studio-edge px-3 py-1.5 tabular-nums text-studio-ink">
        <span className="font-semibold">total</span>
        <span className="text-studio-ink-faint">
          across {inventory.byHarness.filter((b) => b.files > 0).length} harnesses
        </span>
        <span className="text-right">{formatBytes(inventory.totalBytes)}</span>
        <span className="text-right text-studio-ink-faint">—</span>
        <span className="text-right text-studio-ink-faint">{inventory.windowDays}d</span>
      </div>
    </div>
  );
}

async function NormalizePanel({ session }: { session: SessionSample }) {
  const limit = 14;
  const run = await runCommand(parseSessionCommand, {
    path: session.fullPath,
    limit,
  });
  const more = Math.max(0, session.events - (run.output?.records.length ?? 0));
  return (
    <div className="p-5">
      <CommandSurface
        shell={parseSessionCommand.shell({ path: session.fullPath, limit })}
        run={run}
        body={
          <NormalizedStreamBody result={run.output} moreCount={more} />
        }
        footnote={
          run.output && !run.output.error ? (
            <>
              Read the first {run.output.scannedLines} lines from the real{" "}
              <code className="font-mono text-[11px] text-studio-ink">
                {session.harness}/{session.tier}
              </code>{" "}
              JSONL ({formatBytes(run.output.bytesRead)}). Every downstream
              stage reads this uniform record shape regardless of source
              harness.
            </>
          ) : null
        }
      />
    </div>
  );
}

const NORMALIZED_KIND_TONE: Record<NormalizedKind, string> = {
  session_meta: "text-studio-ink-faint",
  user_turn: "text-status-info-fg",
  assistant_turn: "text-studio-ink",
  command_or_tool: "text-status-warn-fg",
  observation: "text-status-ok-fg",
  system_record: "text-studio-ink-faint",
  unknown: "text-status-error-fg",
};

function NormalizedStreamBody({
  result,
  moreCount,
}: {
  result: ParseSessionResult | undefined;
  moreCount: number;
}) {
  if (!result || result.error) {
    return (
      <pre className="px-3 py-2 font-mono text-[10.5px] text-studio-ink-faint">
        {result?.error ?? "no parse result"}
      </pre>
    );
  }
  return (
    <div className="font-mono text-[10.5px]">
      <div className="grid grid-cols-[40px_148px_72px_minmax(0,1fr)] gap-3 border-b border-studio-edge px-3 py-1.5 text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span>idx</span>
        <span>kind</span>
        <span>tag</span>
        <span>detail</span>
      </div>
      <ul className="divide-y divide-studio-edge">
        {result.records.map((r) => (
          <NormalizedRow key={r.i} record={r} />
        ))}
        {moreCount > 0 ? (
          <li className="grid grid-cols-[40px_148px_72px_minmax(0,1fr)] items-baseline gap-3 px-3 py-1.5 italic text-[10px] text-studio-ink-faint">
            <span>…</span>
            <span>{formatCount(moreCount)} more</span>
            <span>—</span>
            <span>source-ordered</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function NormalizedRow({ record }: { record: NormalizedRecord }) {
  return (
    <li className="grid grid-cols-[40px_148px_72px_minmax(0,1fr)] items-baseline gap-3 px-3 py-1.5">
      <span className="tabular-nums text-studio-ink-faint">
        [{String(record.i).padStart(3, "0")}]
      </span>
      <span className={NORMALIZED_KIND_TONE[record.kind]}>{record.kind}</span>
      <span className="truncate text-studio-ink-faint" title={record.sourceType}>
        {record.tag ?? record.sourceType}
      </span>
      <span className="truncate text-studio-ink" title={record.detail}>
        {record.detail}
      </span>
    </li>
  );
}

function ExtractPanel({
  session,
  selection,
  producedFiles,
  selectedArtifact,
}: {
  session: SessionSample;
  selection: StudySelection;
  producedFiles: ProducedFile[];
  selectedArtifact: ProducedFile;
}) {
  return (
    <PanelGrid
      leftLabel={`${producedFiles.length} derived files · ${formatBytes(estimateDerivedBytes(session))}`}
      left={
        <ul className="divide-y divide-studio-edge -mx-5">
          {producedFiles.map((file) => {
            const active = file.name === selectedArtifact.name;
            return (
              <li key={file.name}>
                <a
                  href={studyHref(selection, { artifactName: file.name })}
                  data-testid={`artifact-${artifactTestId(file.name)}`}
                  aria-current={active ? "true" : undefined}
                  className={[
                    "grid w-full grid-cols-[minmax(0,1fr)_60px] gap-3 px-5 py-2.5 text-left transition-colors",
                    active
                      ? "bg-scout-accent-soft shadow-[inset_2px_0_0_var(--scout-accent)]"
                      : "hover:bg-studio-canvas-alt",
                  ].join(" ")}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[11px] text-studio-ink">
                      {file.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
                      {file.kind} · {file.refs}
                    </span>
                  </span>
                  <span className="text-right font-mono text-[10px] tabular-nums text-studio-ink-faint">
                    {formatBytes(file.bytes)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      }
      rightLabel={`preview · ${selectedArtifact.name}`}
      right={<CodeBlock content={artifactPreview(session, selectedArtifact)} maxHeight={360} />}
    />
  );
}

function IndexPanel({
  session,
  selectedArtifact,
}: {
  session: SessionSample;
  selectedArtifact: ProducedFile;
}) {
  const indexBytes = estimateIndexBytes(session);
  const rows = databaseRows(session, selectedArtifact, indexBytes);
  return (
    <PanelGrid
      leftLabel="local sqlite · 5 tables touched"
      left={
        <ul className="divide-y divide-studio-edge -mx-5">
          {rows.map((row) => (
            <li key={`${row.table}-${row.key}`} className="px-5 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
                  {row.table}
                </span>
                <span className="font-mono text-[9px] text-studio-ink-faint">
                  {row.ref}
                </span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-studio-ink">{row.key}</div>
              <div className="mt-0.5 font-sans text-[12px] leading-snug text-studio-ink-faint">
                {row.value}
              </div>
            </li>
          ))}
        </ul>
      }
      rightLabel="cli + budget"
      right={
        <div>
          <CliBlock
            lines={[
              "$ scout session index .scout/session-knowledge",
              `→ documents=6 logical groups`,
              `→ chunks=${estimateChunkCount(session)}`,
              `→ fts_bytes=${formatBytes(indexBytes)}`,
              "→ vectors=optional later",
              "→ transcripts=observed source only",
            ]}
          />
          <p className="mt-3 font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
            The index is rebuildable. Scout owns the rows; raw harness logs
            stay observed source material.
          </p>
        </div>
      }
    />
  );
}

function QueryPanel({
  session,
  selection,
  query,
  result,
}: {
  session: SessionSample;
  selection: StudySelection;
  query: string;
  result: ReturnType<typeof buildQueryResult>;
}) {
  return (
    <div className="p-5">
      <form action="/studies/session-search" method="get" className="block">
        <input type="hidden" name="session" value={selection.sessionId} />
        <input type="hidden" name="step" value={selection.stageId} />
        <input type="hidden" name="artifact" value={selection.artifactName} />
        <label className="block">
          <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            ask the {session.harness.toLowerCase()} {session.tier} corpus
          </span>
          <span className="flex gap-2">
            <input
              data-testid="session-query-input"
              name="q"
              defaultValue={query}
              className="h-10 min-w-0 flex-1 rounded-[4px] border border-studio-edge bg-studio-canvas px-3 font-sans text-[13px] text-studio-ink outline-none transition-colors placeholder:text-studio-ink-faint focus:border-scout-accent"
              placeholder="Ask the derived corpus"
            />
            <button
              type="submit"
              className="h-10 rounded-[4px] border border-scout-accent bg-scout-accent-soft px-3.5 font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink transition-colors hover:border-studio-edge-strong"
            >
              Run
            </button>
          </span>
        </label>
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SAMPLE_QUERIES.map((sample) => {
          const active = sample === query;
          return (
            <a
              key={sample}
              href={studyHref(selection, { query: sample })}
              data-testid="sample-query"
              className={[
                "rounded-full border px-2.5 py-0.5 font-mono text-[10px] transition-colors",
                active
                  ? "border-scout-accent bg-scout-accent-soft text-studio-ink"
                  : "border-studio-edge bg-studio-canvas-alt text-studio-ink-faint hover:border-studio-edge-strong hover:text-studio-ink",
              ].join(" ")}
            >
              {sample}
            </a>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-[4px] border border-studio-edge bg-studio-canvas-alt p-3.5">
          <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            assistant synthesis
          </div>
          <p className="mt-1.5 font-sans text-[13px] leading-relaxed text-studio-ink">
            {result.answer}
          </p>
        </div>
        <div>
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            ranked hits
          </div>
          <div className="space-y-2">
            {result.hits.map((hit) => (
              <article
                key={hit.source}
                className="rounded-[4px] border border-studio-edge bg-studio-canvas px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10.5px] text-studio-ink">
                    {hit.title}
                  </span>
                  <span className="font-mono text-[9px] text-status-ok-fg">
                    {hit.score}
                  </span>
                </div>
                <p className="mt-1 font-sans text-[12px] leading-snug text-studio-ink-faint">
                  {hit.snippet}
                </p>
                <code className="mt-1 block truncate font-mono text-[10px] text-studio-ink-muted">
                  {hit.source}
                </code>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DrilldownPanel({
  session,
  selection,
}: {
  session: SessionSample;
  selection: StudySelection;
}) {
  const slug = qmdSlug(session);
  const ref = `qmd://session-search/${slug}/events-001.md:44`;
  const excerpt = [
    "events-001.md (excerpt)",
    "",
    "## window 001",
    "043 assistant_turn source_event=143",
    "044 tool_call(name=apply_patch) source_event=144",
    "045 tool_result(ok=true) source_event=145",
    "",
    "raw://" + session.fullPath,
  ].join("\n");
  return (
    <PanelGrid
      leftLabel="source ref"
      left={
        <div className="space-y-3">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              ref
            </div>
            <div className="mt-1 break-all font-mono text-[11.5px] text-studio-ink">
              {ref}
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              resolves to
            </div>
            <div className="mt-1 break-all font-mono text-[11.5px] text-studio-ink">
              {session.fullPath}
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              purpose
            </div>
            <p className="mt-1 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
              Evidence, not bulk import. The raw transcript stays observed
              source material; only the qmd ref + event window come into
              Scout&apos;s view.
            </p>
          </div>
          <a
            href={studyHref(selection, { stageId: "query" })}
            className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-studio-edge bg-studio-canvas-alt px-2.5 font-mono text-[10px] text-studio-ink-faint transition-colors hover:border-studio-edge-strong hover:text-studio-ink"
          >
            <span aria-hidden>←</span> back to query
          </a>
        </div>
      }
      rightLabel="excerpt"
      right={<CodeBlock content={excerpt} />}
    />
  );
}

// ── Panel atoms ──────────────────────────────────────────────────

function PanelGrid({
  leftLabel,
  left,
  rightLabel,
  right,
}: {
  leftLabel: string;
  left: React.ReactNode;
  rightLabel: string;
  right: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-px bg-studio-edge lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="bg-studio-surface p-5">
        <PanelLabel>{leftLabel}</PanelLabel>
        <div className="mt-2.5">{left}</div>
      </div>
      <div className="bg-studio-canvas-alt p-5">
        <PanelLabel>{rightLabel}</PanelLabel>
        <div className="mt-2.5">{right}</div>
      </div>
    </div>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
      {children}
    </div>
  );
}

function CliBlock({ lines }: { lines: string[] }) {
  return (
    <pre className="overflow-x-auto rounded-[4px] border border-studio-edge bg-studio-canvas p-3 font-mono text-[10.5px] leading-relaxed text-studio-ink">
      {lines.join("\n")}
    </pre>
  );
}

function CommandRecipe({
  cmd,
  output,
  run = false,
}: {
  cmd: string;
  output: string[];
  run?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-[4px] border border-studio-edge bg-studio-canvas">
      <div className="flex items-center justify-between gap-3 border-b border-studio-edge bg-studio-canvas-alt px-3 py-1.5">
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          command
        </span>
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-status-ok-fg">
          {run ? "● ran" : "○ recipe"}
        </span>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-studio-ink">
        $ {cmd}
      </pre>
      <div className="border-t border-studio-edge bg-studio-canvas-alt px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        output
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-studio-ink">
        {output.join("\n")}
      </pre>
    </div>
  );
}

function CodeBlock({ content, maxHeight }: { content: string; maxHeight?: number }) {
  return (
    <pre
      className="overflow-auto rounded-[4px] border border-studio-edge bg-studio-canvas p-3 font-mono text-[10.5px] leading-relaxed text-studio-ink"
      style={maxHeight ? { maxHeight } : undefined}
    >
      {content}
    </pre>
  );
}

// ── Week budget footer ───────────────────────────────────────────

function WeekBudgetFooter() {
  return (
    <section className="mt-4 overflow-hidden rounded-md border border-studio-edge bg-studio-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-studio-edge px-4 py-2.5">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          heavy week · expected mechanical pass
        </div>
        <div className="font-mono text-[10px] text-studio-ink-faint">
          search starts before LLM enrichment completes
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-studio-edge md:grid-cols-4">
        <BudgetCell label="Inventory" value="1–5 s" detail="scan paths + mtimes" />
        <BudgetCell label="Mechanical docs" value="30–120 s" detail="25–100 MiB markdown" />
        <BudgetCell label="Fuzzy index" value="30–180 s" detail="75–300 MiB SQLite" />
        <BudgetCell label="LLM enrichment" value="10–60 m" detail="async + selective" />
      </div>
    </section>
  );
}

function BudgetCell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bg-studio-surface px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div className="mt-1.5 font-sans text-[15px] font-semibold tracking-tight text-studio-ink">
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[10px] text-studio-ink-faint">
        {detail}
      </div>
    </div>
  );
}

// ── Data helpers (unchanged) ──────────────────────────────────────

function buildProducedFiles(session: SessionSample): ProducedFile[] {
  const derived = estimateDerivedBytes(session);
  const windows = estimateEventWindows(session);
  return [
    {
      name: "manifest.json",
      kind: "metadata",
      bytes: Math.max(1_600, Math.round(derived * 0.03)),
      refs: "collection config",
    },
    {
      name: "overview.md",
      kind: "summary",
      bytes: Math.max(2_400, Math.round(derived * 0.18)),
      refs: "session-level",
    },
    {
      name: "decisions.md",
      kind: "summary",
      bytes: Math.max(1_800, Math.round(derived * 0.11)),
      refs: "decision refs",
    },
    {
      name: "files.md",
      kind: "catalog",
      bytes: Math.max(1_800, Math.round(derived * 0.13)),
      refs: "path refs",
    },
    {
      name: "tool-calls.md",
      kind: "catalog",
      bytes: Math.max(2_000, Math.round(derived * 0.15)),
      refs: "command refs",
    },
    {
      name:
        windows === 1
          ? "events-001.md"
          : `events-001..${String(windows).padStart(3, "0")}.md`,
      kind: "event windows",
      bytes: Math.max(3_200, Math.round(derived * 0.4)),
      refs: `${windows} windows`,
    },
  ];
}

function databaseRows(
  session: SessionSample,
  artifact: ProducedFile,
  indexBytes: number,
) {
  const slug = qmdSlug(session);
  const chunks = estimateChunkCount(session);
  return [
    {
      table: "collections",
      key: "session_search_samples",
      value: "Local derived knowledge collection for selected external transcripts.",
      ref: "root",
    },
    {
      table: "sessions",
      key: slug,
      value: `${session.harness} ${session.tier}, ${formatBytes(session.sizeBytes)}, ${formatCount(session.events)} source events.`,
      ref: "observed",
    },
    {
      table: "documents",
      key: artifact.name,
      value: `${artifact.kind}, ${formatBytes(artifact.bytes)}, derived from ${session.displayPath}.`,
      ref: "qmd doc",
    },
    {
      table: "chunks",
      key: `${chunks} searchable chunks`,
      value: "Chunk rows keep markdown offsets plus source JSONL coordinates for raw drilldown.",
      ref: "fts",
    },
    {
      table: "terms",
      key: formatBytes(indexBytes),
      value: "Rebuildable lexical/fuzzy index, not a second copy of the transcript.",
      ref: "local",
    },
  ];
}

function buildQueryResult(session: SessionSample, query: string) {
  const normalized = query.toLowerCase();
  const slug = qmdSlug(session);
  const wantsDecision = normalized.includes("decision") || normalized.includes("unresolved");
  const wantsRaw = normalized.includes("raw") || normalized.includes("drill");
  const wantsCode = normalized.includes("code") || normalized.includes("area") || normalized.includes("search");
  const answer = wantsDecision
    ? `${session.harness} ${session.tier} has a compact decision trail in decisions.md, with unresolved items linked back to event windows instead of summarized away.`
    : wantsRaw
      ? `The derived hit is enough to choose the session; the next hop is a source coordinate into ${session.displayPath}.`
      : wantsCode
        ? `This sample is indexed as work around ${session.codeArea}; files.md and overview.md are the cheap first-pass surfaces.`
        : `The fuzzy layer searches the derived ${session.harness} ${session.tier} corpus first, then keeps raw transcript access one click away.`;

  const hits: SearchHit[] = [
    {
      title: wantsDecision ? "decisions.md" : "overview.md",
      source: `qmd://session-search/${slug}/${wantsDecision ? "decisions.md" : "overview.md"}:12`,
      score: "BM25 0.91",
      snippet: wantsDecision
        ? "Open decisions, follow-ups, and ownerless questions extracted from the session."
        : `${session.focus}; indexed as ${formatTokenEstimate(session.sizeBytes)} of raw-token equivalent source.`,
    },
    {
      title: wantsCode ? "files.md" : "events-001.md",
      source: `qmd://session-search/${slug}/${wantsCode ? "files.md" : "events-001.md"}:44`,
      score: "BM25 0.78",
      snippet: wantsCode
        ? `Code area signal: ${session.codeArea}.`
        : "Event window preserves the original ordering and source refs for verification.",
    },
    {
      title: "manifest.json",
      source: `qmd://session-search/${slug}/manifest.json:1`,
      score: "BM25 0.62",
      snippet: "Collection metadata records the harness, path, event count, byte count, and extraction recipe.",
    },
  ];

  return { answer, hits };
}

function artifactPreview(session: SessionSample, file: ProducedFile): string {
  const slug = qmdSlug(session);
  if (file.name === "manifest.json") {
    return JSON.stringify(
      {
        id: slug,
        harness: session.harness,
        tier: session.tier,
        source: session.fullPath,
        bytes: session.sizeBytes,
        events: session.events,
        modified: session.modified,
        extraction: {
          recipe: "qmd-lite",
          eventWindowSize: 350,
          derivedBytes: estimateDerivedBytes(session),
          indexBytes: estimateIndexBytes(session),
        },
      },
      null,
      2,
    );
  }

  if (file.name === "overview.md") {
    return [
      `# ${session.harness} ${session.tier} session`,
      "",
      `source: ${session.displayPath}`,
      `events: ${formatCount(session.events)}`,
      `raw-token-eq: ${formatTokenEstimate(session.sizeBytes)}`,
      "",
      "## Working summary",
      `- ${session.focus}.`,
      `- Primary code area signal: ${session.codeArea}.`,
      "- Store policy: derived knowledge is Scout-owned; raw harness logs stay observed source material.",
      "",
      "## Source refs",
      `- qmd://session-search/${slug}/events-001.md:1`,
      `- raw://${session.fullPath}`,
    ].join("\n");
  }

  if (file.name === "decisions.md") {
    return [
      "# Decisions",
      "",
      "- Use a two-step memory path: QMD-style extraction first, fuzzy index second.",
      "- Keep the engineering doc static; put moving exploration in Studio studies.",
      "- Do not import external harness transcripts as Scout-owned messages.",
      "",
      "## Follow-ups",
      "- Decide which extraction recipe becomes the first real implementation target.",
      "- Measure LLM enrichment only after the mechanical pass is useful.",
    ].join("\n");
  }

  if (file.name === "files.md") {
    return [
      "# File and code area signals",
      "",
      `primary_area: ${session.codeArea}`,
      "",
      "| path | signal | source |",
      "| --- | --- | --- |",
      "| packages/web/client | product search surface | events-001.md:44 |",
      "| design/studio/app/studies | interactive study surface | events-002.md:18 |",
      "| docs/eng | durable engineering record | overview.md:21 |",
    ].join("\n");
  }

  if (file.name === "tool-calls.md") {
    return [
      "# Tool calls",
      "",
      "| command | reason | source |",
      "| --- | --- | --- |",
      "| rg | locate routes, docs, and prior study patterns | events-001.md:9 |",
      "| bun --cwd design/studio dev | preview the Studio study | events-002.md:4 |",
      "| browser verification | check layout and interactions | events-002.md:36 |",
      "",
      "Large sessions would have many more rows; this preview keeps the shape compact.",
    ].join("\n");
  }

  return [
    "# Event windows",
    "",
    `window_size: 350 events`,
    `windows: ${estimateEventWindows(session)}`,
    "",
    "## events-001.md",
    "001 user_request source_event=0",
    "002 assistant_update source_event=1",
    "003 tool_call source_event=2",
    "",
    "Each line keeps enough source coordinate data to reopen the raw JSONL excerpt.",
  ].join("\n");
}

function estimateDerivedBytes(session: SessionSample): number {
  return Math.max(8_192, Math.round(session.sizeBytes * 0.12));
}

function estimateIndexBytes(session: SessionSample): number {
  return Math.round(estimateDerivedBytes(session) * 3.2);
}

function estimateEventWindows(session: SessionSample): number {
  return Math.max(1, Math.ceil(session.events / 350));
}

function estimateChunkCount(session: SessionSample): number {
  return Math.max(3, Math.ceil(estimateDerivedBytes(session) / 2_400));
}

function stageTiming(session: SessionSample, stage: StageId): string {
  const sizeMiB = session.sizeBytes / 1024 / 1024;
  const sizeFactor = Math.max(0.2, sizeMiB);

  switch (stage) {
    case "discover":
      return sizeMiB > 20 ? "400–900 ms" : "80–350 ms";
    case "normalize":
      return secondsRange(sizeFactor * 0.8, sizeFactor * 1.7);
    case "extract":
      return secondsRange(sizeFactor * 1.2, sizeFactor * 2.6);
    case "index":
      return secondsRange(sizeFactor * 0.35, sizeFactor * 0.9);
    case "query":
      return "20–100 ms";
    case "drilldown":
      return "10–80 ms";
  }
}

function secondsRange(low: number, high: number): string {
  const lo = Math.max(0.1, low);
  const hi = Math.max(lo + 0.1, high);
  if (hi < 1) return "<1 s";
  if (hi < 10) return `${Math.round(lo)}–${Math.round(hi)} s`;
  return `${Math.round(lo)}–${Math.round(hi)} s`;
}

function isStageId(value: string): value is StageId {
  return STAGES.some((stage) => stage.id === value);
}

function studyHref(
  current: StudySelection,
  next: Partial<StudySelection>,
): string {
  const params = new URLSearchParams();
  params.set("session", next.sessionId ?? current.sessionId);
  params.set("step", next.stageId ?? current.stageId);
  params.set("artifact", next.artifactName ?? current.artifactName);
  params.set("q", next.query ?? current.query);
  return `/studies/session-search?${params.toString()}`;
}

function qmdSlug(session: SessionSample): string {
  return `${session.harness.toLowerCase()}-${session.tier}`;
}

function artifactTestId(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  }
  if (bytes >= 1024) {
    const value = bytes / 1024;
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)} KiB`;
  }
  return `${bytes} B`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatTokenEstimate(bytes: number): string {
  const tokens = Math.round(bytes / 4);
  if (tokens >= 1_000_000) return `~${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `~${Math.round(tokens / 1_000)}k`;
  return `~${tokens}`;
}
