# Session search checkpoint 1 — architecture / implementation review

**Status:** first product slice, explicit warm-up only  
**Branch context:** `codex/delivery-campaign-source` (work in tree; may mix with other delivery work)  
**Reviewer ask:** validate architecture and implementation choices; flag wrong turns early

## Product contract (agreed)

1. **Explicit index**, not ambient. Operator warms a span, then queries.
2. **Harness-native transcripts are observed**, not bulk-imported as Scout messages.
3. **General system**, not custom “find Kimmy iOS builds” paths. Kimi is one harness adapter.
4. **Acceptance probe (not a product feature):**  
   `index --harness kimi --hours 12` then `query "iOS build steps" --harness kimi --hours 12`.

## What shipped in this slice

| Layer | Location | Choice |
| --- | --- | --- |
| Session → QMD + FTS | `packages/runtime/src/knowledge/session-indexer.ts` | Extend existing indexer; add `kimi` harness, `hours` + `harness` filters |
| Kimi transcript spine | same | Only `wire.jsonl`; cwd/session from `state.json` |
| Store / FTS | `packages/runtime/src/knowledge/store.ts` | Existing SQLite FTS5; multi-term queries use `OR` + BM25 |
| CLI | `apps/desktop/src/cli/commands/search.ts` | `scout search status \| index \| query` |
| Registry | `apps/desktop/src/cli/registry.ts`, `commands/index.ts` | Primary command `search` |
| Tests | `packages/runtime/src/knowledge/session-indexer.test.ts` | Fixture kimi wire → index → lexical hit |

### CLI surface

```bash
scout search index --source sessions --harness kimi --hours 12
scout search status
scout search query "iOS build steps" --harness kimi --hours 12
```

### Live acceptance (local machine)

- Indexed 12 kimi wires / 12h, 0 failed, 213 chunks.
- Query returned session coordinates + source paths for v3 iOS build work.

## Architecture claims to validate

1. **Home for the subsystem** — knowledge lives in `packages/runtime` (broker/control-home paths), CLI calls runtime APIs directly. No broker HTTP for search yet (SCO-062 sketches broker routes). Is “CLI → runtime SQLite” correct for v1, or should index/query already go through broker?

2. **Explicit-only indexing** — matches SCO-062 (“MUST NOT run as ambient background work by default”). Any hole that will surprise operators?

3. **Harness adapter shape** — normalize each harness into shared mechanical kinds (`user_turn`, `assistant_turn`, `command_or_tool`, …) then one QMD/chunk pipeline. Is Kimi’s wire mapping sound enough, or too lossy (e.g. skipping `think`, thin system records)?

4. **Span model** — `--hours` / `--days` on index and optional `sourceUpdatedAfterMs` on query. Query does **not** auto-index. Cold index → hard error with warm-up hint. Right fail-closed posture?

5. **FTS multi-term = OR** — natural language phrases (“iOS build steps”) used to AND-fail on rare tokens; switched to OR + BM25. Risk of noise vs AND? Prefer NEAR / hybrid later?

6. **Facets** — `harness`, `project`, `sessionId`, `transcriptPath`, tool names, touched paths. Enough for “all sessions, filter harness + topic”? Missing agent card / project path facet?

7. **Identity of a hit** — returns collection title, facets, portable source path, session id. No first-class “open / dispatch / fork” actions yet. Is that the right v1 cut?

8. **Extractor version bump** (`session-qmd-v3`) — forces re-index when hash includes extractor. OK?

## Explicit non-goals this slice

- Ambient keep-warm
- Semantic / embedding search
- Skills / MCP / codebase collections (designed-for in SCO-062, not built)
- Broker HTTP knowledge routes
- Mesh-global transcript search
- Custom iOS/Kimi query path

## Review questions for Fable

Please answer as architecture review, not implementation rewrite:

1. Keep CLI→runtime direct, or require broker boundary now?
2. Any must-fix on Kimi normalization or discovery roots?
3. OR vs AND for multi-term FTS: approve, or tighter default?
4. What’s the **next** checkpoint you want before more surface area (inspect, grouping, more harnesses, web UI, broker API)?
5. Anything that violates Scout data-boundary rules (observed vs scout-owned)?

## How to re-run the acceptance probe

```bash
bun packages/cli/src/main.ts search index --source sessions --harness kimi --hours 12
bun packages/cli/src/main.ts search query "iOS build steps" --harness kimi --hours 12 --limit 10
bun packages/cli/src/main.ts search query xcodebuild --harness kimi --hours 12 --limit 5
```

Unit: `bun test packages/runtime/src/knowledge/session-indexer.test.ts packages/runtime/src/knowledge.test.ts`
