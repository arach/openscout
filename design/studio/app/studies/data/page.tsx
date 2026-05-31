import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { runCommand, type CommandRun } from "@/lib/studio/command";
import { CommandSurface } from "@/components/studio/CommandSurface";
import { RerunLink } from "@/components/studio/RerunLink";
import {
  dbAskCommand,
  dbMatchCommand,
  dbSchemaCommand,
  dbSelectCommand,
  listDatabasesCommand,
  type AskResult,
  type DbFile,
  type DbSchemaResult,
  type MatchHit,
  type MatchResult,
  type QueryResult,
  type TableInfo,
} from "@/lib/studio/commands/inspect-db";
import { QueryForm } from "./QueryForm";

type QueryModeId = "match" | "sql";

type Search = {
  db?: string;
  mode?: QueryModeId;
  match?: string;
  sql?: string;
  ask?: string;
  force?: string;
};

export const dynamic = "force-dynamic";

export default async function DataInspectorPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;

  const dbList = await runCommand(listDatabasesCommand, {}, {
    force: shouldForce(sp.force, "list-databases"),
  });
  const databases = dbList.output.databases;
  const selected =
    (sp.db && databases.find((d) => d.name === sp.db)) ?? databases[0] ?? undefined;
  const dbPath = selected?.path;

  return (
    <div className="flex max-w-5xl flex-col gap-5 px-8 py-8 text-studio-ink">
      <header className="flex flex-col gap-1">
        <h1 className="font-sans text-xl font-medium tracking-tight">Session DB explorer</h1>
        <p className="text-[12.5px] leading-relaxed text-studio-ink-faint">
          Make the shape of the{" "}
          <a className="underline-offset-4 hover:text-studio-ink hover:underline" href="/studies/session-search">
            session-search
          </a>{" "}
          index legible — what tables exist, what's actually in them, and the queries that exploit them. Browse the schema, load a representative query from the shortcuts, or poke around with FTS5 MATCH and ad-hoc SELECT.
        </p>
      </header>

      <CommandSurface
        shell={listDatabasesCommand.shell({})}
        run={dbList}
        rerunHref={hrefFor(sp, { force: "list-databases" })}
        body={
          <DatabasesPanel
            databases={databases}
            selectedName={selected?.name}
            sp={sp}
          />
        }
        footnote={
          <span>
            {databases.length} db{databases.length === 1 ? "" : "s"} •{" "}
            {selected
              ? `viewing ${selected.name} (${fmtBytes(selected.bytes)}, modified ${fmtAgo(selected.mtimeMs)})`
              : "no database selected"}
          </span>
        }
      />

      {dbPath ? (
        <>
          <Suspense key={`schema:${dbPath}`} fallback={<Skeleton label="Schema" />}>
            <SchemaCard dbPath={dbPath} sp={sp} />
          </Suspense>

          <Suspense
            key={`ask:${dbPath}:${(sp.ask ?? "").trim()}`}
            fallback={<Skeleton label="Ask the data" />}
          >
            <AskCard dbPath={dbPath} question={sp.ask ?? ""} sp={sp} />
          </Suspense>

          <ShortcutsPanel sp={sp} />

          {(() => {
            const mode = resolveMode(sp);
            const value = (sp[mode.paramName] ?? "").trim();
            return (
              <Suspense
                key={`query:${dbPath}:${mode.id}:${value}`}
                fallback={<Skeleton label={`Query · ${mode.label}`} />}
              >
                <UnifiedQueryCard dbPath={dbPath} mode={mode} sp={sp} />
              </Suspense>
            );
          })()}
        </>
      ) : (
        <div className="rounded border border-studio-edge bg-studio-canvas-alt px-4 py-6 text-[12.5px] text-studio-ink-faint">
          No databases found yet. Run the Index stage in the{" "}
          <a className="underline hover:text-studio-ink" href="/studies/session-search">
            session-search workbench
          </a>{" "}
          to create one.
        </div>
      )}
    </div>
  );
}

// ── Panels ─────────────────────────────────────────────────────────────

function DatabasesPanel({
  databases,
  selectedName,
  sp,
}: {
  databases: DbFile[];
  selectedName: string | undefined;
  sp: Search;
}) {
  if (databases.length === 0) {
    return (
      <div className="px-3 py-3 font-mono text-[11px] text-studio-ink-faint">
        (no .db files yet)
      </div>
    );
  }
  return (
    <ul className="divide-y divide-studio-canvas-alt">
      {databases.map((d) => {
        const active = d.name === selectedName;
        return (
          <li key={d.path}>
            <a
              href={hrefFor(sp, { db: d.name, match: undefined, sql: undefined, force: undefined })}
              className={`flex items-baseline justify-between gap-3 px-3 py-2 font-mono text-[11px] hover:bg-studio-canvas-alt ${active ? "bg-studio-canvas-alt text-studio-ink" : "text-studio-ink-faint"}`}
            >
              <span className="flex items-baseline gap-2">
                <span
                  aria-hidden
                  className={active ? "text-status-ok-fg" : "text-studio-ink-faint"}
                >
                  ●
                </span>
                <span>{d.name}</span>
              </span>
              <span className="tabular-nums">
                {fmtBytes(d.bytes)} • {fmtAgo(d.mtimeMs)}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

async function SchemaCard({ dbPath, sp }: { dbPath: string; sp: Search }) {
  const run = await runCommand(
    dbSchemaCommand,
    { dbPath },
    { force: shouldForce(sp.force, "db-schema") },
  );
  return (
    <CommandSurface
      shell={dbSchemaCommand.shell({ dbPath })}
      run={run}
      rerunHref={hrefFor(sp, { force: "db-schema" })}
      body={<SchemaBody result={run.output} />}
      footnote={
        run.output ? (
          <span>
            {run.output.tables.length} table{run.output.tables.length === 1 ? "" : "s"} •{" "}
            {run.output.tables.reduce((s, t) => s + t.rowCount, 0).toLocaleString()} rows total
          </span>
        ) : null
      }
    />
  );
}

function SchemaBody({ result }: { result: DbSchemaResult | undefined }) {
  if (!result) return <pre className="px-3 py-2 font-mono text-[11px]">(no result)</pre>;
  if (result.tables.length === 0) {
    return (
      <pre className="px-3 py-2 font-mono text-[11px] text-studio-ink-faint">
        (no tables)
      </pre>
    );
  }
  return (
    <div className="flex flex-col divide-y divide-studio-canvas-alt">
      {result.tables.map((t) => (
        <TableRow key={t.name} table={t} />
      ))}
    </div>
  );
}

function TableRow({ table }: { table: TableInfo }) {
  const kindTone =
    table.kind === "fts5"
      ? "text-status-ok-fg"
      : table.kind === "shadow"
        ? "text-studio-ink-faint"
        : table.kind === "view"
          ? "text-status-info-fg"
          : "text-studio-ink";
  return (
    <div className="grid grid-cols-[160px_1fr_auto] items-baseline gap-3 px-3 py-2">
      <span className="flex flex-col">
        <span className="font-mono text-[11.5px] text-studio-ink">{table.name}</span>
        <span className={`font-mono text-[9px] uppercase tracking-eyebrow ${kindTone}`}>
          {table.kind}
        </span>
      </span>
      <span className="font-mono text-[10.5px] leading-relaxed text-studio-ink-faint">
        {table.columns.length === 0
          ? "(no introspectable columns)"
          : table.columns
              .map((c) => `${c.name}${c.isPk ? "*" : ""}:${c.type || "any"}`)
              .join("  ")}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-studio-ink">
        {table.rowCount.toLocaleString()}
      </span>
    </div>
  );
}

/**
 * Form-first chrome for parameterized queries.
 *
 * Differs from CommandSurface: the editable form lives at the top (it is the
 * actual query), the result follows, and the shell-equivalent echo is
 * demoted to a small footer band — "discoverable but not central." `heading`
 * is a slot so consumers can swap in static labels or interactive mode tabs.
 */
function QueryCard({
  heading,
  run,
  rerunHref,
  form,
  resultLabel,
  resultBody,
  shell,
  footnote,
}: {
  heading: ReactNode;
  run: Pick<CommandRun<unknown>, "durationMs" | "cached" | "error">;
  rerunHref?: string;
  form: ReactNode;
  resultLabel: string;
  resultBody: ReactNode;
  shell: string;
  footnote?: ReactNode;
}) {
  const badge = run.error
    ? { label: "● error", tone: "text-status-error-fg" }
    : run.cached
      ? { label: "● cached", tone: "text-studio-ink-faint" }
      : { label: `● ran ${run.durationMs} ms`, tone: "text-status-ok-fg" };

  return (
    <div className="overflow-hidden rounded-[4px] border border-studio-edge bg-studio-canvas">
      <div className="flex items-center justify-between gap-3 border-b border-studio-edge bg-studio-canvas-alt px-3 py-1.5">
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink">
          {heading}
        </span>
        <span className="flex items-center gap-2">
          {rerunHref ? (
            <RerunLink
              href={rerunHref}
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

      {form}

      <div className="border-t border-studio-canvas-alt bg-studio-canvas-alt px-3 py-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {resultLabel}
      </div>
      {run.error ? (
        <pre className="overflow-x-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-status-error-fg">
          {run.error}
        </pre>
      ) : (
        resultBody
      )}

      {footnote ? (
        <div className="border-t border-studio-canvas-alt bg-studio-canvas-alt px-3 py-2 font-sans text-[11.5px] leading-relaxed text-studio-ink-faint">
          {footnote}
        </div>
      ) : null}

      <details className="border-t border-studio-canvas-alt bg-studio-canvas-alt/40 group">
        <summary className="cursor-pointer list-none px-3 py-1 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint hover:text-studio-ink">
          as shell ›
        </summary>
        <pre className="overflow-x-auto border-t border-studio-canvas-alt px-3 py-1.5 font-mono text-[10px] leading-relaxed text-studio-ink-faint">
          $ {shell}
        </pre>
      </details>
    </div>
  );
}

/**
 * Strategy registry for query modes. Each mode closes over its concrete
 * command + input shape; the registry surface is type-erased to keep the
 * dispatching code in UnifiedQueryCard simple. Add a new mode → declare one
 * entry; chrome, tab UI, and URL plumbing don't change.
 * (See `feedback_strategy_over_switch`.)
 */
interface QueryMode {
  id: QueryModeId;
  label: string;
  paramName: "match" | "sql";
  forceCmdId: string;
  formProps: {
    placeholder: string;
    submitLabel: string;
    multiline?: boolean;
  };
  shell: (args: { dbPath: string; value: string }) => string;
  runQuery: (args: {
    dbPath: string;
    value: string;
    force: boolean;
  }) => Promise<CommandRun<unknown>>;
  resultLabel: (output: unknown, hasValue: boolean) => string;
  resultBody: (output: unknown) => ReactNode;
  footnote: (output: unknown, hasValue: boolean) => ReactNode;
}

const MATCH_MODE: QueryMode = {
  id: "match",
  label: "FTS5 MATCH",
  paramName: "match",
  forceCmdId: "db-match",
  formProps: {
    placeholder: "MATCH term, e.g. auth OR tokens",
    submitLabel: "match ↻",
  },
  shell: ({ dbPath, value }) =>
    dbMatchCommand.shell({ dbPath, term: value || "<term>" }),
  runQuery: ({ dbPath, value, force }) =>
    runCommand(dbMatchCommand, { dbPath, term: value }, { force }),
  resultLabel: (output, hasValue) => {
    const o = output as MatchResult | undefined;
    return hasValue ? `hits · ${o?.hits.length ?? 0}` : "hits";
  },
  resultBody: (output) => <MatchBody result={output as MatchResult | undefined} />,
  footnote: (output, hasValue) => {
    const o = output as MatchResult | undefined;
    return hasValue && !o?.rejectedReason
      ? "lower rank = better match"
      : "enter a term above to search";
  },
};

const SQL_MODE: QueryMode = {
  id: "sql",
  label: "SQL SELECT",
  paramName: "sql",
  forceCmdId: "db-select",
  formProps: {
    placeholder: "SELECT * FROM sessions LIMIT 10",
    submitLabel: "select ↻",
    multiline: true,
  },
  shell: ({ dbPath, value }) =>
    dbSelectCommand.shell({ dbPath, sql: value.trim() || "SELECT 1" }),
  runQuery: ({ dbPath, value, force }) =>
    runCommand(dbSelectCommand, { dbPath, sql: value }, { force }),
  resultLabel: (output, hasValue) => {
    const o = output as QueryResult | undefined;
    return hasValue ? `rows · ${o?.rowsTotal ?? 0}` : "rows";
  },
  resultBody: (output) => <QueryResultBody result={output as QueryResult | undefined} />,
  footnote: (_output, hasValue) =>
    hasValue ? (
      <span>Read-only • single statement • auto-limited to 100 rows • ⌘↩ submits</span>
    ) : (
      <span>SELECT or WITH only • ⌘↩ submits</span>
    ),
};

const QUERY_MODES: QueryMode[] = [MATCH_MODE, SQL_MODE];

function resolveMode(sp: Search): QueryMode {
  const wanted = sp.mode;
  const found = wanted ? QUERY_MODES.find((m) => m.id === wanted) : undefined;
  return found ?? QUERY_MODES[0]!;
}

function ModeTabs({ current, sp }: { current: QueryModeId; sp: Search }) {
  return (
    <>
      <span className="text-studio-ink-faint">query ·</span>
      {QUERY_MODES.map((m, i) => {
        const active = m.id === current;
        return (
          <span key={m.id} className="flex items-center gap-2">
            {i > 0 ? <span className="text-studio-ink-faint">|</span> : null}
            <Link
              href={hrefFor(sp, { mode: m.id, force: undefined })}
              scroll={false}
              className={
                active
                  ? "text-studio-ink"
                  : "text-studio-ink-faint underline-offset-4 hover:text-studio-ink hover:underline"
              }
              aria-current={active ? "page" : undefined}
            >
              {m.label}
            </Link>
          </span>
        );
      })}
    </>
  );
}

async function UnifiedQueryCard({
  dbPath,
  mode,
  sp,
}: {
  dbPath: string;
  mode: QueryMode;
  sp: Search;
}) {
  const value = (sp[mode.paramName] ?? "").toString();
  const trimmed = value.trim();

  const run = await mode.runQuery({
    dbPath,
    value,
    force: shouldForce(sp.force, mode.forceCmdId),
  });

  return (
    <QueryCard
      heading={<ModeTabs current={mode.id} sp={sp} />}
      run={run}
      rerunHref={trimmed ? hrefFor(sp, { force: mode.forceCmdId }) : undefined}
      form={
        <QueryForm
          paramName={mode.paramName}
          defaultValue={value}
          placeholder={mode.formProps.placeholder}
          submitLabel={mode.formProps.submitLabel}
          multiline={mode.formProps.multiline}
        />
      }
      resultLabel={mode.resultLabel(run.output, trimmed.length > 0)}
      resultBody={mode.resultBody(run.output)}
      shell={mode.shell({ dbPath, value })}
      footnote={mode.footnote(run.output, trimmed.length > 0)}
    />
  );
}

// ── Ask the data ──────────────────────────────────────────────────────

async function AskCard({
  dbPath,
  question,
  sp,
}: {
  dbPath: string;
  question: string;
  sp: Search;
}) {
  const run = await runCommand(
    dbAskCommand,
    { dbPath, question },
    { force: shouldForce(sp.force, "db-ask") },
  );
  const trimmed = question.trim();
  const out = run.output;

  return (
    <QueryCard
      heading={
        <>
          <span className="text-studio-ink-faint">ask ·</span>
          <span className="text-studio-ink">the data</span>
        </>
      }
      run={run}
      rerunHref={trimmed ? hrefFor(sp, { force: "db-ask" }) : undefined}
      form={
        <QueryForm
          paramName="ask"
          defaultValue={question}
          placeholder="what did the agent decide about auth?  what files did it edit?"
          multiline
          submitLabel="ask ↻"
        />
      }
      resultLabel={
        trimmed
          ? `answer · ${out?.hits.length ?? 0} chunks`
          : "answer"
      }
      resultBody={<AskBody result={out} />}
      shell={dbAskCommand.shell({ dbPath, question: trimmed || "<question>" })}
      footnote={askFootnote(out, trimmed.length > 0)}
    />
  );
}

function AskBody({ result }: { result: AskResult | undefined }) {
  if (!result) return null;
  if (result.rejectedReason && result.hits.length === 0) {
    return (
      <pre className="px-3 py-2 font-mono text-[11px] text-status-error-fg">
        {result.rejectedReason}
      </pre>
    );
  }
  if (!result.question) return null;

  return (
    <div className="flex flex-col">
      <div className="border-b border-studio-canvas-alt bg-studio-canvas-alt/40 px-3 py-1.5 font-mono text-[10px] text-studio-ink-faint">
        <span className="uppercase tracking-eyebrow">searched for · </span>
        {result.extractedTerms.length === 0 ? (
          <span className="italic">no terms extracted</span>
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
        {result.matchQuery ? (
          <span className="ml-2 text-studio-ink-faint">
            → MATCH <code className="font-mono">{result.matchQuery}</code>
          </span>
        ) : null}
      </div>
      {result.hits.length === 0 ? (
        <pre className="px-3 py-2 font-mono text-[11px] text-studio-ink-faint">
          {result.rejectedReason ?? "(no chunks matched these terms)"}
        </pre>
      ) : (
        <ol className="flex flex-col divide-y divide-studio-canvas-alt">
          {result.hits.map((h) => (
            <MatchHitRow
              key={h.rowid}
              hit={{
                rowid: h.rowid,
                session_id: h.session_id,
                document_kind: h.document_kind,
                source_ref: h.source_ref,
                snippet: h.snippet,
                rank: h.rank,
              }}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function askFootnote(
  result: AskResult | undefined,
  hasQuestion: boolean,
): ReactNode {
  if (!hasQuestion) {
    return (
      <span>
        Type a question · ⌘↩ submits · stopwords stripped locally, then FTS5
        MATCH over chunks — no LLM in the loop
      </span>
    );
  }
  if (!result || (result.rejectedReason && !result.matchQuery)) {
    return null;
  }
  const tok = result.tokenizeLatencyMs;
  const fts = result.matchLatencyMs;
  const total = tok + fts;
  const droppedCount = result.droppedTerms.length;
  return (
    <span>
      local tokenise {tok} ms + FTS5 {fts} ms = {total} ms
      {droppedCount > 0 ? ` · dropped ${droppedCount} stopword${droppedCount === 1 ? "" : "s"}` : ""}
    </span>
  );
}

// ── Shortcuts deck ────────────────────────────────────────────────────

interface Shortcut {
  id: string;
  mode: QueryModeId;
  label: string;
  value: string;
}

const SHORTCUTS: Shortcut[] = [
  {
    id: "all-sessions",
    mode: "sql",
    label: "All sessions",
    value: "SELECT * FROM sessions",
  },
  {
    id: "documents-by-kind",
    mode: "sql",
    label: "Documents by kind",
    value:
      "SELECT kind, COUNT(*) AS docs, SUM(bytes) AS bytes\nFROM documents\nGROUP BY kind\nORDER BY docs DESC",
  },
  {
    id: "chunks-per-document",
    mode: "sql",
    label: "Chunks per document",
    value:
      "SELECT d.path, d.kind, COUNT(c.id) AS chunks\nFROM documents d\nLEFT JOIN chunks c ON c.document_id = d.id\nGROUP BY d.id\nORDER BY chunks DESC\nLIMIT 20",
  },
  {
    id: "largest-chunks",
    mode: "sql",
    label: "Largest chunks",
    value:
      "SELECT c.id, c.source_ref, d.kind, LENGTH(c.text) AS len\nFROM chunks c JOIN documents d ON d.id = c.document_id\nORDER BY len DESC\nLIMIT 10",
  },
  {
    id: "first-chunk-preview",
    mode: "sql",
    label: "First chunk preview",
    value:
      "SELECT id, source_ref, substr(text, 1, 300) AS preview\nFROM chunks\nORDER BY id\nLIMIT 3",
  },
  {
    id: "match-agent",
    mode: "match",
    label: "Match: agent",
    value: "agent",
  },
  {
    id: "match-session",
    mode: "match",
    label: "Match: session",
    value: "session",
  },
];

function ShortcutsPanel({ sp }: { sp: Search }) {
  return (
    <div className="overflow-hidden rounded-[4px] border border-studio-edge bg-studio-canvas">
      <div className="flex items-baseline justify-between border-b border-studio-edge bg-studio-canvas-alt px-3 py-1.5">
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink">
          shortcuts
        </span>
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          click to load
        </span>
      </div>
      <ul className="grid grid-cols-2">
        {SHORTCUTS.map((s, i) => {
          const oneLine = s.value.replace(/\s+/g, " ").trim();
          const preview = oneLine.length > 60 ? oneLine.slice(0, 57) + "…" : oneLine;
          const href = hrefFor(sp, {
            mode: s.mode,
            [s.mode === "match" ? "match" : "sql"]: s.value,
            force: undefined,
          } as Partial<Search>);
          const colStart = i % 2 === 0 ? "border-r border-studio-canvas-alt" : "";
          const rowBorder = i >= 2 ? "border-t border-studio-canvas-alt" : "";
          return (
            <li key={s.id} className={`${colStart} ${rowBorder}`}>
              <Link
                href={href}
                scroll={false}
                className="block px-3 py-2 hover:bg-studio-canvas-alt"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[11.5px] text-studio-ink">
                    {s.label}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
                    {s.mode === "match" ? "match" : "select"}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] leading-relaxed text-studio-ink-faint">
                  {preview}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MatchBody({ result }: { result: MatchResult | undefined }) {
  if (!result) return null;
  if (result.rejectedReason) {
    return (
      <pre className="px-3 py-2 font-mono text-[11px] text-status-error-fg">
        {result.rejectedReason}
      </pre>
    );
  }
  if (result.hits.length === 0) {
    return (
      <pre className="px-3 py-2 font-mono text-[11px] text-studio-ink-faint">
        (no hits)
      </pre>
    );
  }
  return (
    <ol className="flex flex-col divide-y divide-studio-canvas-alt">
      {result.hits.map((h) => (
        <MatchHitRow key={h.rowid} hit={h} />
      ))}
    </ol>
  );
}

function MatchHitRow({ hit }: { hit: MatchHit }) {
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
        dangerouslySetInnerHTML={{ __html: renderMatchSnippet(hit.snippet) }}
      />
    </li>
  );
}

function QueryResultBody({ result }: { result: QueryResult | undefined }) {
  if (!result) return null;
  if (result.rejectedReason) {
    return (
      <pre className="px-3 py-2 font-mono text-[11px] text-status-error-fg">
        {result.rejectedReason}
      </pre>
    );
  }
  if (result.rows.length === 0) {
    return (
      <pre className="px-3 py-2 font-mono text-[11px] text-studio-ink-faint">
        (0 rows)
      </pre>
    );
  }
  const cols = result.columns;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[10.5px]">
        <thead>
          <tr className="bg-studio-canvas-alt">
            {cols.map((c) => (
              <th
                key={c}
                className="px-3 py-1.5 text-left font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-b border-studio-canvas-alt">
              {cols.map((c) => (
                <td
                  key={c}
                  className="max-w-[420px] truncate px-3 py-1 align-top text-studio-ink"
                  title={fmtCell(row[c])}
                >
                  {fmtCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-[4px] border border-studio-edge bg-studio-canvas">
      <div className="flex items-center justify-between gap-3 border-b border-studio-edge bg-studio-canvas-alt px-3 py-1.5">
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {label}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint animate-pulse">
          ● running…
        </span>
      </div>
      <div className="px-3 py-6 font-mono text-[11px] text-studio-ink-faint">
        …
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function hrefFor(sp: Search, patch: Partial<Search>): string {
  const next: Search = { ...sp, ...patch };
  const params = new URLSearchParams();
  for (const k of ["db", "mode", "match", "sql", "ask", "force"] as const) {
    const v = next[k];
    if (v != null && v !== "") params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/studies/data?${qs}` : "/studies/data";
}

function shouldForce(force: string | undefined, cmdId: string): boolean {
  if (!force) return false;
  if (force === "all") return true;
  return force === cmdId;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtAgo(mtimeMs: number): string {
  const dt = Date.now() - mtimeMs;
  const s = Math.floor(dt / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v.toString() : "NaN";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Uint8Array || v instanceof Buffer) return `<${v.length} bytes>`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function renderMatchSnippet(snippet: string): string {
  // Escape, then promote our delimiters to bold spans.
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
