# Session search checkpoint 1 — architecture review (Fable)

Reviewed 2026-08-03 against the code on `codex/delivery-campaign-source`:
`packages/runtime/src/knowledge/session-indexer.ts`, `store.ts`,
`apps/desktop/src/cli/commands/search.ts`, the kimi fixture test, and the
SCO-062 contract language. Unit suite green (3 pass).

**Verdict: architecture approved.** The shape is right — explicit warm-up,
observed transcripts normalized into shared mechanical kinds, one QMD/chunk
pipeline, derived-only ownership. No wrong turns. Two must-fixes inside the
current slice, both small.

## Q1 — CLI → runtime direct, or broker boundary now?

Keep CLI → runtime direct for v1. SCO-062 makes the broker the *product*
boundary, but the semantics that boundary exists to protect are already in the
store layer: durable job rows with lease generations and stale-job failing,
WAL, and the building→ready protocol (publish with empty `contentHash`, land
the ready row only after every chunk batch commits — session-indexer.ts:1128).
That crash-safety design is genuinely good; moving to broker HTTP later is a
transport change, not a semantics change. Don't pay the boundary tax before a
second client exists.

Two conditions on that call:

1. **Must-fix: query/status open the writable store.** `runStatus`
   (search.ts:130) and `runQuery` (search.ts:294) call
   `new SQLiteKnowledgeStore()` with no options, which runs DDL, creates
   directories, and — worse — can trigger `migrateFtsRowids()`, a full FTS
   rebuild, from a read path. The readonly constructor already exists and is
   built for exactly this (store.ts:381–402, snapshot reads, in-memory empty
   fallback) but nothing uses it. Pass `{ readonly: true }` on both read
   paths. This is also what makes CLI-direct safe next to a broker process
   holding the same DB.

2. **Write-path drift.** The web route child
   (`packages/web/server/knowledge-index-child.ts`, serving
   `/api/knowledge/sessions/index`) accepts only `days`/`limit`/`force` — it
   predates `hours` and `harness`. Two explicit write paths with different
   capability sets will confuse an operator who warmed via web and queries via
   CLI. Extend the child's input type (it just forwards to
   `indexRecentSessionKnowledge`, so it's a type widening) or note the lag.

## Q2 — Kimi normalization / discovery roots

Sound overall. Discovery (only `wire.jsonl`; cwd/title from `state.json`;
subagent identity as `parent:agentId`) is right. Flags, one of them a
verify-before-trusting item:

- **Verify: assistant text double-indexing.** If a real kimi wire contains
  both streamed `content.part` text events *and* a finalizing
  `context.append_message` with role assistant for the same turn, that text is
  indexed twice — inflating BM25 for assistant vocabulary and doubling
  assistant-turn counts in overview.md. Check one real wire; if both forms
  appear, keep one (probably `append_message`) and demote the other to
  `system_record`.
- **The checkpoint's think claim doesn't match the code.** The doc says
  "skipping think / short system marker", but session-indexer.ts:536 keeps the
  *full* think text on the record, and `summarizeRecord` puts up to 180 chars
  of it into searchable event documents. Persisting reasoning excerpts into a
  durable index is a legitimate choice — but make it deliberately, not as a
  side effect. If the marker is what you want, drop `text` and keep the tag.
- **Streaming granularity.** Each text `content.part` becomes its own
  `assistant_turn`, so "Latest Assistant Context" in overview.md can be a
  mid-stream fragment. Cheap later fix: coalesce consecutive assistant parts.
- **Unused title.** `readKimiSessionState` reads `state.json`'s `title` but
  `titleFor` ignores it and reconstructs a title from the first user turn.
  Kimi is the one harness that gives you a real session title — prefer it.

## Q3 — OR vs AND for multi-term FTS

OR + BM25 approved over strict AND — AND fail-closed on natural phrases was
the worse failure. But the better default is **AND first, fall back to OR on
zero rows**: two queries max, keeps precision whenever it's available, fails
open on recall. Pure OR means "iOS build steps" matches every chunk containing
"steps"; BM25's idf keeps ranking sane at today's index sizes, but the noise
floor rises with the corpus, and title matches (collection titles carry
project names and dates) amplify it. NEAR / hybrid can wait; the AND→OR
fallback is ~10 lines in `normalizeFtsQuery`/`searchLexical`.

## Q4 — Next checkpoint before more surface area

**Span/freshness honesty in the query path.** The cold-index error only fires
when the *entire store* is empty (search.ts:297, global `chunks === 0`). An
operator who warmed claude yesterday and queries
`--harness kimi --hours 12` gets silent zero hits with a generic "try broader
query" hint — exactly the fail-closed surprise the explicit model is supposed
to prevent. The next checkpoint should make queries span-aware: know whether
the requested (harness, window) was ever indexed and when, and distinguish
"kimi not warmed in this window — run `scout search index …`" from "warmed,
no matches". That likely means recording warm spans (source × harness ×
window × completedAt) per index job, which is also the natural seam for the
future broker `status`/`query` API. I'd want this before inspect, grouping,
more harnesses, or web UI — every one of those surfaces inherits the same
"is this silence or staleness?" question, so answer it once at the bottom.

Bundle the Q1 readonly fix and the Q2 double-index verification into that same
checkpoint.

## Q5 — Data-boundary rules

No structural violations. Transcripts are observed in place; QMD/chunks carry
`ownership: "derived"`; nothing is imported as Scout messages; sourceRefs are
provenance-rich (portable path + size/mtime/contentHash anchor + record
ranges). Two soft spots to hold deliberately:

- Event documents summarize **every** record at ≤180 chars. That per-record
  ceiling is the only thing standing between "bounded derived material" and
  SCO-062's "disguised full transcript warehouse" prohibition. Make it a
  named invariant (a test asserting the cap) so a future "just include the
  full tool output" change trips a wire.
- The think-excerpt persistence question from Q2 is a boundary-adjacent
  policy call; decide it explicitly.

## Smaller notes (no action required this slice)

- Lookback clamps are asymmetric: `--hours` allows up to a year,
  `--days` clamps at 30. Harmonize.
- `project` facet is `basename(cwd)`, so two projects sharing a directory name
  collide. The cwd is already in hand — add a `projectPath` facet alongside.
  This is the one facet genuinely missing from the checkpoint's facet list.
- Extractor bump to `session-qmd-v3` is fine (hash includes extractor +
  chunk-policy versions; collection ids are stable, so re-warm replaces in
  place). v2-era collections outside the next warm window linger until
  re-warmed — acceptable; a `prune`/`gc` subcommand can come with the
  freshness work.
- Query-time `--hours` filters on `json_extract` over `source_refs.ref_json`
  per candidate chunk. Fine at current scale; if it shows up in profiles,
  promote `anchor.mtimeMs` to a real column.
