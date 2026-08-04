# Session search checkpoint 2 — span / freshness honesty

**Status:** implemented  
**Depends on:** checkpoint 1 (`docs/eng/session-search-checkpoint-1.md`)  
**Fable prior:** warm-span honesty before more surface area

## Goal

Queries must not lie with silence.

| Situation | Operator message |
| --- | --- |
| Never indexed | empty index → run `scout search index …` |
| Indexed other harness / shorter window | not warmed for this span → exact warm-up command |
| Warmed, FTS finds nothing | warmed, no matches |
| Warmed long ago | still “warmed” but **stale** hint (re-index if fresher files matter) |

## Implementation

| Piece | Location |
| --- | --- |
| `warm_spans` table | `packages/runtime/src/knowledge/store.ts` schema |
| Record on completed index | `session-indexer.ts` after job `completed` |
| `assessCoverage()` | `SQLiteKnowledgeStore` |
| CLI uses coverage before search | `apps/desktop/src/cli/commands/search.ts` |
| Status lists recent spans | `status().warmSpans` |

### Span row

`source × harness × lookbackMs × cutoffMs × completedAt × jobId (+ counts)`

- Per-harness when index filtered or discovered multiple harnesses  
- `harness=*` only when the job indexed an empty discovery set (still records the claim)

### Coverage rules

1. No chunks and no spans → `empty_index`
2. Requested harness/lookback not covered by any span → `not_warmed` + suggestion + nearest spans
3. Covered → `warmed`; `stale` if newest covering span older than 6h

Query still does **not** auto-index (explicit contract).

## Acceptance

```bash
bun packages/cli/src/main.ts search index --source sessions --harness kimi --hours 12
bun packages/cli/src/main.ts search status
# shows warm span for kimi 12h

bun packages/cli/src/main.ts search query "no such token zzz" --harness kimi --hours 12
# → warmed, no matches (not "try warm-up")

bun packages/cli/src/main.ts search query "anything" --harness claude --hours 12
# → not warmed for claude (if only kimi was indexed) + suggestion
```

## Non-goals

- Ambient keep-warm  
- Perfect freshness of every new transcript mid-span  
- Broker HTTP status API (still CLI → runtime)

## Fable review (checkpoint 2)

Reviewed via `flt-mseoe6mw-crkv0n` (alias `project-bartok-2`). Design approved; three honesty holes fixed in the same slice:

| Hole | Fix |
| --- | --- |
| A. Zero-overlap “warmed” | `now - completedAt >= lookbackMs` → `not_warmed` |
| B. Multi-harness stale from newest | Oldest covering span governs `stale` |
| C. All-failed warm | `discovered>0 && indexed=0` not covering; empty scan (`discovered=0`) still covering |
| Unfiltered recording | One row per **scanned** root harness from `sessionRoots()`, not only harnesses that yielded files |

Stale threshold: fixed 6h, capped by `min(6h, lookbackMs)` when a lookback is requested.
