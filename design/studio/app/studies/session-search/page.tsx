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
import {
  enrichSessionCommand,
  type EnrichSessionResult,
  type EnrichedFile,
} from "@/lib/studio/commands/enrich-session";
import {
  indexCorpusCommand,
  type IndexCorpusResult,
} from "@/lib/studio/commands/index-corpus";
import {
  dbAskCommand,
  type AskHit,
  type AskResult,
} from "@/lib/studio/commands/inspect-db";
import path from "node:path";
import { tmpdir } from "node:os";
import { QueryForm } from "@/app/studies/data/QueryForm";
import { CommandSurface } from "@/components/studio/CommandSurface";
import {
  ArtifactPicker,
  type ArtifactPickerFile,
} from "@/components/studio/ArtifactPicker";
import { RerunLink } from "@/components/studio/RerunLink";
import {
  makeRunLogEntry,
  summarizeRunLog,
  type RunLogEntry,
} from "@/lib/studio/run-log";
import Link from "next/link";
import { Suspense } from "react";

type Harness = "Codex" | "Claude";
type Tier = "large" | "normal" | "small";
type StageId = "discover" | "normalize" | "extract" | "enrich" | "index" | "ask";

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
    /** Stage id whose command should bypass the cache for this request. */
    force?: string;
    /** Question for the Step 6 Ask field. */
    ask?: string;
  }>;
}

interface StudySelection {
  sessionId: string;
  stageId: StageId;
  artifact?: string;
  /**
   * What to force-rerun (bypassing cache):
   * - "all" — every command in the active pipeline
   * - a stage id ("discover" | "normalize" | "extract" | "enrich") — just that one
   */
  force?: string;
  /** Step 6 Ask question — preserved in the URL so refresh / re-run works. */
  ask?: string;
}

const FORCE_ALL = "all";

function shouldForce(force: string | undefined, stageId: StageId): boolean {
  return force === FORCE_ALL || force === stageId;
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
      "Emit files.md / tool-calls.md / events-NNN.md / manifest.json from the normalized records. Pure derivation, always fast. Outputs land at $TMPDIR/scout-study/qmd/<session>/.",
  },
  {
    id: "enrich",
    label: "Enrich",
    verb: "summarize",
    input: "condensed transcript",
    output: "overview.md + decisions.md (LLM)",
    summary:
      "One MiniMax-M2 call per session, cached for an hour. Reads the parsed records, condenses to a token-bounded transcript, asks the model for an overview + decisions doc, writes them next to the mechanical files.",
  },
  {
    id: "index",
    label: "Index",
    verb: "store",
    input: "qmd sidecar files",
    output: "sqlite tables + FTS5",
    summary:
      "Walks every $TMPDIR/scout-study/qmd/<session>/ directory, splits each markdown file into H2 sections, and writes rows into a real better-sqlite3 db at $TMPDIR/scout-study/index.db. Schema: sessions, documents, chunks, chunks_fts (FTS5 over chunks.text).",
  },
  {
    id: "ask",
    label: "Ask",
    verb: "converse",
    input: "natural-language question",
    output: "ranked chunks from the corpus",
    summary:
      "The agentic step. A question in plain English goes to MiniMax, which extracts FTS5 search terms; those terms run against chunks_fts and the top-ranked chunks come back with snippets. The pipeline's consumption surface lives in the Session DB Explorer.",
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
  const force = params.force
    ? params.force === FORCE_ALL || isStageId(params.force)
      ? params.force
      : undefined
    : undefined;
  const selection: StudySelection = {
    sessionId: selectedSession.id,
    stageId,
    artifact: params.artifact,
    force,
    ask: params.ask,
  };

  // Inventory is cheap and the page header needs its totals. Always run it
  // synchronously before sending chrome to the client.
  const inventoryRun = await runCommand(
    inventoryCommand,
    { since: "7d" },
    { force: shouldForce(force, "discover") },
  );
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
          <RerunLink
            href={studyHref(selection, { force: FORCE_ALL })}
            className="inline-flex items-center gap-1 text-studio-ink-faint underline-offset-4 hover:text-studio-ink hover:underline"
            title="Force re-run every command in the active pipeline"
            pendingLabel="running ↻"
          >
            re-run all ↻
          </RerunLink>
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

        <Suspense
          key={`${selectedSession.id}::${stageId}::${stageId === "ask" ? (selection.ask ?? "").trim() : ""}`}
          fallback={
            <StageBodySkeleton
              stageId={stageId}
              stageLabel={selectedStage.label}
            />
          }
        >
          <StageBody
            stage={selectedStage}
            session={selectedSession}
            selection={selection}
            inventoryRun={inventoryRun}
          />
        </Suspense>
      </div>

    </main>
  );
}

// ── Stage body (streams in after commands resolve) ───────────────

async function StageBody({
  stage,
  session,
  selection,
  inventoryRun,
}: {
  stage: Stage;
  session: SessionSample;
  selection: StudySelection;
  inventoryRun: CommandRun<InventoryResult>;
}) {
  const stageId = stage.id;
  const force = selection.force;
  const sessionSlug = `${session.harness.toLowerCase()}-${session.tier}`;
  const needsParse =
    stageId === "normalize" || stageId === "extract" || stageId === "enrich" || stageId === "index";
  const needsExtract =
    stageId === "extract" || stageId === "enrich" || stageId === "index";
  const needsEnrich = stageId === "enrich" || stageId === "index";

  const inventoryInput = { since: "7d" } as const;
  const runLog: RunLogEntry[] = [
    makeRunLogEntry(inventoryCommand, inventoryInput, inventoryRun, {
      summarizeInput: (i) => `since=${i.since}`,
      summarizeOutput: (o) =>
        o
          ? `${o.totalFiles} files · ${o.totalBytes} bytes · ${o.rows.length} rows w/ events`
          : "no result",
    }),
  ];

  let normalizeRun: CommandRun<ParseSessionResult> | undefined;
  if (needsParse) {
    const parseInput = { path: session.fullPath, limit: "all" as const };
    // One limit across normalize / extract / enrich so the parse cache is
    // shared. Older builds capped normalize at 14 records, which made the
    // force-rerun report meaningless timing (~20 ms over a 128 KB head read).
    normalizeRun = await runCommand(parseSessionCommand, parseInput, {
      force: shouldForce(force, "normalize"),
    });
    runLog.push(
      makeRunLogEntry(parseSessionCommand, parseInput, normalizeRun, {
        summarizeInput: (i) => `limit=${i.limit} · ${i.path.split("/").pop()}`,
        summarizeOutput: (o) =>
          o
            ? `harness=${o.harness} · ${o.records.length} records · ${o.bytesRead} bytes read`
            : "no result",
      }),
    );
  }

  let extractRun: CommandRun<ExtractQmdResult> | undefined;
  if (needsExtract) {
    const extractInput = {
      path: session.fullPath,
      sessionId: sessionSlug,
      recordLimit: "all" as const,
    };
    extractRun = await runCommand(extractQmdCommand, extractInput, {
      force: shouldForce(force, "extract"),
    });
    runLog.push(
      makeRunLogEntry(extractQmdCommand, extractInput, extractRun, {
        summarizeInput: (i) => `sessionId=${i.sessionId} · limit=${i.recordLimit}`,
        summarizeOutput: (o) =>
          o
            ? `${o.files.length} files · ${o.recordsScanned} records · ${o.mechanicalMs} ms mech`
            : "no result",
      }),
    );
  }

  let enrichRun: CommandRun<EnrichSessionResult> | undefined;
  if (needsEnrich) {
    const enrichInput = {
      path: session.fullPath,
      sessionId: sessionSlug,
      recordLimit: "all" as const,
    };
    enrichRun = await runCommand(enrichSessionCommand, enrichInput, {
      force: shouldForce(force, "enrich"),
    });
    runLog.push(
      makeRunLogEntry(enrichSessionCommand, enrichInput, enrichRun, {
        summarizeInput: (i) =>
          `sessionId=${i.sessionId} · limit=${i.recordLimit}`,
        summarizeOutput: (o) =>
          o && o.model
            ? `${o.model} · ${o.usage.totalTokens}t · ${o.files.length} files`
            : "no result",
        extractLlm: (out) =>
          out?.model
            ? {
                model: out.model,
                promptTokens: out.usage.promptTokens,
                completionTokens: out.usage.completionTokens,
                reasoningTokens: out.usage.reasoningTokens,
              }
            : undefined,
      }),
    );
  }

  let indexRun: CommandRun<IndexCorpusResult> | undefined;
  if (stageId === "index") {
    const indexInput = { sessionIds: [sessionSlug] };
    indexRun = await runCommand(indexCorpusCommand, indexInput, {
      force: shouldForce(force, "index"),
    });
    runLog.push(
      makeRunLogEntry(indexCorpusCommand, indexInput, indexRun, {
        summarizeInput: (i) =>
          i.sessionIds && i.sessionIds.length > 0
            ? `sessionIds=${i.sessionIds.join(",")}`
            : "sessionIds=all",
        summarizeOutput: (o) =>
          o
            ? `${o.sessions} sessions · ${o.documents} docs · ${o.chunks} chunks · ${o.ftsRows} fts rows · ${o.dbBytes} db bytes`
            : "no result",
      }),
    );
  }

  return (
    <>
      <StagePanel
        stage={stage}
        session={session}
        inventoryRun={inventoryRun}
        normalizeRun={normalizeRun}
        extractRun={extractRun}
        enrichRun={enrichRun}
        indexRun={indexRun}
        selection={selection}
      />
      <div className="border-t border-studio-edge">
        <RunSummary entries={runLog} selection={selection} />
      </div>
    </>
  );
}

function StageBodySkeleton({
  stageId,
  stageLabel,
}: {
  stageId: StageId;
  stageLabel: string;
}) {
  const expected = expectedCommands(stageId);
  return (
    <div className="p-5">
      <div className="overflow-hidden rounded-[4px] border border-studio-edge bg-studio-canvas">
        <div className="flex items-center justify-between gap-3 border-b border-studio-edge bg-studio-canvas-alt px-3 py-1.5">
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            running {stageLabel.toLowerCase()}
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-status-info-fg">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-status-info-fg" />
            in flight
          </span>
        </div>
        <ul className="divide-y divide-studio-edge font-mono text-[10.5px]">
          {expected.map((cmd, i) => (
            <li
              key={cmd.id}
              className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,200px)] items-center gap-3 px-3 py-2"
            >
              <span className="tabular-nums text-studio-ink-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-studio-ink">
                {cmd.label}
                <span className="ml-2 text-studio-ink-faint">{cmd.id}</span>
              </span>
              <span className="text-right text-studio-ink-faint">
                {cmd.eta}
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-studio-edge bg-studio-canvas-alt px-3 py-2 font-sans text-[11.5px] text-studio-ink-faint">
          Chrome rendered; panel and run trace stream in when commands resolve.
        </div>
      </div>
    </div>
  );
}

function expectedCommands(stageId: StageId): Array<{
  id: string;
  label: string;
  eta: string;
}> {
  const inv = { id: "inventory", label: "Inventory", eta: "cached if recent" };
  const parse = { id: "parse-session", label: "Parse session", eta: "~100 ms · cached" };
  const extract = {
    id: "extract-qmd",
    label: "Extract QMD",
    eta: "~ms · cached",
  };
  const enrich = {
    id: "enrich-session",
    label: "Enrich (LLM)",
    eta: "first run: 5–15 s",
  };
  const index = {
    id: "index-corpus",
    label: "Index corpus",
    eta: "first run: ~ms · cached",
  };
  const ask = {
    id: "db-ask",
    label: "Ask the data",
    eta: "LLM 1–6 s · FTS5 ~ms",
  };
  if (stageId === "discover") return [inv];
  if (stageId === "normalize") return [inv, parse];
  if (stageId === "extract") return [inv, parse, extract];
  if (stageId === "enrich") return [inv, parse, extract, enrich];
  if (stageId === "index") return [inv, parse, extract, enrich, index];
  return [inv, parse, extract, enrich, index, ask];
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
  enrichRun,
  indexRun,
  selection,
}: {
  stage: Stage;
  session: SessionSample;
  inventoryRun: CommandRun<InventoryResult>;
  normalizeRun?: CommandRun<ParseSessionResult>;
  extractRun?: CommandRun<ExtractQmdResult>;
  enrichRun?: CommandRun<EnrichSessionResult>;
  indexRun?: CommandRun<IndexCorpusResult>;
  selection: StudySelection;
}) {
  switch (stage.id) {
    case "discover":
      return <DiscoverPanel session={session} inventoryRun={inventoryRun} />;
    case "normalize":
      return (
        <NormalizePanel
          session={session}
          run={normalizeRun!}
          selection={selection}
        />
      );
    case "extract":
      return (
        <ExtractPanel
          session={session}
          selection={selection}
          run={extractRun!}
        />
      );
    case "enrich":
      return (
        <EnrichPanel
          session={session}
          selection={selection}
          run={enrichRun!}
        />
      );
    case "index":
      return <IndexPanel session={session} selection={selection} run={indexRun!} />;
    case "ask":
      return <AskPanel session={session} selection={selection} />;
  }
}

const ASK_DB_PATH = path.join(tmpdir(), "scout-study", "index.db");

const ASK_SUGGESTIONS: { label: string; question: string }[] = [
  { label: "Files edited", question: "what files did the agent edit?" },
  { label: "Decisions", question: "what decisions were made?" },
  { label: "Tools used", question: "what tools were used?" },
  { label: "Summary", question: "summarise the session" },
  { label: "User asks", question: "what did the user ask for?" },
];

async function AskPanel({
  session,
  selection,
}: {
  session: SessionSample;
  selection: StudySelection;
}) {
  const sessionSlug = `${session.harness.toLowerCase()}-${session.tier}`;
  const question = (selection.ask ?? "").toString();
  const trimmed = question.trim();
  const force = selection.force === "ask" || selection.force === FORCE_ALL;

  const run = await runCommand(
    dbAskCommand,
    { dbPath: ASK_DB_PATH, question },
    { force },
  );
  const out = run.output;
  const badge = run.error
    ? { label: "● error", tone: "text-status-error-fg" }
    : run.cached
      ? { label: "● cached", tone: "text-studio-ink-faint" }
      : { label: `● ran ${run.durationMs} ms`, tone: "text-status-ok-fg" };

  return (
    <div className="p-5">
      <div className="overflow-hidden rounded-[4px] border border-studio-edge bg-studio-canvas">
        <div className="flex items-center justify-between gap-3 border-b border-studio-edge bg-studio-canvas-alt px-3 py-1.5">
          <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink">
            <span className="text-studio-ink-faint">step 6 ·</span>
            <span>ask · {sessionSlug}</span>
          </span>
          <span className="flex items-center gap-2">
            {trimmed ? (
              <RerunLink
                href={studyHref(selection, { force: "ask" })}
                className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint underline-offset-4 hover:text-studio-ink hover:underline"
                title="Force re-run, bypassing the cache"
                pendingLabel="running ↻"
              >
                re-run ↻
              </RerunLink>
            ) : null}
            <span className={`font-mono text-[9px] uppercase tracking-eyebrow ${badge.tone}`}>
              {badge.label}
            </span>
          </span>
        </div>

        <QueryForm
          paramName="ask"
          basePath="/studies/session-search"
          defaultValue={question}
          placeholder="ask the indexed corpus — e.g. what files did the agent edit?"
          multiline
          submitLabel="ask ↻"
        />

        <div className="flex flex-wrap items-center gap-1.5 border-t border-studio-canvas-alt bg-studio-canvas-alt/40 px-3 py-2">
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            try ·
          </span>
          {ASK_SUGGESTIONS.map((s) => (
            <Link
              key={s.label}
              href={studyHref(selection, { ask: s.question, force: undefined })}
              scroll={false}
              title={s.question}
              className="rounded border border-studio-canvas-alt bg-studio-canvas px-2 py-0.5 font-mono text-[10px] text-studio-ink-faint hover:border-studio-edge hover:text-studio-ink"
            >
              {s.label}
            </Link>
          ))}
        </div>

        <div className="border-t border-studio-canvas-alt bg-studio-canvas-alt px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {trimmed
            ? `answer · ${out?.hits.length ?? 0} chunks`
            : "answer"}
        </div>

        {run.error ? (
          <pre className="overflow-x-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-status-error-fg">
            {run.error}
          </pre>
        ) : (
          <AskPanelBody result={out} hasQuestion={trimmed.length > 0} />
        )}

        <div className="border-t border-studio-canvas-alt bg-studio-canvas-alt px-3 py-2 font-sans text-[11.5px] leading-relaxed text-studio-ink-faint">
          {askPanelFootnote(out, trimmed.length > 0)}
        </div>

        <details className="border-t border-studio-canvas-alt bg-studio-canvas-alt/40 group">
          <summary className="cursor-pointer list-none px-3 py-1 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint hover:text-studio-ink">
            as shell ›
          </summary>
          <pre className="overflow-x-auto border-t border-studio-canvas-alt px-3 py-1.5 font-mono text-[10px] leading-relaxed text-studio-ink-faint">
            $ {dbAskCommand.shell({ dbPath: ASK_DB_PATH, question: trimmed || "<question>" })}
          </pre>
        </details>
      </div>
    </div>
  );
}

function AskPanelBody({
  result,
  hasQuestion,
}: {
  result: AskResult | undefined;
  hasQuestion: boolean;
}) {
  if (!hasQuestion) {
    return (
      <pre className="px-3 py-2 font-mono text-[11px] text-studio-ink-faint">
        Type a question above, or click a suggestion to load one.
      </pre>
    );
  }
  if (!result) return null;
  if (result.rejectedReason && result.hits.length === 0) {
    return (
      <pre className="px-3 py-2 font-mono text-[11px] text-status-error-fg">
        {result.rejectedReason}
      </pre>
    );
  }
  return (
    <div className="flex flex-col">
      <div className="border-b border-studio-canvas-alt bg-studio-canvas-alt/40 px-3 py-1.5 font-mono text-[10px] text-studio-ink-faint">
        <span className="uppercase tracking-eyebrow">tokens · </span>
        {result.extractedTerms.length === 0 ? (
          <span className="italic">no content tokens</span>
        ) : (
          result.extractedTerms.map((t) => (
            <span
              key={t}
              className="ml-1 inline-block rounded bg-studio-canvas px-1.5 py-0.5 text-studio-ink"
            >
              {t}
            </span>
          ))
        )}
        {result.droppedTerms.length > 0 ? (
          <span className="ml-3 text-studio-ink-faint">
            (dropped: {result.droppedTerms.slice(0, 6).join(", ")}
            {result.droppedTerms.length > 6 ? "…" : ""})
          </span>
        ) : null}
        {result.matchQuery ? (
          <span className="ml-2 text-studio-ink-faint">
            → MATCH <code className="font-mono">{result.matchQuery}</code>
          </span>
        ) : null}
      </div>
      {result.hits.length === 0 ? (
        <pre className="px-3 py-2 font-mono text-[11px] text-studio-ink-faint">
          (no chunks matched these tokens)
        </pre>
      ) : (
        <ol className="flex flex-col divide-y divide-studio-canvas-alt">
          {result.hits.map((h) => (
            <AskHitRow key={h.rowid} hit={h} />
          ))}
        </ol>
      )}
    </div>
  );
}

function AskHitRow({ hit }: { hit: AskHit }) {
  return (
    <li className="px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
          {hit.session_id ?? "?"} • {hit.document_kind ?? "?"}
          {hit.source_ref ? ` • ${hit.source_ref}` : ""}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-studio-ink-faint">
          rank {hit.rank.toFixed(3)}
        </span>
      </div>
      <p
        className="mt-1 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-studio-ink"
        dangerouslySetInnerHTML={{ __html: renderAskSnippet(hit.snippet) }}
      />
    </li>
  );
}

function askPanelFootnote(
  result: AskResult | undefined,
  hasQuestion: boolean,
): React.ReactNode {
  if (!hasQuestion) {
    return (
      <span>
        Local tokeniser strips stopwords, FTS5 ranks the matches. No LLM in the
        loop — sub-millisecond turnaround.
      </span>
    );
  }
  if (!result || (result.rejectedReason && !result.matchQuery)) {
    return null;
  }
  const tok = result.tokenizeLatencyMs;
  const fts = result.matchLatencyMs;
  const total = tok + fts;
  const dropped = result.droppedTerms.length;
  return (
    <span>
      local tokenise {tok} ms + FTS5 {fts} ms = {total} ms
      {dropped > 0 ? ` · dropped ${dropped} stopword${dropped === 1 ? "" : "s"}` : ""}
    </span>
  );
}

function renderAskSnippet(snippet: string): string {
  const escaped = snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return escaped
    .replace(/«/g, '<mark class="rounded bg-status-ok-bg/30 px-0.5 text-studio-ink">')
    .replace(/»/g, "</mark>");
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
  selection,
}: {
  session: SessionSample;
  run: CommandRun<ParseSessionResult>;
  selection: StudySelection;
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
        rerunHref={studyHref(selection, { force: "normalize" })}
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

const STREAM_DISPLAY_CAP = 30;

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
  const visible = result.records.slice(0, STREAM_DISPLAY_CAP);
  const cappedHere = Math.max(0, result.records.length - visible.length);
  const totalTail = cappedHere + moreCount;
  return (
    <div className="font-mono text-[10.5px]">
      <div className="grid grid-cols-[40px_148px_72px_minmax(0,1fr)] gap-3 border-b border-studio-edge px-3 py-1.5 text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span>idx</span>
        <span>kind</span>
        <span>tag</span>
        <span>detail</span>
      </div>
      <ul className="divide-y divide-studio-edge">
        {visible.map((r) => (
          <NormalizedRow key={r.i} record={r} />
        ))}
        {totalTail > 0 ? (
          <li className="grid grid-cols-[40px_148px_72px_minmax(0,1fr)] items-baseline gap-3 px-3 py-1.5 italic text-[10px] text-studio-ink-faint">
            <span>…</span>
            <span>{formatCount(totalTail)} more</span>
            <span>—</span>
            <span>
              {cappedHere > 0
                ? `${formatCount(cappedHere)} parsed but hidden · ${formatCount(moreCount)} not parsed`
                : "not parsed in this run"}
            </span>
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
  const sessionSlug = `${session.harness.toLowerCase()}-${session.tier}`;
  const filesWithContent = await loadFileContents(files);
  const initialSelected = selection.artifact ?? "files.md";

  return (
    <div className="space-y-4 p-5">
      <CommandSurface
        shell={extractQmdCommand.shell({
          path: session.fullPath,
          sessionId: sessionSlug,
        })}
        run={run}
        rerunHref={studyHref(selection, { force: "extract" })}
        body={
          <ArtifactPicker
            files={filesWithContent}
            initialSelected={initialSelected}
            emptyMessage={result?.error ?? "no extract result"}
          />
        }
        footnote={
          result && !result.error ? (
            <>
              Wrote {files.length} files to{" "}
              <code className="font-mono text-[10.5px] text-studio-ink" title={result.outDir}>
                {shortenTmpPath(result.outDir)}
              </code>{" "}
              · {result.mechanicalMs} ms · {result.recordsScanned} records scanned
            </>
          ) : null
        }
      />
    </div>
  );
}

async function loadFileContents(
  files: Array<{ name: string; path: string; bytes: number }>,
): Promise<ArtifactPickerFile[]> {
  return Promise.all(
    files.map(async (f) => ({
      name: f.name,
      bytes: f.bytes,
      content: await safeReadFile(f.path),
    })),
  );
}

async function EnrichPanel({
  session,
  selection,
  run,
}: {
  session: SessionSample;
  selection: StudySelection;
  run: CommandRun<EnrichSessionResult>;
}) {
  const result = run.output;
  const files = result?.files ?? [];
  const sessionSlug = `${session.harness.toLowerCase()}-${session.tier}`;
  const filesWithContent = await loadFileContents(files);
  const initialSelected = selection.artifact ?? "overview.md";

  return (
    <div className="space-y-4 p-5">
      <CommandSurface
        shell={enrichSessionCommand.shell({
          path: session.fullPath,
          sessionId: sessionSlug,
        })}
        run={run}
        rerunHref={studyHref(selection, { force: "enrich" })}
        body={
          <ArtifactPicker
            files={filesWithContent}
            initialSelected={initialSelected}
            emptyMessage={result?.error ?? "no enrich result"}
          />
        }
        footnote={
          result && !result.error && result.model ? (
            <>
              <code className="font-mono text-[10.5px] text-studio-ink">{result.model}</code>{" "}
              · prompt {result.promptChars.toLocaleString()} chars (
              {result.usage.promptTokens}t) · completion{" "}
              {result.usage.completionTokens}t ({result.usage.reasoningTokens}{" "}
              reasoning) · llm latency {result.llmLatencyMs} ms · finish{" "}
              {result.finishReason}
            </>
          ) : null
        }
      />
      {result?.reasoning ? (
        <details className="overflow-hidden rounded-[4px] border border-studio-edge bg-studio-canvas">
          <summary className="cursor-pointer border-b border-studio-edge bg-studio-canvas-alt px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            model reasoning · {result.reasoning.length.toLocaleString()} chars
          </summary>
          <pre className="max-h-[300px] overflow-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-studio-ink">
            {result.reasoning}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function IndexPanel({
  session,
  selection,
  run,
}: {
  session: SessionSample;
  selection: StudySelection;
  run: CommandRun<IndexCorpusResult>;
}) {
  const result = run.output;
  const sessionSlug = `${session.harness.toLowerCase()}-${session.tier}`;
  const indexedHere = result?.indexedSessions.find(
    (s) => s.sessionId === sessionSlug,
  );
  return (
    <div className="space-y-4 p-5">
      <CommandSurface
        shell={indexCorpusCommand.shell({ sessionIds: [sessionSlug] })}
        run={run}
        rerunHref={studyHref(selection, { force: "index" })}
        body={<IndexBody result={result} indexedHere={indexedHere} />}
        footnote={
          result && !run.error ? (
            <>
              {result.schemaWasFresh ? "Created schema · " : "Reused schema · "}
              db at{" "}
              <code className="font-mono text-[10.5px] text-studio-ink" title={result.dbPath}>
                {shortenTmpPath(result.dbPath)}
              </code>{" "}
              · {formatBytes(result.dbBytes)} ·{" "}
              {result.sessions} sessions · {result.documents} docs ·{" "}
              {result.chunks} chunks · {result.ftsRows} fts rows
            </>
          ) : null
        }
      />
    </div>
  );
}

function IndexBody({
  result,
  indexedHere,
}: {
  result: IndexCorpusResult | undefined;
  indexedHere?: IndexedSessionSummaryLocal;
}) {
  if (!result) {
    return (
      <pre className="px-3 py-2 font-mono text-[10.5px] text-studio-ink-faint">
        no index result
      </pre>
    );
  }
  const schemaRows: Array<{ table: string; rows: number; note: string }> = [
    { table: "sessions", rows: result.sessions, note: "one per QMD directory" },
    { table: "documents", rows: result.documents, note: "one per markdown / json file" },
    { table: "chunks", rows: result.chunks, note: "one per H2 section" },
    { table: "chunks_fts", rows: result.ftsRows, note: "FTS5 virtual table" },
  ];
  return (
    <div className="grid grid-cols-1 gap-px bg-studio-edge md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="bg-studio-canvas">
        <div className="border-b border-studio-edge px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          schema · row counts
        </div>
        <ul className="divide-y divide-studio-edge font-mono text-[10.5px]">
          {schemaRows.map((r) => (
            <li
              key={r.table}
              className="grid grid-cols-[minmax(0,1fr)_70px_minmax(0,1fr)] items-baseline gap-3 px-3 py-1.5"
            >
              <span className="text-studio-ink">{r.table}</span>
              <span className="text-right tabular-nums text-studio-ink">
                {r.rows.toLocaleString()}
              </span>
              <span className="text-studio-ink-faint">{r.note}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="bg-studio-canvas">
        <div className="border-b border-studio-edge px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          this session
        </div>
        <div className="px-3 py-2 font-mono text-[10.5px] text-studio-ink">
          {indexedHere ? (
            <>
              <div>session_id = <span>{indexedHere.sessionId}</span></div>
              <div>documents = {indexedHere.documents}</div>
              <div>chunks = {indexedHere.chunks}</div>
            </>
          ) : (
            <span className="text-studio-ink-faint">
              this session has no QMD output yet — run Extract first
            </span>
          )}
        </div>
        <div className="border-t border-studio-edge px-3 py-2 font-sans text-[12px] leading-relaxed text-studio-ink-faint">
          Chunks are one per H2 section. Walks every file in{" "}
          <code className="font-mono text-[11px] text-studio-ink">$TMPDIR/scout-study/qmd/&lt;session&gt;/</code>{" "}
          (skipping <code className="font-mono text-[11px] text-studio-ink">_</code>-prefixed metadata).
        </div>
      </div>
    </div>
  );
}

// Local mirror of the indexed-session shape so the panel doesn't import the
// command module's interface twice.
type IndexedSessionSummaryLocal = {
  sessionId: string;
  documents: number;
  chunks: number;
};

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

function isStageId(value: string): value is StageId {
  return STAGES.some((stage) => stage.id === value);
}

function TraceRowInspect({ entry }: { entry: RunLogEntry }) {
  if (!entry.trace) {
    return (
      <div className="border-t border-studio-edge bg-studio-canvas-alt px-4 py-3 font-mono text-[10.5px] text-studio-ink-faint">
        no trace data
        {entry.error ? <> · error: {entry.error}</> : null}
      </div>
    );
  }
  const { shell, input, output, cacheKey } = entry.trace;
  return (
    <div className="border-t border-studio-edge bg-studio-canvas-alt">
      <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 px-4 py-3 font-mono text-[10.5px]">
        <dt className="text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          shell
        </dt>
        <dd className="break-all text-studio-ink">$ {shell}</dd>
        <dt className="mt-1.5 text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          input
        </dt>
        <dd className="mt-1.5 break-all text-studio-ink">{input}</dd>
        <dt className="mt-1.5 text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          output
        </dt>
        <dd className="mt-1.5 break-all text-studio-ink">{output}</dd>
        <dt className="mt-1.5 text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          cache key
        </dt>
        <dd className="mt-1.5 break-all text-studio-ink-faint">{cacheKey}</dd>
      </dl>
    </div>
  );
}

// ── Run summary footer ───────────────────────────────────────────

const COMMAND_TO_STAGE: Record<string, StageId> = {
  inventory: "discover",
  "parse-session": "normalize",
  "extract-qmd": "extract",
  "enrich-session": "enrich",
  "index-corpus": "index",
};

function RunSummary({
  entries,
  selection,
}: {
  entries: RunLogEntry[];
  selection: StudySelection;
}) {
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
        {entries.map((e, i) => {
          const targetStage = COMMAND_TO_STAGE[e.id];
          return (
            <li key={`${e.id}-${i}`}>
              <details className="group">
                <summary className="grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,180px)] items-baseline gap-3 px-4 py-2 transition-colors hover:bg-studio-canvas-alt [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1 font-mono text-[10px] tabular-nums text-studio-ink-faint">
                    <span aria-hidden className="select-none text-[8px] text-studio-ink-faint/60 transition-transform group-open:rotate-90">
                      ▶
                    </span>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-sans text-[12.5px] font-semibold tracking-tight text-studio-ink">
                      {e.label}
                    </span>
                    <span className="font-mono text-[9.5px] text-studio-ink-faint">
                      {e.id}
                    </span>
                    {targetStage ? (
                      <RerunLink
                        href={studyHref(selection, { force: targetStage })}
                        className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint underline-offset-4 hover:text-studio-ink hover:underline"
                        title={`Force re-run ${e.label}`}
                        pendingLabel="running ↻"
                      >
                        re-run ↻
                      </RerunLink>
                    ) : null}
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
                </summary>
                <TraceRowInspect entry={e} />
              </details>
            </li>
          );
        })}
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
  const artifact = "artifact" in next ? next.artifact : current.artifact;
  if (artifact) params.set("artifact", artifact);
  const force = "force" in next ? next.force : undefined;
  if (force) params.set("force", force);
  const ask = "ask" in next ? next.ask : current.ask;
  if (ask) params.set("ask", ask);
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
