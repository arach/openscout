import type { InventoryResult } from "@/lib/inventory";
import { runCommand, type CommandRun } from "@/lib/studio/command";
import { inventoryCommand } from "@/lib/studio/commands/inventory";
import {
  parseSessionCommand,
  type NormalizedKind,
  type NormalizedRecord,
  type ParseSessionResult,
} from "@/lib/studio/commands/parse-session";
import {
  extractQmdCommand,
  type ExtractQmdResult,
  type ExtractedFile,
} from "@/lib/studio/commands/extract-qmd";
import { CommandSurface } from "@/components/studio/CommandSurface";
import {
  makeRunLogEntry,
  summarizeRunLog,
  type RunLogEntry,
} from "@/lib/studio/run-log";

type Harness = "Codex" | "Claude";
type Tier = "large" | "normal" | "small";
type StageId = "discover" | "normalize" | "extract";

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

interface PageProps {
  searchParams: Promise<{
    session?: string;
    step?: string;
    /** Active artifact in the Extract panel preview. */
    artifact?: string;
  }>;
}

interface StudySelection {
  sessionId: string;
  stageId: StageId;
  artifact?: string;
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
    output: "QMD sidecar files",
    summary:
      "Mechanical pass writes files.md / tool-calls.md / events-NNN.md. LLM pass writes overview.md / decisions.md by summarizing the condensed transcript through MiniMax. Outputs land on disk under /tmp/scout-study/qmd/<session>/.",
  },
];

const DOC_HREF = "/eng/sco-059-session-knowledge-search-exploration";

export default async function SessionSearchStudyPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const requestedSession = params.session ?? SESSIONS[0]!.id;
  const requestedStage = params.step ?? "discover";
  const selectedSession =
    SESSIONS.find((session) => session.id === requestedSession) ?? SESSIONS[0]!;
  const stageId = isStageId(requestedStage) ? requestedStage : "discover";
  const stageIndex = STAGES.findIndex((s) => s.id === stageId);
  const selectedStage = STAGES[stageIndex]!;
  const prevStage = stageIndex > 0 ? STAGES[stageIndex - 1] : undefined;
  const nextStage = stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1] : undefined;
  const selection: StudySelection = {
    sessionId: selectedSession.id,
    stageId,
    artifact: params.artifact,
  };

  const inventoryRun = await runCommand(inventoryCommand, { since: "7d" });
  const inventory = inventoryRun.output;
  const weekFootprint = inventoryRun.error
    ? "scan failed"
    : `${formatCount(inventory.totalFiles)} files · ${formatBytes(inventory.totalBytes)} · ${inventory.windowDays} days`;

  // ── Orchestrate per-stage runs so the run summary footer can show what
  // ── happened underneath the current page render.
  const runLog: RunLogEntry[] = [
    makeRunLogEntry(inventoryCommand, inventoryRun),
  ];

  let normalizeRun: CommandRun<ParseSessionResult> | undefined;
  if (stageId === "normalize") {
    normalizeRun = await runCommand(parseSessionCommand, {
      path: selectedSession.fullPath,
      limit: 14,
    });
    runLog.push(makeRunLogEntry(parseSessionCommand, normalizeRun));
  }

  let extractRun: CommandRun<ExtractQmdResult> | undefined;
  if (stageId === "extract") {
    extractRun = await runCommand(extractQmdCommand, {
      path: selectedSession.fullPath,
      sessionId: `${selectedSession.harness.toLowerCase()}-${selectedSession.tier}`,
      recordLimit: 1500,
      withLlm: true,
    });
    runLog.push(
      makeRunLogEntry(extractQmdCommand, extractRun, (out) =>
        out?.llm
          ? {
              model: out.llm.model,
              promptTokens: out.llm.usage.promptTokens,
              completionTokens: out.llm.usage.completionTokens,
              reasoningTokens: out.llm.usage.reasoningTokens,
            }
          : undefined,
      ),
    );
  }

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
          inventoryRun={inventoryRun}
          normalizeRun={normalizeRun}
          extractRun={extractRun}
          selection={selection}
        />
      </div>

      <RunSummary entries={runLog} />

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
              href={studyHref(selection, { sessionId: session.id })}
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
  inventoryRun,
  normalizeRun,
  extractRun,
  selection,
}: {
  stage: Stage;
  session: SessionSample;
  inventoryRun: CommandRun<InventoryResult>;
  normalizeRun?: CommandRun<ParseSessionResult>;
  extractRun?: CommandRun<ExtractQmdResult>;
  selection: StudySelection;
}) {
  switch (stage.id) {
    case "discover":
      return <DiscoverPanel session={session} inventoryRun={inventoryRun} />;
    case "normalize":
      return <NormalizePanel session={session} run={normalizeRun!} />;
    case "extract":
      return (
        <ExtractPanel
          session={session}
          selection={selection}
          run={extractRun!}
        />
      );
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
                {session.harness.toLowerCase()}/{session.tier}
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

function NormalizePanel({
  session,
  run,
}: {
  session: SessionSample;
  run: CommandRun<ParseSessionResult>;
}) {
  const limit = 14;
  const records = run.output?.records ?? [];
  const more = Math.max(0, session.events - records.length);
  const inspectIndex = pickInspectIndex(records);
  return (
    <div className="space-y-4 p-5">
      <CommandSurface
        shell={parseSessionCommand.shell({ path: session.fullPath, limit })}
        run={run}
        body={<NormalizedStreamBody result={run.output} moreCount={more} />}
        footnote={
          run.output && !run.output.error ? (
            <>
              Parsed the first {run.output.scannedLines} JSONL lines (
              {formatBytes(run.output.bytesRead)}) from{" "}
              <code className="font-mono text-[11px] text-studio-ink">
                {run.output.harness}
              </code>
              . Normalization remaps the source schema to a uniform record
              shape:{" "}
              <code className="font-mono text-[11px] text-studio-ink">kind</code>,{" "}
              <code className="font-mono text-[11px] text-studio-ink">text</code>,{" "}
              <code className="font-mono text-[11px] text-studio-ink">tool</code>,{" "}
              <code className="font-mono text-[11px] text-studio-ink">result</code>,{" "}
              <code className="font-mono text-[11px] text-studio-ink">refs</code>,{" "}
              <code className="font-mono text-[11px] text-studio-ink">sourceOffset</code>.
            </>
          ) : null
        }
      />
      {inspectIndex != null && run.output ? (
        <NormalizeInspect
          raw={run.output.rawLines[inspectIndex] ?? ""}
          record={records[inspectIndex]!}
        />
      ) : null}
    </div>
  );
}

function pickInspectIndex(records: NormalizedRecord[]): number | undefined {
  const meaningful = records.findIndex(
    (r) => r.kind === "user_turn" || r.kind === "command_or_tool",
  );
  if (meaningful >= 0) return meaningful;
  return records.length > 0 ? 0 : undefined;
}

function NormalizeInspect({
  raw,
  record,
}: {
  raw: string;
  record: NormalizedRecord;
}) {
  return (
    <div className="overflow-hidden rounded-[4px] border border-studio-edge bg-studio-canvas">
      <div className="flex items-center justify-between gap-3 border-b border-studio-edge bg-studio-canvas-alt px-3 py-1.5">
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          inspect record [{String(record.i).padStart(3, "0")}] · {record.kind}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          source offset {record.sourceOffset}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-px bg-studio-edge md:grid-cols-2">
        <div className="bg-studio-canvas">
          <div className="border-b border-studio-edge px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            raw · {record.sourceType}
          </div>
          <pre className="max-h-[260px] overflow-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-studio-ink">
            {formatRaw(raw)}
          </pre>
        </div>
        <div className="bg-studio-canvas">
          <div className="border-b border-studio-edge px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            normalized record
          </div>
          <pre className="max-h-[260px] overflow-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-studio-ink">
            {JSON.stringify(stripUndefined(record), null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function formatRaw(raw: string): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function summarizeRecord(record: NormalizedRecord): string {
  if (record.text) return record.text;
  if (record.tool) {
    const input = trimDisplay(JSON.stringify(record.tool.input ?? {}), 60);
    return `name=${record.tool.name} input=${input}`;
  }
  if (record.result) {
    const out = typeof record.result.output === "string"
      ? record.result.output
      : JSON.stringify(record.result.output ?? "");
    return trimDisplay(out, 100);
  }
  if (record.meta) {
    const model = record.meta.model ?? record.meta.model_provider;
    const cwd = record.meta.cwd;
    if (model || cwd) return `model=${model ?? "?"} cwd=${trimDisplay(String(cwd ?? "?"), 50)}`;
    return trimDisplay(JSON.stringify(record.meta), 80);
  }
  return "";
}

function trimDisplay(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + "…" : oneLine;
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
  const detail = summarizeRecord(record);
  return (
    <li className="grid grid-cols-[40px_148px_72px_minmax(0,1fr)] items-baseline gap-3 px-3 py-1.5">
      <span className="tabular-nums text-studio-ink-faint">
        [{String(record.i).padStart(3, "0")}]
      </span>
      <span className={NORMALIZED_KIND_TONE[record.kind]}>{record.kind}</span>
      <span className="truncate text-studio-ink-faint" title={record.sourceType}>
        {record.tag ?? record.sourceType}
      </span>
      <span className="truncate text-studio-ink" title={detail}>
        {trimDisplay(detail, 200)}
      </span>
    </li>
  );
}

// ── Extract panel ────────────────────────────────────────────────

async function ExtractPanel({
  session,
  selection,
  run,
}: {
  session: SessionSample;
  selection: StudySelection;
  run: CommandRun<ExtractQmdResult>;
}) {
  const result = run.output;
  const files = result?.files ?? [];
  const selectedName = files.find((f) => f.name === selection.artifact)?.name
    ?? files.find((f) => f.name === "overview.md")?.name
    ?? files[0]?.name;
  const selected = files.find((f) => f.name === selectedName);
  const previewContent = selected ? await safeReadFile(selected.path) : "";

  return (
    <div className="space-y-4 p-5">
      <CommandSurface
        shell={extractQmdCommand.shell({
          path: session.fullPath,
          sessionId: `${session.harness.toLowerCase()}-${session.tier}`,
          withLlm: true,
        })}
        run={run}
        body={
          <ExtractBody
            result={result}
            selection={selection}
            files={files}
            selected={selected}
            previewContent={previewContent}
          />
        }
        footnote={
          result && !result.error ? (
            <>
              Wrote {files.length} files to{" "}
              <code className="font-mono text-[10.5px] text-studio-ink" title={result.outDir}>
                {shortenTmpPath(result.outDir)}
              </code>{" "}
              · mechanical {result.mechanicalMs} ms · llm {result.llmMs} ms
              {result.llm ? (
                <>
                  {" · "}model{" "}
                  <code className="font-mono text-[11px] text-studio-ink">
                    {result.llm.model}
                  </code>{" "}
                  · {result.llm.usage.promptTokens}+{result.llm.usage.completionTokens}t
                  ({result.llm.usage.reasoningTokens} reasoning)
                </>
              ) : null}
            </>
          ) : null
        }
      />
    </div>
  );
}

function shortenTmpPath(p: string): string {
  // macOS tmpdir is /var/folders/.../T/...; trim to a readable suffix.
  const m = p.match(/\/T\/(.+)$/);
  return m ? `$TMPDIR/${m[1]}` : p;
}

async function safeReadFile(p: string): Promise<string> {
  try {
    const { promises: fs } = await import("node:fs");
    const buf = await fs.readFile(p);
    const text = buf.toString("utf8");
    return text.length > 20_000 ? text.slice(0, 20_000) + "\n\n… (truncated)" : text;
  } catch (err) {
    return `(could not read: ${err instanceof Error ? err.message : String(err)})`;
  }
}

function ExtractBody({
  result,
  selection,
  files,
  selected,
  previewContent,
}: {
  result: ExtractQmdResult | undefined;
  selection: StudySelection;
  files: ExtractedFile[];
  selected: ExtractedFile | undefined;
  previewContent: string;
}) {
  if (!result || result.error) {
    return (
      <pre className="px-3 py-2 font-mono text-[10.5px] text-studio-ink-faint">
        {result?.error ?? "no extract result"}
      </pre>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-px bg-studio-edge md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <ul className="divide-y divide-studio-edge bg-studio-canvas font-mono text-[10.5px]">
        <li className="grid grid-cols-[40px_minmax(0,1fr)_64px] gap-2 border-b border-studio-edge px-3 py-1.5 text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          <span>kind</span>
          <span>file</span>
          <span className="text-right">bytes</span>
        </li>
        {files.map((f) => {
          const active = selected?.name === f.name;
          return (
            <li key={f.name}>
              <a
                href={studyHref(selection, { artifact: f.name })}
                aria-current={active ? "true" : undefined}
                className={[
                  "grid grid-cols-[40px_minmax(0,1fr)_64px] items-baseline gap-2 px-3 py-1.5 transition-colors",
                  active
                    ? "bg-scout-accent-soft shadow-[inset_2px_0_0_var(--scout-accent)]"
                    : "hover:bg-studio-canvas-alt",
                ].join(" ")}
              >
                <span
                  className={
                    f.kind === "llm"
                      ? "text-status-info-fg"
                      : "text-studio-ink-faint"
                  }
                >
                  {f.kind === "llm" ? "llm" : "mech"}
                </span>
                <span className="truncate text-studio-ink">{f.name}</span>
                <span className="text-right tabular-nums text-studio-ink-faint">
                  {formatBytes(f.bytes)}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <div className="bg-studio-canvas">
        <div className="border-b border-studio-edge px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          preview · {selected?.name ?? "—"}
        </div>
        <pre className="max-h-[420px] overflow-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-studio-ink">
          {previewContent || "(empty)"}
        </pre>
      </div>
    </div>
  );
}


function isStageId(value: string): value is StageId {
  return STAGES.some((stage) => stage.id === value);
}

// ── Run summary footer ───────────────────────────────────────────

function RunSummary({ entries }: { entries: RunLogEntry[] }) {
  const sum = summarizeRunLog(entries);
  return (
    <section className="mt-4 overflow-hidden rounded-md border border-studio-edge bg-studio-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-studio-edge px-4 py-2.5">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          run trace · what just happened
        </div>
        <div className="font-mono text-[10px] text-studio-ink-faint">
          {entries.length} command{entries.length === 1 ? "" : "s"} ·{" "}
          <span className="text-studio-ink">{sum.wallMs} ms this request</span>
          {sum.cached > 0 ? (
            <>
              {" · "}
              <span className="text-studio-ink-faint/80">
                {sum.cached} cached (saved ~{sum.uncachedMs - sum.wallMs} ms)
              </span>
            </>
          ) : null}
          {sum.llm.total > 0 ? (
            <>
              {" · "}
              <span className="text-status-info-fg">
                {sum.llm.total.toLocaleString()} llm tokens
              </span>
              {" · "}
              <span className="text-studio-ink">
                ~${sum.llm.estCostUsd.toFixed(4)}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <ul className="divide-y divide-studio-edge">
        {entries.map((e, i) => (
          <li
            key={`${e.id}-${i}`}
            className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,140px)] items-baseline gap-3 px-4 py-2"
          >
            <span className="font-mono text-[10px] tabular-nums text-studio-ink-faint">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="font-sans text-[12.5px] font-semibold tracking-tight text-studio-ink">
                {e.label}
              </span>
              <span className="font-mono text-[9.5px] text-studio-ink-faint">
                {e.id}
              </span>
            </span>
            <span className="font-mono text-[10.5px] text-studio-ink-faint">
              {e.error ? (
                <span className="text-status-error-fg">error · {e.error}</span>
              ) : e.cached ? (
                <span>
                  ● cached{" "}
                  <span className="text-studio-ink-faint/70">
                    (saved ~{e.durationMs} ms)
                  </span>
                </span>
              ) : (
                <span className="text-status-ok-fg">● ran · {e.durationMs} ms</span>
              )}
            </span>
            <span className="text-right font-mono text-[10px] text-studio-ink-faint">
              {e.llm ? (
                <>
                  <span className="text-studio-ink">{e.llm.model}</span> ·{" "}
                  {e.llm.promptTokens}+{e.llm.completionTokens}t
                  {e.llm.reasoningTokens > 0 ? (
                    <span className="text-studio-ink-faint/80">
                      {" "}
                      ({e.llm.reasoningTokens} reasoning)
                    </span>
                  ) : null}
                </>
              ) : (
                <span>—</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function studyHref(
  current: StudySelection,
  next: Partial<StudySelection>,
): string {
  const params = new URLSearchParams();
  params.set("session", next.sessionId ?? current.sessionId);
  params.set("step", next.stageId ?? current.stageId);
  const artifact = next.artifact ?? current.artifact;
  if (artifact) params.set("artifact", artifact);
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
