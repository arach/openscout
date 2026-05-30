import "./knowledge-search.css";

import { useMemo, useState } from "react";
import {
  Archive,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  FileSearch,
  GitBranch,
  Layers3,
  MessageSquareText,
  Search,
  SlidersHorizontal,
  Sparkles,
  Waypoints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Route } from "../lib/types.ts";

type ExtractionModeId = "mechanical" | "standard" | "deep";

type ExtractionMode = {
  id: ExtractionModeId;
  label: string;
  summary: string;
  llmUse: string;
  output: string;
};

type PipelineStage = {
  id: string;
  label: string;
  status: string;
  detail: string;
  icon: LucideIcon;
};

type SearchHit = {
  title: string;
  location: string;
  score: string;
  snippet: string;
  source: string;
};

type SearchScenario = {
  id: string;
  query: string;
  intent: string;
  answer: string;
  hits: SearchHit[];
};

const SESSION_PATH =
  "/Users/arach/.codex/sessions/2026/05/30/rollout-2026-05-30T11-25-39-019e797d-ab15-7823-b322-4434c5831317.jsonl";

const SIDE_CAR_ROOT = "/tmp/openscout-qmd-e2e/docs";

const EXTRACTION_MODES: ExtractionMode[] = [
  {
    id: "mechanical",
    label: "Mechanical",
    summary: "Chunk, normalize, attach source refs, and index immediately.",
    llmUse: "No LLM pass",
    output: "raw event docs + tool-call catalog",
  },
  {
    id: "standard",
    label: "Summary",
    summary: "Add compact decision, file, problem, and next-action summaries before indexing.",
    llmUse: "Small summary pass",
    output: "QMD-ready docs + topic summaries",
  },
  {
    id: "deep",
    label: "Deep",
    summary: "Run focused extraction against a declared interest set before building the index.",
    llmUse: "Selective LLM pass",
    output: "curated knowledge pack + raw refs",
  },
];

const PIPELINE: PipelineStage[] = [
  {
    id: "select",
    label: "Session Set",
    status: "curated",
    detail: "The user chooses sessions worth remembering instead of importing every harness log.",
    icon: Archive,
  },
  {
    id: "extract",
    label: "Extraction",
    status: "derived",
    detail: "QMD-style markdown docs are produced from observed transcripts with stable source refs.",
    icon: Layers3,
  },
  {
    id: "index",
    label: "Fuzzy Index",
    status: "rebuildable",
    detail: "FTS/fuzzy search targets the derived corpus; vectors can be added later, not required first.",
    icon: Database,
  },
  {
    id: "talk",
    label: "LLM Conversation",
    status: "assisted",
    detail: "The assistant works over extracted knowledge first, keeping answers cheap and directed.",
    icon: MessageSquareText,
  },
  {
    id: "drilldown",
    label: "Raw Drilldown",
    status: "anchored",
    detail: "When confidence matters, jump back to the exact JSONL source and event-level context.",
    icon: FileSearch,
  },
];

const METRICS = [
  { label: "Source sessions", value: "1", detail: "Codex JSONL" },
  { label: "Observed events", value: "310", detail: "source material" },
  { label: "Derived docs", value: "13", detail: "markdown files" },
  { label: "Index size", value: "548 KB", detail: "SQLite / FTS" },
  { label: "Vectors", value: "0", detail: "lexical first" },
];

const SEARCH_SCENARIOS: SearchScenario[] = [
  {
    id: "drilldown",
    query: "which session discussed raw log drilldown?",
    intent: "Find the strategy conversation before opening the transcript.",
    answer:
      "This session is about a two-step session-knowledge flow: summarize/extract into a search corpus, then use retrieval to jump back to raw logs only when needed.",
    hits: [
      {
        title: "events-07.md",
        location: "line 133",
        score: "BM25 0.91",
        snippet:
          "semantic conversation first, raw-log drilldown second",
        source: "qmd://scout-session/events-07.md:133",
      },
      {
        title: "overview.md",
        location: "line 18",
        score: "BM25 0.77",
        snippet:
          "session knowledge collections, QMD store creation, and event-level lookup",
        source: "qmd://scout-session/overview.md:18",
      },
    ],
  },
  {
    id: "policy",
    query: "QMD store extraction policy",
    intent: "Separate QMD's store mechanics from Scout's extraction policy.",
    answer:
      "QMD provides the markdown store and search mechanics. Scout would own the pre-index extraction policy: decisions, files, errors, next actions, and source coordinates.",
    hits: [
      {
        title: "events-09.md",
        location: "line 38",
        score: "BM25 0.88",
        snippet:
          "store creation is mostly index/database setup",
        source: "qmd://scout-session/events-09.md:38",
      },
      {
        title: "tool-calls.md",
        location: "line 74",
        score: "BM25 0.65",
        snippet:
          "collection add, context add, update, search, and get verified the store loop",
        source: "qmd://scout-session/tool-calls.md:74",
      },
    ],
  },
  {
    id: "logs",
    query: "extract knowledge and make fast search from logs",
    intent: "Recover the source idea and the concrete search shape.",
    answer:
      "The useful pattern is not bulk transcript import. It is a derived knowledge set with line-addressable docs, fuzzy search, freshness metadata, and a raw-log escape hatch.",
    hits: [
      {
        title: "overview.md",
        location: "line 7",
        score: "BM25 0.83",
        snippet:
          "extract knowledge from logs, build fast search, then converse over the resulting dataset",
        source: "qmd://scout-session/overview.md:7",
      },
      {
        title: "events-05.md",
        location: "line 92",
        score: "BM25 0.72",
        snippet:
          "user-curated session sets become indexed knowledge collections",
        source: "qmd://scout-session/events-05.md:92",
      },
    ],
  },
];

const DOC_ROWS = [
  { name: "overview.md", kind: "summary", weight: "high", refs: "session + topics" },
  { name: "tool-calls.md", kind: "catalog", weight: "medium", refs: "commands + outputs" },
  { name: "events-01.md ... events-11.md", kind: "chunks", weight: "source", refs: "event windows" },
];

const WEEKLY_SCOPE_ROWS = [
  { label: "Codex sessions", value: "78", detail: "191 MiB raw JSONL" },
  { label: "Claude main", value: "72", detail: "228 MiB raw JSONL" },
  { label: "Claude subagents", value: "114", detail: "56 MiB raw JSONL" },
  { label: "Claude history", value: "1", detail: "13 MiB raw JSONL" },
  { label: "All observed", value: "266", detail: "489 MiB this week" },
];

const SAMPLE_SESSION_ROWS = [
  {
    harness: "Codex",
    tier: "large",
    size: "13.0 MiB",
    events: "4,220",
    rawEstimate: "~3.4M raw-token eq.",
    modified: "2026-05-29 23:29",
    path: "~/.codex/sessions/2026/05/29/...019e75fd-a431...jsonl",
  },
  {
    harness: "Codex",
    tier: "normal",
    size: "1.1 MiB",
    events: "494",
    rawEstimate: "~289k raw-token eq.",
    modified: "2026-05-25 15:45",
    path: "~/.codex/sessions/2026/05/25/...019e609c-4389...jsonl",
  },
  {
    harness: "Codex",
    tier: "small",
    size: "34 KiB",
    events: "12",
    rawEstimate: "~9k raw-token eq.",
    modified: "2026-05-29 00:16",
    path: "~/.codex/sessions/2026/05/29/...019e71f2-958c...jsonl",
  },
  {
    harness: "Claude",
    tier: "large",
    size: "52.9 MiB",
    events: "12,009",
    rawEstimate: "~13.9M raw-token eq.",
    modified: "2026-05-26 02:49",
    path: "~/.claude/projects/-Users-arach-dev-openscout/a00198bf...jsonl",
  },
  {
    harness: "Claude",
    tier: "normal",
    size: "745 KiB",
    events: "252",
    rawEstimate: "~191k raw-token eq.",
    modified: "2026-05-23 13:11",
    path: "~/.claude/projects/-Users-arach-dev-openscout/c680a795...jsonl",
  },
  {
    harness: "Claude",
    tier: "small",
    size: "2.1 KiB",
    events: "5",
    rawEstimate: "~500 raw-token eq.",
    modified: "2026-05-24 21:57",
    path: "~/.claude/projects/-Users-arach-dev-contextual/ada6d81e...jsonl",
  },
];

const WEEK_PREP_ROWS = [
  {
    step: "Inventory",
    input: "266 files / 489 MiB",
    output: "session manifest",
    timing: "1-5s",
  },
  {
    step: "Mechanical extraction",
    input: "raw JSONL",
    output: "25-100 MiB markdown",
    timing: "30-120s",
  },
  {
    step: "FTS/fuzzy index",
    input: "derived markdown",
    output: "75-300 MiB SQLite",
    timing: "30-180s",
  },
  {
    step: "First useful search",
    input: "local index",
    output: "ranked hits + source refs",
    timing: "<100ms/query",
  },
  {
    step: "LLM enrichment",
    input: "selected chunks",
    output: "decisions, files, problems",
    timing: "10-60m async",
  },
];

function classPart(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

export function KnowledgeSearchScreen({ navigate }: { navigate: (route: Route) => void }) {
  const [modeId, setModeId] = useState<ExtractionModeId>("standard");
  const [scenarioId, setScenarioId] = useState(SEARCH_SCENARIOS[0]!.id);

  const selectedMode = useMemo(
    () => EXTRACTION_MODES.find((mode) => mode.id === modeId) ?? EXTRACTION_MODES[0]!,
    [modeId],
  );
  const selectedScenario = useMemo(
    () => SEARCH_SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? SEARCH_SCENARIOS[0]!,
    [scenarioId],
  );

  return (
    <main className="ks-page">
      <header className="ks-toolbar">
        <div className="ks-title-block">
          <div className="ks-kicker">
            <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" />
            Session Knowledge Search
          </div>
          <h1>QMD-style extraction, fuzzy search, then raw-log drilldown.</h1>
          <p>
            A Scout-native view of the workflow: choose sessions, derive a markdown knowledge
            corpus, search that corpus quickly, and only open transcript-level evidence when the
            conversation needs it.
          </p>
        </div>
        <div className="ks-toolbar-actions">
          <button type="button" className="ks-icon-button" onClick={() => navigate({ view: "sessions" })}>
            <Archive size={15} strokeWidth={1.8} aria-hidden="true" />
            Sessions
          </button>
          <button type="button" className="ks-icon-button" onClick={() => navigate({ view: "ops", mode: "tail" })}>
            <FileSearch size={15} strokeWidth={1.8} aria-hidden="true" />
            Tail
          </button>
        </div>
      </header>

      <section className="ks-metrics" aria-label="QMD sidecar run metrics">
        {METRICS.map((metric) => (
          <div key={metric.label} className="ks-metric">
            <span className="ks-metric-label">{metric.label}</span>
            <strong>{metric.value}</strong>
            <span>{metric.detail}</span>
          </div>
        ))}
      </section>

      <section className="ks-boundary" aria-label="Ownership boundary">
        <GitBranch size={15} strokeWidth={1.8} aria-hidden="true" />
        <strong>Boundary:</strong>
        <span>
          harness transcripts stay observed source material; Scout stores derived knowledge,
          source refs, and broker-owned coordination records.
        </span>
      </section>

      <section className="ks-panel ks-week-panel">
        <div className="ks-panel-head">
          <div>
            <span className="ks-panel-eyebrow">One-week run</span>
            <h2>Local log footprint for a heavy week</h2>
          </div>
          <Clock3 size={16} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <div className="ks-week-grid" aria-label="Recent local transcript footprint">
          {WEEKLY_SCOPE_ROWS.map((row) => (
            <div key={row.label} className="ks-week-card">
              <span>{row.label}</span>
              <strong>{row.value}</strong>
              <em>{row.detail}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="ks-panel ks-sample-panel">
        <div className="ks-panel-head">
          <div>
            <span className="ks-panel-eyebrow">Representative sample</span>
            <h2>Large, normal, and small sessions from Codex and Claude</h2>
          </div>
          <Archive size={16} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <div className="ks-sample-table" role="table" aria-label="Six representative recent sessions">
          <div className="ks-sample-row ks-sample-row--head" role="row">
            <span role="columnheader">Harness</span>
            <span role="columnheader">Tier</span>
            <span role="columnheader">Size</span>
            <span role="columnheader">Events</span>
            <span role="columnheader">Rough size</span>
            <span role="columnheader">Modified</span>
            <span role="columnheader">Path</span>
          </div>
          {SAMPLE_SESSION_ROWS.map((row) => (
            <div key={`${row.harness}-${row.tier}`} className="ks-sample-row" role="row">
              <span role="cell">{row.harness}</span>
              <span role="cell" className={`ks-tier ks-tier--${row.tier}`}>{row.tier}</span>
              <span role="cell">{row.size}</span>
              <span role="cell">{row.events}</span>
              <span role="cell">{row.rawEstimate}</span>
              <span role="cell">{row.modified}</span>
              <code role="cell">{row.path}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="ks-workbench">
        <aside className="ks-panel ks-pipeline-panel">
          <div className="ks-panel-head">
            <div>
              <span className="ks-panel-eyebrow">Pipeline</span>
              <h2>Two-step memory path</h2>
            </div>
            <Waypoints size={16} strokeWidth={1.7} aria-hidden="true" />
          </div>
          <ol className="ks-pipeline">
            {PIPELINE.map((stage, index) => {
              const Icon = stage.icon;
              return (
                <li key={stage.id} className="ks-stage">
                  <span className="ks-stage-index">{index + 1}</span>
                  <span className="ks-stage-icon">
                    <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <span className="ks-stage-body">
                    <span className="ks-stage-main">
                      <strong>{stage.label}</strong>
                      <em>{stage.status}</em>
                    </span>
                    <span>{stage.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </aside>

        <section className="ks-panel ks-conversation-panel">
          <div className="ks-panel-head">
            <div>
              <span className="ks-panel-eyebrow">Conversation layer</span>
              <h2>Ask the derived corpus first</h2>
            </div>
            <Bot size={16} strokeWidth={1.7} aria-hidden="true" />
          </div>

          <div className="ks-query-tabs" role="tablist" aria-label="Sample knowledge searches">
            {SEARCH_SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                role="tab"
                aria-selected={scenario.id === scenarioId}
                className={`ks-query-tab${scenario.id === scenarioId ? " ks-query-tab--active" : ""}`}
                onClick={() => setScenarioId(scenario.id)}
              >
                <Search size={13} strokeWidth={1.8} aria-hidden="true" />
                <span>{scenario.query}</span>
              </button>
            ))}
          </div>

          <div className="ks-chat-surface">
            <div className="ks-chat-row ks-chat-row--user">
              <span className="ks-chat-label">User</span>
              <p>{selectedScenario.query}</p>
            </div>
            <div className="ks-chat-row ks-chat-row--assistant">
              <span className="ks-chat-label">Scout</span>
              <p>{selectedScenario.answer}</p>
            </div>
          </div>

          <div className="ks-hit-list">
            <div className="ks-hit-list-head">
              <span>{selectedScenario.intent}</span>
              <strong>{selectedScenario.hits.length} hits</strong>
            </div>
            {selectedScenario.hits.map((hit) => (
              <article key={`${selectedScenario.id}-${hit.source}`} className="ks-hit">
                <div className="ks-hit-title">
                  <FileSearch size={14} strokeWidth={1.8} aria-hidden="true" />
                  <strong>{hit.title}</strong>
                  <span>{hit.location}</span>
                  <em>{hit.score}</em>
                </div>
                <p>{hit.snippet}</p>
                <code>{hit.source}</code>
              </article>
            ))}
          </div>
        </section>

        <aside className="ks-panel ks-store-panel">
          <div className="ks-panel-head">
            <div>
              <span className="ks-panel-eyebrow">Store builder</span>
              <h2>Extraction mode</h2>
            </div>
            <SlidersHorizontal size={16} strokeWidth={1.7} aria-hidden="true" />
          </div>

          <div className="ks-mode-switch" role="group" aria-label="Extraction mode">
            {EXTRACTION_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                aria-pressed={mode.id === modeId}
                className={`ks-mode-button${mode.id === modeId ? " ks-mode-button--active" : ""}`}
                onClick={() => setModeId(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className={`ks-mode-card ks-mode-card--${classPart(selectedMode.id)}`}>
            <strong>{selectedMode.summary}</strong>
            <dl>
              <div>
                <dt>LLM use</dt>
                <dd>{selectedMode.llmUse}</dd>
              </div>
              <div>
                <dt>Output</dt>
                <dd>{selectedMode.output}</dd>
              </div>
            </dl>
          </div>

          <div className="ks-manifest">
            <div className="ks-manifest-head">
              <Database size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>Scout collection manifest</span>
            </div>
            <pre>{`collection: scout-session
source: harness_observed
ownership: derived_index
extractor:
  mode: ${selectedMode.id}
  focus:
    - decisions
    - files
    - errors
    - next_actions
qmd:
  corpus: markdown
  search: fts5 + fuzzy
  vectors: optional`}</pre>
          </div>
        </aside>
      </section>

      <section className="ks-panel ks-prep-panel">
        <div className="ks-panel-head">
          <div>
            <span className="ks-panel-eyebrow">Back-of-envelope budget</span>
            <h2>What it takes to index a week</h2>
          </div>
          <Database size={16} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <div className="ks-prep-grid" aria-label="Weekly indexing preparation budget">
          {WEEK_PREP_ROWS.map((row) => (
            <article key={row.step} className="ks-prep-card">
              <strong>{row.step}</strong>
              <dl>
                <div>
                  <dt>Input</dt>
                  <dd>{row.input}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>{row.output}</dd>
                </div>
                <div>
                  <dt>Timing</dt>
                  <dd>{row.timing}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="ks-bottom-grid">
        <section className="ks-panel ks-doc-panel">
          <div className="ks-panel-head">
            <div>
              <span className="ks-panel-eyebrow">Derived files</span>
              <h2>QMD-ready corpus</h2>
            </div>
            <CheckCircle2 size={16} strokeWidth={1.7} aria-hidden="true" />
          </div>
          <div className="ks-doc-table" role="table" aria-label="Derived QMD documents">
            <div className="ks-doc-row ks-doc-row--head" role="row">
              <span role="columnheader">Document</span>
              <span role="columnheader">Kind</span>
              <span role="columnheader">Weight</span>
              <span role="columnheader">Refs</span>
            </div>
            {DOC_ROWS.map((doc) => (
              <div key={doc.name} className="ks-doc-row" role="row">
                <span role="cell">{doc.name}</span>
                <span role="cell">{doc.kind}</span>
                <span role="cell">{doc.weight}</span>
                <span role="cell">{doc.refs}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="ks-panel ks-drill-panel">
          <div className="ks-panel-head">
            <div>
              <span className="ks-panel-eyebrow">Evidence</span>
              <h2>Raw transcript drilldown</h2>
            </div>
            <FileSearch size={16} strokeWidth={1.7} aria-hidden="true" />
          </div>
          <div className="ks-drill">
            <div>
              <span>Derived corpus</span>
              <code>{SIDE_CAR_ROOT}</code>
            </div>
            <div>
              <span>Source transcript</span>
              <code>{SESSION_PATH}</code>
            </div>
            <div>
              <span>Drilldown command</span>
              <code>qmd get qmd://scout-session/events-07.md:128 -l 38 --format md</code>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
