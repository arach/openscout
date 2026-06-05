# SCO-062: QMD Knowledge Search And Context Index

## Status

Proposed.

## Proposal ID

`sco-062`

## Intent

Define a Scout-native knowledge search and context index that uses QMD-style
derived documents as its durable spine, then builds lexical search, metadata
filters, optional embeddings, chat retrieval, and context-pack forking on top.

The goal is broader than session history search. Session transcripts are the
first source adapter because the current pain is finding prior conversations
without scanning large JSONL files. The same substrate should also support
skills, MCP/tool capabilities, codebase context, extension packs, and
Contextual-style reusable session templates.

## Context

The current session-search prototype already proved a useful pipeline:

- parse Codex and Claude JSONL into normalized records
- emit QMD-style markdown sidecars such as `manifest.json`, `files.md`,
  `tool-calls.md`, and `events-NNN.md`
- build a SQLite FTS5 index over chunks of those derived documents
- optionally enrich selected sessions with summaries and decisions

See [`sco-059`](./sco-059-session-knowledge-search-exploration.md) for the
session-focused exploration and local sizing sample. That document remains the
best description of the immediate use case.

The next step should not be a narrowly named `session-search` package. The
search surface is becoming a general way to navigate local developer knowledge:

- Which recent session discussed a topic?
- Which skill should an agent load for this task?
- Which MCP server or tool exposes this capability?
- Which code files or docs matter for this API?
- Which reusable context pack should a new session fork from?

These questions share a shape: discover source material, normalize it into
derived QMD documents, index the documents, retrieve chunks with stable source
refs, and drill back to authority when exact evidence matters.

## Decision

Scout SHOULD introduce a generic knowledge subsystem backed by QMD collections.

This remains the right scope for `sco-062`; do not split the storage, API, and
indexing decisions into a second proposal. The needed work is to tighten this
proposal's contracts before implementation, not to create a new architecture.

The first implementation SHOULD live inside `packages/runtime` as a
broker-hosted internal subsystem, not as several new packages. In other words,
the broker process is the product owner and API boundary, while the runtime
package is the implementation home because it already contains the broker
daemon, support-path handling, tail discovery, and SQLite control-plane code.

```text
packages/runtime/src/knowledge/
|-- index.ts
|-- types.ts
|-- qmd/
|-- query/
|-- adapters/
|   |-- sessions.ts
|   |-- skills.ts
|   |-- mcp.ts
|   |-- codebase.ts
|   `-- context-packs.ts
|-- stores/
|   `-- sqlite.ts
`-- embeddings/
    `-- provider.ts
```

If the subsystem later needs to be reused outside runtime, it MAY be extracted
as one package, for example `@openscout/knowledge`. It SHOULD NOT split into
separate public packages for sessions, embeddings, QMD, skills, and context
packs in the first product phase.

The first product slice SHOULD focus on session search only. Skills, MCP,
codebase docs, embeddings, saved searches, and context packs should remain
designed-for but not implemented until the QMD, source-ref, job, and API
contracts are stable.

## Product Thesis

Search should become a retrieval and launch layer for local agent work, not just
a log finder.

The useful primitive is a searchable collection with source anchors and context
intent. A collection can represent a week of harness sessions, installed skills,
MCP tools, relevant repository docs, or a curated context pack. The user or an
agent should be able to search across those collections, inspect why a result
matched, and either drill into the source or launch/fork a new session from the
retrieved context.

QMD is the durable derived knowledge layer. FTS, vector embeddings, facets, and
chat retrieval are rebuildable projections over QMD. Raw source material remains
the authority for exact evidence.

## Core Pipeline

```text
source material
  -> adapter normalization
  -> QMD collection
  -> lexical index
  -> optional embedding index
  -> search, chat, fork, and drilldown
```

### Source Material

Source material can include:

- Codex and Claude JSONL sessions
- Scout-owned messages, invocations, flights, work items, and checkpoints
- skills and slash-command definitions
- MCP server tool schemas and capability metadata
- project docs and selected codebase context
- extension packs and project overlays
- Contextual-style reusable session templates or context packs

Each source remains owned by its native system. The knowledge subsystem reads,
references, and derives from it.

### QMD Collection

A QMD collection is a derived document directory with a manifest and one or more
markdown documents. A collection is durable and inspectable, but it is not the
canonical source for external systems.

Recommended common shape:

```text
collection/
|-- manifest.json
|-- overview.md
|-- source-refs.md
|-- facets.md
`-- chunks/
    |-- chunk-001.md
    `-- chunk-002.md
```

Adapters MAY add domain-specific documents:

| Adapter | Example QMD documents |
| --- | --- |
| sessions | `events-NNN.md`, `files.md`, `tool-calls.md`, `decisions.md` |
| skills | `capability.md`, `triggers.md`, `examples.md` |
| MCP/tools | `tools.md`, `schemas.md`, `use-cases.md` |
| codebase | `docs.md`, `symbols.md`, `files.md`, `routes.md` |
| context packs | `purpose.md`, `included-context.md`, `fork-policy.md` |

### QMD V1 Contract

The first implementation MUST define a small versioned QMD contract before
porting the prototype extractor. This is the root-cause fix for later rebuild,
embedding, and drilldown problems.

Each collection manifest MUST include:

- `schema`, for example `openscout.knowledge.collection/v1`
- `collectionId` in a namespaced form such as `<kind>/<stable-id>`
- `kind`, `title`, `createdAt`, and `updatedAt`
- generator metadata, including `extractorVersion`
- source metadata with structured refs and source anchors
- chunking metadata, including `chunkPolicyVersion`
- document inventory with `origin` and `contentHash`
- collection `contentHash` that excludes volatile fields such as generated time
- collection `status`: `building`, `ready`, or `failed`
- ownership/provenance labels

QMD writes MUST be atomic enough that partially built collections are not
indexed. Build into a temporary directory or `status: building`, then atomically
promote to `ready` only after all documents and manifest content are complete.

Chunk ids MUST be deterministic. Do not use SQLite autoincrement ids as the
stable identity for a chunk. A valid first policy is:

```text
sha256(collectionId + documentPath + ordinal + chunkPolicyVersion + normalizedTextHash)
```

This keeps FTS rebuilds, embeddings, inspect routes, and saved references stable
when byte-identical chunks survive a reindex.

Markdown documents SHOULD be self-describing when opened outside Scout:

- begin with an H1
- include a short source/provenance line
- keep stable zero-padded ordinals for generated event windows
- use `_`-prefixed files for non-indexed scratch/internal material

Mechanical extraction and LLM enrichment are different document origins:

- `mechanical` documents are cheaply rebuildable from source material
- `enrichment` documents are derived Scout-owned work products with model,
  prompt, input chunk, generated-at, and cost provenance

Search results must surface this difference so a user can tell raw mechanical
evidence from inferred summaries or decisions.

### Lexical Index

SQLite FTS5 SHOULD be the default first search engine.

It is local-first, cheap to build, good enough for exact/fuzzy lookup, and easy
to rebuild from QMD. The first version should optimize for usefulness before
embedding complexity:

- exact phrase and fuzzy-ish topic lookup
- facet filters by source type, project, harness, skill, provider, file path,
  date range, and freshness
- snippets and source refs
- sub-100ms query latency over common local corpora

The FTS table SHOULD use an explicit tokenizer and ranking policy. The default
SQLite tokenizer is a poor fit for developer text because paths, dotted names,
snake_case, and dashed identifiers matter. The first implementation SHOULD
choose `unicode61` deliberately, document token characters/stemming choices, and
add a trigram or equivalent side path if substring/path search is needed. Ranking
SHOULD be expressed as `bm25()` with documented column weights; facets should be
SQL filters, not implicit relevance signals.

### Embedding Index

Embeddings SHOULD be designed into the pipeline but remain optional.

The embedding layer should:

- embed selected QMD chunks, not raw source files
- record provider, model, dimensions, chunking version, and generated-at time
- support rebuild when provider, model, or chunk policy changes
- allow local or remote embedding providers through dependency injection
- stay disabled by default until the user enables semantic search

Embeddings are valuable for vague recall and cross-vocabulary matching, but they
should not block the first useful product slice.

### Retrieval And Drilldown

Every search hit SHOULD include:

- collection id
- source type
- source ref
- chunk id and score
- snippet
- freshness metadata
- ownership label: `scout_owned`, `derived`, or `observed_source`
- drilldown target, such as transcript path plus record range, skill path,
  MCP schema path, code file path, or context-pack manifest

The user should be able to ask a conversational question over the derived
corpus, but answers should cite QMD chunks and preserve raw drilldown for
confidence-sensitive cases.

## Data Ownership

This proposal preserves the existing Scout boundary from
[`data-ownership.md`](../data-ownership.md).

Separate three classes explicitly:

1. **Canonical Scout-owned records.** User-created saved searches, curated
   context packs, indexing schedules, and explicit knowledge preferences are
   broker-owned product records when they exist. They require broker write APIs
   and migrations like other Scout-owned records.
2. **Durable derived knowledge.** QMD documents, chunks, source refs, facets,
   and enrichments are Scout-generated derived artifacts. They are durable and
   inspectable, but they are not the authority for external source material.
3. **Rebuildable projections.** FTS rows, vector rows, rank metadata, and most
   job scratch state are projections over QMD and source refs.

Scout owns or controls:

- knowledge collection metadata
- generated QMD documents
- chunk records
- FTS/vector projections
- source references
- user-created saved searches and curated context packs
- derived summaries, labels, facets, and enrichment records

Scout observes or references:

- harness transcript JSONL
- skill source files
- MCP schemas and tool metadata
- codebase files and docs
- extension pack contents
- external Contextual assets

The subsystem MUST NOT bulk-import external harness turns as Scout messages.
It MUST NOT treat observed source material as broker-owned conversation state.
It also MUST NOT use QMD as a disguised full transcript warehouse. Session QMD
should be bounded, chunked, provenance-rich derived material for search and
drilldown; exact evidence remains the raw source ref unless a workflow
explicitly creates a Scout-owned summary, decision, note, or context pack.

## Storage Model

The first implementation SHOULD use the OpenScout support directory and keep
knowledge storage separate from canonical control-plane tables unless a table is
explicitly broker-owned metadata.

Recommended shape:

```text
$OPENSCOUT_CONTROL_HOME/
|-- control-plane.sqlite
`-- knowledge/
    |-- qmd/
    |   `-- <kind>/
    |       `-- <stable-id>/
    `-- knowledge.sqlite
```

`knowledge.sqlite` is a rebuildable index and metadata store. It should not
become a second canonical broker database.

Keep `knowledge.sqlite` separate from `control-plane.sqlite` from day one. FTS
churn, optional vector blobs, rebuilds, and WAL behavior should not compete with
the canonical broker coordination database. If future saved searches, schedules,
or curated context packs become durable first-party product records, add them as
explicit broker-owned metadata rather than smuggling them into rebuildable index
tables.

Runtime should expose support-path helpers for:

- `knowledgeRoot`
- `knowledgeQmdRoot`
- `knowledgeSqlitePath`
- per-collection QMD paths

Initial session-search tables:

- `collections`
- `documents`
- `chunks`
- `chunks_fts`
- `facets`
- `source_refs`
- `index_jobs`

The `embeddings` table is deferred until semantic search is enabled. When it is
added, it should key by `(chunk_id, provider, model, dimensions,
chunk_policy_version, input_hash)` so model migrations and lexical rebuilds do
not invalidate byte-identical chunks unnecessarily.

## Broker-Hosted Runtime Boundary

The subsystem lives in `packages/runtime`, but the broker process owns the
product boundary. That means:

- broker APIs admit index/query/inspect requests
- broker configuration and feature flags decide what can run
- broker-owned job state records status, leases, progress, cancellation, and
  failures
- runtime implementation code performs source discovery, QMD extraction,
  indexing, cache reads, and rebuilds
- permission and data-ownership checks happen before source reads, drilldown, or
  launch/fork actions

Indexing MUST NOT run as ambient background work by default. It should run only
from an explicit user action, broker config, or an explicit schedule.

Job execution should use broker-style durable semantics: a job has an id, state,
lease owner, lease generation, progress counters, checkpoints where useful, and
terminal state. Stale workers must not be able to overwrite a newer lease's
terminal result.

The web UI should not import indexer code directly. It should call broker APIs.

The CLI should expose the same broker-backed operations:

```bash
scout search status
scout search index --source sessions --days 7
scout search index --source skills
scout search query "raw log drilldown"
scout search inspect <hit-id>
```

## API Sketch

Broker HTTP routes should exist before web/CLI wiring:

| Route | Meaning |
| --- | --- |
| `GET /v1/knowledge/status` | index paths, sizes, collection counts, stale/orphan counts, active jobs |
| `POST /v1/knowledge/index` | enqueue or run an indexing job and return a job receipt |
| `GET /v1/knowledge/jobs/:jobId` | inspect job state/progress/failure |
| `POST /v1/knowledge/query` | query compact hits from the built index |
| `GET /v1/knowledge/inspect/:hitOrChunkId` | resolve QMD preview and typed raw drilldown |

The CLI and web server should relay through these broker routes. `inspect` can
return a local file/path drilldown for a trusted local surface, but the broker
should not blindly open arbitrary paths as a side effect of search.

```ts
export interface KnowledgeCollection {
  id: string;
  kind: "sessions" | "skills" | "mcp" | "codebase" | "context_pack" | "mixed";
  title: string;
  sourceRefs: KnowledgeSourceRef[];
  qmdPath: string;
  status: "building" | "ready" | "failed";
  contentHash: string;
  extractorVersion: string;
  chunkPolicyVersion: string;
  createdAt: number;
  updatedAt: number;
  facets: Record<string, string | string[]>;
}
```

```ts
export interface KnowledgeChunk {
  id: string;
  collectionId: string;
  documentId: string;
  documentPath: string;
  ordinal: number;
  text: string;
  textHash: string;
  origin: "mechanical" | "enrichment";
  ownership: "scout_owned" | "derived" | "observed_source";
  sourceRefs: KnowledgeSourceRef[];
  facets: Record<string, string | string[]>;
}
```

```ts
export interface KnowledgeSourceAnchor {
  sizeBytes?: number;
  mtimeMs?: number;
  contentHash?: string;
}

export interface KnowledgePortablePath {
  root: "HOME" | "OPENSCOUT_CONTROL_HOME" | "OPENSCOUT_SUPPORT_DIRECTORY" | "PROJECT_ROOT" | "ABSOLUTE";
  relPath: string;
}

export type KnowledgeSourceRef =
  | { kind: "harness_transcript"; harness: string; path: KnowledgePortablePath; sessionId?: string; recordRange?: [number, number]; byteRange?: [number, number]; anchor?: KnowledgeSourceAnchor }
  | { kind: "scout_record"; recordKind: string; id: string }
  | { kind: "skill"; path: KnowledgePortablePath; skillName?: string; anchor?: KnowledgeSourceAnchor }
  | { kind: "mcp_tool"; serverId: string; toolName: string; schemaPath?: string }
  | { kind: "file"; path: KnowledgePortablePath; lineRange?: [number, number]; anchor?: KnowledgeSourceAnchor }
  | { kind: "context_pack"; path: KnowledgePortablePath; packId?: string; schemaVersion?: string; anchor?: KnowledgeSourceAnchor };
```

```ts
export interface KnowledgeSearchQuery {
  q: string;
  collections?: string[];
  sourceKinds?: KnowledgeCollection["kind"][];
  facets?: Record<string, string | string[]>;
  limit?: number;
  mode?: "lexical" | "semantic" | "hybrid";
}
```

```ts
export type KnowledgeDrilldown =
  | { kind: "qmd"; collectionId: string; documentPath: string; chunkId?: string }
  | { kind: "harness_transcript"; sourceRef: Extract<KnowledgeSourceRef, { kind: "harness_transcript" }> }
  | { kind: "file"; sourceRef: Extract<KnowledgeSourceRef, { kind: "file" | "skill" | "context_pack" }> }
  | { kind: "scout_record"; sourceRef: Extract<KnowledgeSourceRef, { kind: "scout_record" }> }
  | { kind: "mcp_tool"; sourceRef: Extract<KnowledgeSourceRef, { kind: "mcp_tool" }> };

export interface KnowledgeSearchHit {
  id: string;
  collectionId: string;
  documentId: string;
  chunkId: string;
  title: string;
  snippet: string;
  score: number;
  scoreSource: "fts" | "vector" | "hybrid";
  origin: "mechanical" | "enrichment";
  ownership: "scout_owned" | "derived" | "observed_source";
  freshness: "fresh" | "stale" | "source_missing" | "unknown";
  sourceRefs: KnowledgeSourceRef[];
  drilldown: KnowledgeDrilldown[];
  facets: Record<string, string | string[]>;
}
```

```ts
export interface KnowledgeIndexRequest {
  source: "sessions" | "skills" | "mcp" | "codebase" | "context_pack";
  days?: number;
  collections?: string[];
  force?: boolean;
  mode?: "foreground" | "background";
}

export interface KnowledgeIndexJob {
  id: string;
  source: KnowledgeIndexRequest["source"];
  state: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  leaseOwner?: string;
  leaseGeneration: number;
  progress: {
    discovered?: number;
    extracted?: number;
    indexed?: number;
    failed?: number;
  };
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
}
```

## Source Adapters

### Sessions

The sessions adapter is the first implementation target.

Inputs:

- `getTailDiscovery()` transcript inventory
- Codex and Claude JSONL files
- optional Scout-owned invocation/message refs

Outputs:

- session-level QMD manifest
- event window markdown
- file path catalog
- tool-call catalog
- generated `overview.md`
- optional decisions enrichment after the first mechanical slice
- structured source refs with portable transcript path, harness, session id,
  record range, byte offsets where available, and source anchors for drift
  detection

The first sessions slice should index only mechanical extraction. LLM-generated
overview/decisions enrichment should be added later as opt-in job work with
provenance.

### Skills

The skills adapter should index installed skills and project-local skill
exports from extension packs.

Outputs:

- capability summary
- trigger phrases
- usage examples
- source refs to `SKILL.md`
- facets for skill name, provider, project applicability, and activation terms

This lets agents ask "is there a skill for X?" through the same search surface
instead of hardcoding a separate skill finder.

### MCP And Capabilities

The MCP adapter should project tool schemas into QMD and align with
[`sco-040`](./sco-040-capability-registry-and-tool-boundaries.md).

Outputs:

- server summary
- tool list
- input/output schema summaries
- effect and enforcement metadata
- source refs to MCP server/tool records

Search results should distinguish "this tool exists" from "this actor may use
this tool now." Permission evaluation remains broker/capability-registry work.

### Codebase

The codebase adapter should be conservative in v1.

It SHOULD index docs and explicit context roots first, not the entire repository
by default. Code symbol extraction can follow once file selection and freshness
policies are stable.

Potential sources:

- `README.md`
- `docs/`
- `llms.txt`
- selected package READMEs
- generated agent docs
- explicit user-selected files or globs

### Context Packs

Context packs represent forkable prepared sessions or reusable work states.
They are related to [`sco-049`](./sco-049-session-forking-and-excellent-session-states.md),
but higher level.

A context pack can describe:

- purpose
- intended task class
- recommended model/profile/harness
- included docs and source refs
- required skills
- useful MCP capabilities
- prompt fragments
- workspace assumptions
- permission posture
- fork policy

Search should make context packs discoverable, then runtime can launch or fork a
session from the chosen pack.

## Performance And Resource Policy

Idle overhead SHOULD be near zero.

The subsystem should not scan or embed in the background unless the user, broker
configuration, or an explicit schedule enables it. Indexing should be resumable
and observable.

Initial budgets for a heavy local week from `sco-059`:

| Stage | Input | Target |
| --- | --- | --- |
| Inventory | hundreds of files | 1-5s |
| Mechanical QMD extraction | hundreds of MiB JSONL | minutes, streamed |
| FTS index | tens of MiB QMD | minutes |
| First useful query | local SQLite index | under 100ms |
| LLM enrichment | selected chunks | async and optional |
| Embeddings | selected chunks | opt-in and resumable |

Memory policy:

- stream source files
- bound per-file buffers
- do not load large JSONL files into memory
- batch SQLite writes
- chunk before enrichment or embedding

Disk policy:

- QMD collections and indexes are rebuildable
- raw source is not copied
- embedding storage is optional
- expose index size in `scout search status`

## User Surfaces

### Web

The existing Search screen should evolve from static concept view to operational
surface:

- index status
- source toggles
- build/refresh controls
- query box
- facet filters
- ranked results
- QMD preview
- raw drilldown
- context-pack fork action

### CLI

The CLI should make the subsystem scriptable and agent-friendly:

```bash
scout search status --json
scout search index --source sessions --days 7
scout search query "which conversation discussed QMD embeddings?" --json
scout search inspect <hit-id>
```

### MCP

Scout MCP should eventually expose:

- `knowledge_search`
- `knowledge_status`
- `knowledge_index`
- `knowledge_inspect`
- `context_pack_search`
- `context_pack_fork`

Those tools should return compact hits and source refs, not bulk QMD documents
by default.

## Scope

In scope:

- generic knowledge subsystem inside runtime
- QMD collection format and manifest shape
- session transcript adapter as the first source
- FTS5 lexical index
- source refs and raw drilldown
- search status and query APIs
- web Search surface wired to real broker data
- design for optional embeddings
- follow-on adapters for skills, MCP/capabilities, codebase docs, and context
  packs
- resource budgets and opt-in background policy

Out of scope for the first slice:

- saved searches and canonical user-created context packs
- skills, MCP/capability, codebase, and context-pack adapters
- LLM enrichment by default
- publishing multiple new npm packages
- indexing every file on disk by default
- embedding all historical chunks automatically
- importing external transcript turns as Scout messages
- replacing MCP permission evaluation
- enterprise audit/compliance guarantees
- cross-machine replicated search indexes
- perfect semantic answer generation over all local history

## Implementation Plan

### Phase 0: Proposal And Team Alignment

1. Accept this proposal as the broad architecture target after adding the
   broker/runtime, storage, job, and QMD contract clarifications above.
2. Keep `sco-059` as the session-search evidence and sizing appendix.
3. Treat first implementation as session search only.

### Phase 1: Internal Knowledge Skeleton

1. Add `packages/runtime/src/knowledge`.
2. Add support-path helpers for `controlHome/knowledge`, QMD root, and
   `knowledge.sqlite`.
3. Define collection, manifest, document, chunk, source-ref, query, hit,
   inspect, status, and job types.
4. Define the QMD v1 manifest contract, deterministic chunk ids, portable source
   refs, and atomic write policy.
5. Add `KnowledgeStore` over separate `knowledge.sqlite` with session-search
   tables.
6. Add tests with small Codex and Claude fixtures.
7. Keep the existing Studio commands either as thin callers or delete them after
   product wiring lands.

### Phase 2: Session Search Product Slice

1. Discover recent transcript files through the runtime tail inventory.
2. Build QMD collections for selected sessions.
3. Build `knowledge.sqlite` with FTS5 chunks and source refs.
4. Add broker APIs for status, index, query, and inspect.
5. Wire `KnowledgeSearchScreen` to real data.
6. Support raw drilldown to existing session/tail views.
7. Add CLI commands for `scout search status`, `index`, `query`, and `inspect`.

### Phase 3: Optional Enrichment And Embeddings

1. Add async enrichment jobs over selected QMD chunks.
2. Store derived overview, decisions, files, problems, and next-action docs.
3. Add embedding provider interface.
4. Add opt-in semantic and hybrid search.
5. Show cost, freshness, and provider metadata in status.

### Phase 4: Skills And MCP Adapters

1. Index installed skills as QMD collections.
2. Index MCP/capability registry metadata.
3. Add search facets for skill triggers, capability provider, effect, and
   enforcement.
4. Let agents use the search API to discover relevant skills/tools before
   asking the user or scanning files.

### Phase 5: Context Packs

1. Define context-pack QMD/manifest shape.
2. Index curated context packs.
3. Add fork/launch actions that bridge to session policy from `sco-049`.
4. Support Contextual-style prepared sessions as an explicit source adapter
   without making Contextual a hard dependency.

## Workstreams

| Workstream | Owner role | Output |
| --- | --- | --- |
| Architecture | runtime/broker reviewer | Confirm storage, package boundary, APIs, and data ownership |
| Session adapter | indexing implementer | Port parser/QMD/FTS prototype into runtime with fixtures |
| Product surface | web/UI implementer | Turn Search screen into operational index/query surface |
| Context packs | Contextual/product reviewer | Align reusable session templates with QMD collection model |
| Skills and MCP | capability reviewer | Align skills/tool search with capability registry and pack model |

## Acceptance Criteria

- The first product slice can answer "which recent session was about this
  topic?" without scanning raw JSONL at query time.
- Session hits include stable QMD chunks and raw transcript source refs.
- Chunk ids are deterministic across byte-identical rebuilds.
- Source refs are structured, portable, and include enough anchor metadata to
  detect stale or missing raw sources.
- QMD collections are inspectable on disk.
- QMD writes are atomic enough that partial collections are not indexed.
- QMD manifests carry schema, extractor, content-hash, and chunk-policy
  versions.
- The FTS index is rebuildable and does not become canonical control-plane
  state.
- Broker APIs exist for status, index, job inspection, query, and inspect.
- Index jobs expose state/progress and protect terminal writes with lease
  generation or equivalent stale-worker checks.
- Idle overhead is effectively zero when indexing is not running.
- Embeddings are possible through the same chunk model but disabled by default.
- The architecture can add skills, MCP, codebase docs, and context packs without
  creating multiple new public packages.
- The web Search surface reads broker APIs, not filesystem/index internals.

## Decisions Taken For First Implementation

- Keep this as `sco-062`; revise in place rather than writing a new proposal.
- Keep first implementation inside `packages/runtime` as a broker-hosted
  subsystem.
- Store QMD under `$OPENSCOUT_CONTROL_HOME/knowledge/qmd/<kind>/<stable-id>`.
- Keep `knowledge.sqlite` separate from `control-plane.sqlite` from day one.
- Ship session search first; no default skills/MCP/codebase/context-pack
  indexing in the first slice.
- Keep embeddings disabled by default and behind dependency-injected providers.

## Remaining Open Decisions

- Which source adapters are enabled by default after sessions: skills only, or
  skills plus MCP/capabilities?
- What is the minimum manifest schema needed before context packs can launch
  forked sessions?
- Which embedding provider should be the first supported opt-in backend?
- Should skill and MCP search be exposed as separate UI filters or a unified
  "capabilities" source group?
