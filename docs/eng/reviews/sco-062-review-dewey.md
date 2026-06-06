# Review: SCO-062 QMD Knowledge Search And Context Index

Reviewer: **dewey** (docs/indexing judgment). Scope as requested: QMD as the durable
derived layer, source refs, chunking, FTS + optional embeddings, and keeping generated
collections inspectable.

Grounded against the doc (`docs/eng/sco-062-...md`) **and** the existing prototype
(`design/studio/lib/studio/commands/extract-qmd.ts`, `index-corpus.ts`).

## Verdict

The architecture is sound. QMD-as-durable-spine with rebuildable FTS/vector projections
is the right shape, and the data-ownership boundary is preserved correctly. The gaps are
**not** in the design thesis — they are in the *contracts* that make "durable, rebuildable,
inspectable" actually hold: manifest versioning, deterministic content, stable chunk
identity, and structured source refs. The prototype shows the gaps concretely: the manifest
is `{source, harness, recordsScanned, bytesRead, window, generatedAt}` with no version, and
chunk ids are `INTEGER PRIMARY KEY` autoincrement. Both must change before embeddings or
incremental rebuild land.

Fix the contracts in Phase 1 (the skeleton), not later — they are cheap now and expensive
to retrofit once collections and embeddings exist on disk.

---

## Risks

### QMD as the durable derived layer

- **R1 — No format/version handle (blocker).** Prototype manifest has no `schema`,
  `extractorVersion`, or `chunkPolicyVersion`. The acceptance criterion "the FTS index is
  rebuildable" is unsatisfiable without one: you cannot tell which collections are stale
  after the extractor or chunk policy changes, so every change forces a full global rebuild
  or silent drift. This is the single highest-leverage fix.
- **R2 — "Durable" vs "rebuildable" are in tension for enrichment.** Mechanical QMD is
  cheaply rederivable from source. Phase-3 LLM enrichment (summaries, decisions) is **not** —
  it costs money and is non-deterministic. If the harness JSONL rotates or is deleted, the
  enrichment becomes the *only* copy of real derived work. Treating all QMD as a "throwaway
  projection" risks discarding expensive, unreproducible content. Classify per-document:
  `origin: mechanical` (rebuildable) vs `origin: enrichment` (preserve; has provenance).
- **R3 — Non-deterministic content defeats change detection.** `buildManifest()` writes
  `generatedAt: new Date().toISOString()` *into the content file*. Every re-extract produces
  a different manifest even when nothing changed, so content-hash staleness checks and
  git/diff inspection are both poisoned. Volatile fields (timestamps, timings, host) must be
  segregated from the content identity hash.

### Source refs

- **R4 — Byte ranges into live JSONL are fragile.** `byteRange`/`recordRange` into an
  append-only-but-growing transcript drift when the session is still live or the file is
  rewritten. Drilldown can silently point at the wrong place. Record indices (`r.i`) are more
  stable than byte offsets but only under deterministic parsing. Store a source anchor
  (`sizeBytes` + `mtimeMs` + `contentHash`) so drilldown can detect "source changed since
  indexed" and degrade to a soft match instead of mis-pointing.
- **R5 — Absolute paths are non-portable and leak layout.** Source refs in the prototype
  carry raw `/Users/arach/...`. Even with cross-machine search out of scope, this breaks
  inspectability/reproducibility and couples collections to one home dir. Store
  `{ root: "<TOKEN>", relPath }` against a small set of known roots (home, controlHome, repo
  root) and resolve at read time.
- **R6 — Source ref type mismatch.** The doc's `KnowledgeSourceRef` is a typed tagged union;
  the prototype index stores `source_ref` as a free-text column. Persist refs as structured
  JSON and back them with the proposed `source_refs` table so facet filters and drilldown are
  typed, not string-parsed.

### Chunking

- **R7 — No recorded chunk policy.** Two strategies coexist (350-record event windows;
  H2-section split for markdown) with no `chunkPolicyVersion` on the chunk or document. When
  policy changes you cannot identify stale chunks, and embeddings — which the doc says record
  a chunking version — will silently mismatch the FTS chunks they were supposed to mirror.
- **R8 — Fixed modular windows cut semantic boundaries.** A 350-record window splits a tool
  call from its result, or a question from its answer, hurting both snippet quality and
  embedding quality. Prefer turn/exchange-aligned boundaries with a max-size cap; keep them
  aligned to record indices so re-extraction stays reproducible. At minimum, add small
  overlap or a carried context header per window.
- **R9 — H2-section chunks are unbounded.** One giant section becomes one huge chunk → weak
  FTS snippets and over-limit embedding inputs. Add a `maxChars` cap with deterministic
  sub-splitting and stable ordinals.
- **R10 — Chunk identity is unstable (blocker for embeddings).** `chunks.id INTEGER PRIMARY
  KEY` autoincrement means ids churn on every reindex. Any embedding keyed on chunk id is
  invalidated on every lexical rebuild even when the text is byte-identical — exactly the
  expensive recompute embeddings are supposed to avoid. Use deterministic chunk ids
  (`collectionId + documentPath + ordinal + chunkPolicyVersion`, or a hash of normalized
  text).

### FTS

- **R11 — Tokenizer unspecified; default is wrong for code.** Default FTS5 tokenization
  splits on `_ - . /`, so `snake_case`, `camelCase`, dotted identifiers, and file paths
  tokenize poorly — bad for a developer-knowledge corpus. Choose explicitly: `unicode61` with
  custom `tokenchars`, plus a trigram auxiliary index for substring/path search. Decide
  stemming deliberately (porter helps prose, hurts exact symbol match) — a prose+code split
  or trigram side index avoids picking one loser.
- **R12 — External-content FTS5 can desync.** `content='chunks'` is the right, space-efficient
  choice, but bulk writes that bypass the triggers drift. Document the rebuild
  (`INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')`) and surface an integrity check in
  `scout search status`.
- **R13 — Ranking undefined.** "score" appears with no function. Specify `bm25()` with
  per-column weights, and state that facets are SQL pre-filters, not relevance signals.

### Embeddings

- **R14 — Retrieval skew if FTS and vectors chunk differently.** Embeddings must consume the
  *same canonical chunk text* FTS indexes, or lexical and semantic hits reference divergent
  units. One canonical chunk record, two projections.
- **R15 — Model/dim migration needs coexistence.** Switching providers/models changes
  dimensions. The embeddings table must key on `(chunk_id, provider, model, dim, version)` and
  retain an `input_hash`, so you can (a) keep the old set live while building the new and
  (b) detect when chunk text changed under a fixed model. One-vector-per-chunk will force
  destructive rebuilds.
- **R16 — Vector store unstated.** `better-sqlite3` has no native vector search. At local
  scale (<~100k chunks) brute-force cosine over blobs in `knowledge.sqlite` is fine — say so,
  or commit to `sqlite-vec`. Keep vectors in the rebuildable index, never in
  `control-plane.sqlite`.

### Inspectability

- **R17 — Prototype output is ephemeral.** QMD lands in `$TMPDIR/scout-study/qmd` and the
  index in `$TMPDIR/.../index.db` — wiped on reboot. The doc's `controlHome/knowledge/qmd` is
  right; flag the tmp→controlHome move as a real migration, and add `scout search status
  --paths` (or `scout search where`) so the on-disk location is discoverable.
- **R18 — "Inspectable" requires a human entry point that the prototype doesn't emit.** The
  doc's recommended shape includes `overview.md`, `source-refs.md`, `facets.md`; the
  extractor emits only `manifest.json`, `files.md`, `tool-calls.md`, `events-NNN.md`. Make
  `overview.md` mandatory and generated — a human opening a collection cold should understand
  it without the DB.
- **R19 — Partial writes have no guard.** Files are written directly; a crash mid-build
  leaves a half-written collection that the indexer will happily ingest. Add a manifest
  `status: building | ready | failed` and write-temp-then-atomic-rename.
- **R20 — No GC / orphan policy.** Durable QMD + rebuildable index accumulates collections for
  sessions that no longer exist or were superseded. Track `sourceState: live | complete |
  gone` and expose orphan/stale reporting + a prune command in `status`.

### Cross-cutting

- **R21 — Evidence strength must be visible.** A hit citing an LLM-summarized "decision" is
  weaker evidence than a raw transcript range. Record `origin`/`ownership` per document (not
  just per hit) and let the UI/snippet distinguish mechanical extraction from inference. This
  is both a trust and a data-ownership concern (the `derived` label in `data-ownership.md`).
- **R22 — Separate DB from day one (answers an open decision).** Churny FTS writes + WAL +
  optional large vector blobs argue strongly against `control-plane.sqlite`. Keep
  `knowledge.sqlite` separate immediately; the "start in control-plane" option in Open
  Decisions is the higher-risk path.

---

## Recommended manifest conventions

A single versioned `manifest.json` per collection. Identity (hashable) is segregated from
volatile metadata.

```jsonc
{
  "schema": "openscout.knowledge.collection/v1",   // namespaced + versioned (R1)
  "collectionId": "sessions/claude/<sessionId>",   // <kind>/<adapter-stable-id>, namespaced (R-naming)
  "kind": "sessions",
  "title": "Claude — refactor knowledge index (2026-05-26)",

  "generator": {                                   // volatile: excluded from contentHash (R3)
    "extractorVersion": "1.4.0",
    "generatedAt": "2026-06-04T12:00:00Z",
    "host": "arachs-mac-mini"                       // debug only
  },

  "source": {                                      // structured, portable ref (R5, R6)
    "kind": "harness_transcript",
    "harness": "claude",
    "ref": { "root": "CLAUDE_HOME", "relPath": "projects/<x>/<session>.jsonl" },
    "sessionId": "<sessionId>",
    "sizeBytes": 55512345,                          // source anchor for drift detection (R4)
    "mtimeMs": 1748000000000,
    "contentHash": "sha256:…",
    "recordsScanned": 12009,
    "sourceState": "complete"                       // live | complete | gone (R20)
  },

  "chunking": {                                    // recorded policy, versioned (R7,R9)
    "events":   { "strategy": "record-window", "window": 350, "overlap": 0, "maxChars": 8000, "version": 2 },
    "markdown": { "strategy": "h2-section", "maxChars": 4000, "version": 1 }
  },

  "documents": [                                   // per-doc origin + provenance (R2,R21)
    { "path": "overview.md",   "kind": "overview",  "origin": "mechanical", "bytes": 1024,  "chunks": 1,  "contentHash": "sha256:…" },
    { "path": "events-001.md", "kind": "events",    "origin": "mechanical", "bytes": 40000, "chunks": 6,  "contentHash": "sha256:…" },
    { "path": "decisions.md",  "kind": "decisions", "origin": "enrichment", "bytes": 2000,  "chunks": 3,  "contentHash": "sha256:…",
      "provenance": { "model": "claude-…", "promptVersion": "dec@3", "generatedAt": "…", "inputChunkIds": ["…"], "costTokens": 4200 } }
  ],

  "facets": { "harness": "claude", "project": "openscout", "dateRange": ["2026-05-26", "2026-05-26"] },

  "ownership": "derived",                          // scout_owned | derived | observed_source
  "contentHash": "sha256:…",                       // over {source.contentHash, chunking, documents[].contentHash, versions} — NOT generatedAt (R3)
  "status": "ready"                                // building | ready | failed (R19)
}
```

Rules:

1. **`schema` is mandatory and versioned.** Bump on any breaking format change; the indexer
   refuses or migrates unknown majors.
2. **`contentHash` excludes volatile fields.** Same source bytes + same versions → same hash,
   so staleness is a cheap comparison and the manifest diffs cleanly in git.
3. **`origin` per document.** Mechanical = safe to delete and rebuild. Enrichment = carries
   `provenance` and is treated as preservable derived content.
4. **Source refs are `{root, relPath}` + an anchor (`sizeBytes`/`mtimeMs`/`contentHash`)** —
   never bare absolute paths, always enough to detect source drift.
5. **`status` + atomic rename** so half-built collections are never indexed.
6. **`sourceState`** drives GC/prune; `status status --paths` prints the on-disk root.

## Recommended doc / collection conventions

- **Directory = `<kind>/<stable-id>`** so adapters (sessions, skills, mcp, codebase,
  context-packs) share one namespace without id collisions. Matches the doc's `KnowledgeCollection.kind`.
- **Mandatory files:** `manifest.json` + `overview.md` (human entry point) + `source-refs.md`
  (or fold refs into the manifest, but keep one of the two). Everything else is adapter
  optional, as the doc's table already lays out.
- **Every markdown doc is self-describing.** Start each with an H1 and a `Source:` line citing
  the canonical ref + record/line range, so a doc opened *outside* the DB is still traceable
  back to authority. This is what makes "inspectable on disk" real rather than nominal.
- **Stable, zero-padded ordinals** (`events-001.md`) — already done; keep it, and apply the
  same to sub-split markdown chunks.
- **`_`-prefixed files are internal/non-indexed.** The indexer already skips them
  (`fileName.startsWith("_")`); promote that to a documented convention for enrichment
  scratch (`_llm-call.json`, etc.).
- **Embed chunk boundaries in the QMD itself** (an HTML comment carrying the chunk's
  `source_ref`) so the markdown remains the source of truth for chunking and the SQLite index
  is fully regenerable from disk — the literal meaning of "rebuildable projection."
- **Deterministic chunk ids** (`collectionId + documentPath + ordinal + chunkPolicyVersion`)
  so embeddings survive lexical reindex (R10).

## Quick answers to Open Decisions

- **`knowledge.sqlite` separate from control-plane?** Yes — from day one (R22).
- **QMD path?** `controlHome/knowledge/qmd/<kind>/<id>` as proposed, namespaced by kind.
- **Default adapter after sessions?** Skills first (cheap, high agent value, small corpus),
  then MCP/capabilities; codebase stays conservative/opt-in as the doc says.
- **First embedding backend?** A local provider (honors local-first + opt-in cost) behind the
  DI interface, with remote as a configured option — not a hosted default.
