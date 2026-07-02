# SCO-031: Data-access layer restructure

## Status
Proposal — design only, no code in this proposal.

**Proposal ID:** `sco-031`
**Intent:** Split `packages/web/server/db-queries.ts` by domain, separate web vs mobile types, and introduce a single `ConversationsApi` facade for conversation identity operations.
**Companion to:** SCO-030 (Opaque conversation IDs). SCO-031 lands first to clean the modules SCO-030 will edit; SCO-030 then introduces the `natural_key` column and switches mint sites to `ConversationsApi.ensureByNaturalKey`.

## 1. Problem

OpenScout's read path for the web UI and mobile bridge lives in a single 3611-line module, `packages/web/server/db-queries.ts`. It exports 40+ functions and 19 types spanning eight distinct domains: agents, activity feed, broker diagnostics, conversations, flights/runs, follow targets, work items, sessions, mobile-shaped sessions/agents/workspaces, fleet rollups, and heartrate. The file mixes:

- **Two consumer shapes intermixed**: `WebAgent`, `WebMessage`, `WebWorkItem`, `WebActivityItem` (lines 27-152) sit next to `MobileSessionSummary`, `MobileAgentSummary`, `MobileWorkspaceSummary`, `MobileAgentDetail` (lines 2603-2934). The two surfaces have different audience expectations (HTTP tRPC vs iOS app) but co-evolve in one file because the helpers are shared.
- **Identity logic buried in the read path**: `conversationIdForAgent` (line 2464), `buildDirectConversationId` (line 2473), `parseDirectConversationId` (line 2511), `buildLegacyScoutSessionConversationId` (line 2477), `parseLegacyScoutSessionConversationId` (line 2492), `conversationIdAliases` (line 2497), `synthesizeDirectSession` (line 2532), and `directConversationIdCandidates` (line 2481) collectively constitute *the* canonical answer to "given an agent, which conversation row do I read?" — but they are private helpers inside a query module. SCO-030 (opaque conversation IDs) needs to rewrite this whole cluster, and doing it inside `db-queries.ts` means touching a 3.6k-LOC file alongside identity changes.
- **No clear ownership of "the conversation aggregate"**: writes happen via `SQLiteControlPlaneStore.upsertConversation` (sqlite-store.ts:1274) called from the runtime, web mints go via HTTP to the broker (`upsertScoutConversation` in `core/broker/service.ts:316`), and reads come from `queryConversationDefinitionById` (db-queries.ts:2223), `querySessions` (line 2277), `querySessionById` (line 2444), and `synthesizeDirectSession` (line 2532). There is no place to add a `findByNaturalKey` or `ensureByNaturalKey` operation without picking arbitrarily between three call sites.
- **Test surface is a single 1k-LOC file** (`db-queries.test.ts` plus `db-queries.readonly.test.ts`). Failures don't localize to a domain.

The 3083-line `packages/runtime/src/sqlite-store.ts` is in better shape — it is a coherent class with a clear write path, a private `loadConversation` (line 2683), and a single `upsertConversation`. It is *not* the problem.

The 683-line `packages/runtime/src/sqlite-projection.ts` is also fine — it is the journal replay layer that calls back into `SQLiteControlPlaneStore`. It is part of the write path (recovers state from broker journal) and stays untouched by this proposal.

## 2. Non-goals

- No rewrite of `SQLiteControlPlaneStore`. It stays a class, with its current methods, in its current file.
- No type-level read/write enforcement (no `WriteStore` vs `ReadDb` split). The store already exposes a readonly handle (`this.readDb` at sqlite-store.ts:683); formalizing this in types is a separate SCO.
- No extraction of `MessagesRepo`, `WorkRepo`, `FlightsRepo`, `FleetRepo`. Only `ConversationsApi` lands here, because only conversations have a specific identity problem that SCO-030 needs to solve. Other repos extract opportunistically as their domains get surgery.
- No migration off drizzle (which is currently bounded to `deliveries` + `delivery_attempts` per `drizzle-schema.ts:39`) and no change to `drizzle-migrate.ts`.
- No web client changes; this is purely server-side.
- No projection refactor.

## 3. Decision

Three coordinated moves:

**(a) Domain split.** Replace `packages/web/server/db-queries.ts` with `packages/web/server/db/`, one file per domain (8 files), one shared types directory split web/mobile. `db-queries.ts` becomes a 30-line re-export barrel during transition and is deleted in the release after every internal call site has been updated.

**(b) Types split.** Web shapes (`WebAgent`, `WebMessage`, `WebWorkItem`, etc.) move to `db/types/web.ts`. Mobile shapes (`MobileSessionSummary`, `MobileAgentSummary`, `MobileWorkspaceSummary`, `MobileAgentDetail`) move to `db/types/mobile.ts`. Shared internal types (`SqlClause`, `WorkAttention`, `AgentSummaryState`) move to `db/internal/sql-helpers.ts`.

**(c) `ConversationsApi` facade.** A new repository module at `packages/runtime/src/conversations/api.ts` becomes the *single* entry point for conversation identity operations across runtime and web. It wraps `SQLiteControlPlaneStore.upsertConversation` for writes and queries the conversations table directly for reads. SCO-030's new `ensureByNaturalKey` method lives here; legacy structural-ID parsing (`parseDirectConversationId` and friends) lives here as a transitional `resolveLegacyId` helper.

Repository-per-aggregate is the right pattern for SQLite-backed identity logic — it gives a typed home for the "given X, find or mint the conversation" operations that SCO-030 needs and avoids leaking conversation-shape SQL across three different layers. We do not extract other aggregates yet because they don't have an identity crisis; doing them speculatively would balloon scope without payoff.

## 4. Proposed directory structure

```
packages/web/server/db/
  index.ts                     # barrel re-export (during transition)
  agents.ts                    # queryAgents
  activity.ts                  # queryActivity, queryHeartrate
  messages.ts                  # queryRecentMessages
  broker.ts                    # queryBrokerDiagnostics + helpers
  runs.ts                      # queryRuns, queryFlights, queryFlightRecordById, queryFollowTarget
  work.ts                      # queryWorkItemById, queryWorkItems + projectWorkItemRow
  sessions.ts                  # querySessions, querySessionById, queryConversationDefinitionById
  fleet.ts                     # queryFleet + fleet projection helpers
  mobile/
    agents.ts                  # queryMobileAgents, queryMobileAgentDetail
    sessions.ts                # queryMobileSessions
    workspaces.ts              # queryMobileWorkspaces
  internal/
    db.ts                      # db(), closeDb, configureReadonlyDb, resolveDbPath
    sql-helpers.ts             # sqlPlaceholders, sqlStringList, sqlWhereClause, LATEST_AGENT_ENDPOINT_JOIN, predicates
    paths.ts                   # compact, pairingHarnessLogPath, relayHarnessLogPath, resolveHarnessSessionId, resolveHarnessLogPath
    parse.ts                   # parseJson, coerceNumber, normalizeTimestampMs, metadataString
  types/
    web.ts                     # WebAgent, WebActivityItem, WebMessage, WebBroker*, WebWorkItem, WebFlight, WebAgentRun, WebFollowTarget, WebWorkTimelineItem, WebWorkDetail, WebFleet*
    mobile.ts                  # MobileSessionSummary, MobileAgentSummary, MobileWorkspaceSummary, MobileAgentDetail
    common.ts                  # WorkAttention, AgentSummaryState, HeartrateBucket
```

Concrete line-range mapping from current `db-queries.ts`:

| Target | From `db-queries.ts` lines | Content |
|---|---|---|
| `types/web.ts` | 27-152, 1072-1097, 1535-1565, 3057-3119 | All `Web*` types incl. fleet |
| `types/mobile.ts` | 2603-2616, 2684-2700, 2833-2851, 2911-2934 | All `Mobile*` types |
| `types/common.ts` | 126-128, 3532 | `WorkAttention`, `AgentSummaryState`, `HeartrateBucket` |
| `internal/db.ts` | 154-185 | `resolveDbPath`, `db()`, `closeDb`, `configureReadonlyDb` |
| `internal/parse.ts` | 196-210, 276-285, 363-369 | `parseJson`, `metadataString`, `coerceNumber`, `normalizeTimestampMs` |
| `internal/paths.ts` | 187-194, 212-274 | `compact`, harness log/session resolvers |
| `internal/sql-helpers.ts` | 287-314, 316-401, 442-549 | SQL builders, predicates, `LATEST_AGENT_ENDPOINT_JOIN`, `projectWorkItemRow`, `workAttention` |
| `agents.ts` | 553-633 | `queryAgents` |
| `activity.ts` | 635-699, 3540-3611 | `queryActivity`, `queryHeartrate` + heartrate helpers (3534-3572) |
| `messages.ts` | 701-751 | `queryRecentMessages` |
| `broker.ts` | 753-1068 | `queryBrokerDiagnostics` + `metadataTarget`, `metadataRoute`, `isBrokerRoutedMessage`, `shortBrokerBody` |
| `runs.ts` | 1098-1437 | `queryRuns`, `queryFlights`, `queryFlightRecordById`, `queryFollowTarget` + row projections |
| `work.ts` | 1566-2161 | `queryWorkItemById`, `queryWorkItems`, `queryWorkItemShallow`, `queryWorkTimeline`, `queryInferredWorkTimelineFlights` |
| `sessions.ts` | 2162-2457, 2532-2597 | `querySessions`, `querySessionById`, `queryConversationDefinitionById`, `synthesizeDirectSession`, `isLikelyLocalSessionAgentId`, `pickDirectConversationAgentId`, `shouldPreferSessionSummary` |
| `fleet.ts` | 3057-3531 | `queryFleet`, `queryFleetActivity`, `queryFleetAskRows`, `queryFleetAttentionRows`, projections |
| `mobile/agents.ts` | 2603-2682, 2911-3056 | `queryMobileAgents`, `queryMobileAgentDetail` |
| `mobile/sessions.ts` | 2684-2832 | `queryMobileSessions` |
| `mobile/workspaces.ts` | 2833-2910 | `queryMobileWorkspaces` |

Conversation identity helpers (lines 2459-2530: `conversationIdForAgent`, `buildDirectConversationId`, `parseDirectConversationId`, `directConversationIdCandidates`, `conversationIdAliases`, `buildLegacyScoutSessionConversationId`, `parseLegacyScoutSessionConversationId`, `configuredOperatorActorIds`) do **not** land in `db/sessions.ts`. They move into `ConversationsApi` (see §5). `db/sessions.ts` and any other consumer imports them from the repo.

Target sizes: each domain file 300-600 LOC. `work.ts` is the largest (~600 LOC because the work-item projections are dense); `agents.ts` and `messages.ts` are ~80 and ~50 LOC respectively, which is fine — keep the domain boundary.

## 5. `ConversationsApi` design

**Location:** `packages/runtime/src/conversations/api.ts`.

Rationale for runtime, not web: the write path is owned by `SQLiteControlPlaneStore`, which lives in runtime. Putting the repo there lets it call `store.upsertConversation` directly and re-use the store's `readDb` for queries. The web server consumes the repo through the existing `@openscout/runtime` package export. This avoids a circular dep — `packages/web` already depends on `@openscout/runtime` (see `db-queries.ts:22` importing `@openscout/runtime/support-paths`).

**Interface:**

```ts
export interface EnsureConversationInput {
  naturalKey: string;
  kind: ConversationKind;
  title: string;
  visibility: VisibilityScope;
  shareMode: ShareMode;
  authorityNodeId: ScoutId;
  participantIds: ScoutId[];
  parentConversationId?: ScoutId;
  topic?: string;
  metadata?: MetadataMap;
}

export interface ConversationsApi {
  findById(id: ScoutId): ConversationDefinition | null;
  findByNaturalKey(key: string): ConversationDefinition | null;
  findByAgent(agentId: ScoutId): ConversationDefinition | null;
  findByParent(parentId: ScoutId): ConversationDefinition[];
  findByParticipants(participants: ScoutId[]): ConversationDefinition | null;
  ensureByNaturalKey(input: EnsureConversationInput): ConversationDefinition;
  upsert(c: ConversationDefinition): void;
  delete(id: ScoutId): void;
  resolveLegacyId(rawId: string): ConversationDefinition | null;
}
```

**Method-by-method origin:**

- `findById` — wraps `SQLiteControlPlaneStore.loadConversation` (currently private at sqlite-store.ts:2683; promote to public or expose via a narrow `getConversation` accessor). Replaces `queryConversationDefinitionById` (db-queries.ts:2223).
- `findByNaturalKey` — new in SCO-031 as a no-op (returns null) until SCO-030 adds the `natural_key` column. The method shape exists so SCO-030 is a pure migration: add the column, add the index, fill the function body.
- `findByAgent` — encapsulates the "operator DM convenience" by building `dm.operator.<agentId>` and calling `findById`. Replaces inline `conversationIdForAgent(...)` in db-queries.ts:2202, 2483, 2678, plus any other call site.
- `findByParent` — new query: `SELECT * FROM conversations WHERE parent_conversation_id = ?`. Used by future thread UI work; no current caller, but cheap to add because the index `idx_conversations_created_at` already exists.
- `findByParticipants` — searches conversations whose `conversation_members` set exactly matches a given participant set. Encapsulates the deduplication logic in `pickDirectConversationAgentId` (db-queries.ts:2166) and `shouldPreferSessionSummary` (db-queries.ts:2197) for the simple cases.
- `ensureByNaturalKey` — the SCO-030 mint API. In SCO-031, body is `findByNaturalKey(input.naturalKey) ?? upsert({id: input.naturalKey, ...})` as a temporary structural-ID fallback. SCO-030 fills in the real opaque-mint logic.
- `upsert` — direct passthrough to `SQLiteControlPlaneStore.upsertConversation` (sqlite-store.ts:1274).
- `delete` — new method calling `DELETE FROM conversations WHERE id = ?`. The schema's `ON DELETE CASCADE` on `conversation_members` and `ON DELETE SET NULL` on most foreign keys (schema.ts:75, 96, 143, 262, 296, 332) handles cleanup. No current caller but the API completeness is worth the 5 lines.
- `resolveLegacyId` — absorbs `parseDirectConversationId` (line 2511), `parseLegacyScoutSessionConversationId` (line 2492), `directConversationIdCandidates` (line 2481), `conversationIdAliases` (line 2497), `buildDirectConversationId` (line 2473), `buildLegacyScoutSessionConversationId` (line 2477), and `configuredOperatorActorIds` (line 2468). Returns the canonical `ConversationDefinition` when a legacy structural ID can be resolved to a row, or null otherwise. SCO-030 marks this `@deprecated` and removes it after the structural-ID compat window closes.

**Constructor:**

```ts
export class Conversations implements ConversationsApi {
  constructor(private readonly store: SQLiteControlPlaneStore) {}
}
```

A single dependency: the existing store. This avoids opening a third connection to the SQLite file and reuses the store's `readDb` / `db` handles (which are already configured with the right pragmas). For pure-read consumers like the web server's per-request handlers we expose a thin factory `openConversationsReadOnly(dbPath)` that constructs a read-only `SQLiteControlPlaneStore` internally — but for the SCO-031 first cut, web reads can continue to use the bun:sqlite `Database` handle they already have, and `ConversationsApi` is wired in only on the writer side (broker, runtime). This keeps the SCO-031 surface small.

**Instantiation:**

- Runtime: singleton, created where `SQLiteControlPlaneStore` is constructed (broker daemon, control-plane process). Stash it on the store as a public lazy getter `store.conversations`.
- Web server: read-only consumers use the existing `db()` accessor from `internal/db.ts`, calling new bare functions in `db/sessions.ts` (which keep the same SQL as today, just relocated). The web server does **not** instantiate `ConversationsApi` itself in v1 — mint operations from the web server already go through HTTP to the broker (`upsertScoutConversation` in `packages/web/server/core/broker/service.ts:316`), so the broker is the only writer-side caller. This sidesteps cross-process locking on the SQLite WAL.

**Caching:** none in v1. `findById` is a single indexed point lookup; the dual handles in the store already keep read latency under 1ms. A `Map<ScoutId, ConversationDefinition>` LRU is a possible v2 if hot paths show up.

**Naming.** `ConversationsApi` over `ConversationRepository` (matches the brevity in this codebase: `SQLiteControlPlaneStore` not `SQLiteControlPlaneRepository`) and over `ConversationStore` (which would collide conceptually with `SQLiteControlPlaneStore`). The `SQLite*` prefix on the concrete class matches `SQLiteControlPlaneStore`.

## 6. Migration strategy for the `db-queries.ts` split

Three sequential PRs, but they can be one if review bandwidth allows. Each phase keeps the test suite green.

**Phase A: extract internals.** Move `db()`, `closeDb`, `configureReadonlyDb`, parse helpers, path helpers, SQL helpers, and the predicate constants into `db/internal/*.ts`. `db-queries.ts` imports them back. Zero behavior change. ~700 LOC moved.

**Phase B: extract types.** Move all `Web*` and `Mobile*` types into `db/types/*.ts`. `db-queries.ts` re-exports them. All consumer files (`work-materials.ts:8`, `core/observe/service.ts:22`, `core/observe/service.sources.test.ts:7`, `db-queries.test.ts:11`) keep their imports unchanged because the barrel still works.

**Phase C: extract domains.** Move query functions one domain at a time into `db/<domain>.ts`. Each step: copy function, replace `db-queries.ts` body with a re-export, run tests. Order: `agents.ts` → `messages.ts` → `broker.ts` → `activity.ts` → `runs.ts` → `work.ts` → `sessions.ts` → `fleet.ts` → `mobile/*`. The `sessions.ts` extraction is the only one with a wrinkle: its identity helpers move to `ConversationsApi`, so this step is coupled with §7.

**Phase D: collapse the barrel.** Once consumers are updated to import directly from `db/<domain>` (mechanical sed-style replacement — every import site is listed below), `db-queries.ts` becomes a 30-line pure re-export barrel that we keep for one release as a deprecation shim, then delete.

**Import-site impact:**

| File | Imports from `db-queries.ts` | Update required |
|---|---|---|
| `packages/web/server/create-openscout-web-server.ts:34-50` | 13 functions | Mechanical: split across 6 imports |
| `packages/web/server/work-materials.ts:6-14` | 3 types | Mechanical: import from `db/types/web` and `db/types/mobile` |
| `packages/web/server/work-materials.test.ts:8` | 2 types | Mechanical |
| `packages/web/server/db-queries.test.ts:7-23` | 12 functions | Mechanical |
| `packages/web/server/db-queries.readonly.test.ts:3` | `configureReadonlyDb` | Becomes `db/internal/db` |
| `packages/web/server/file-preview.ts:5` | `queryAgents` | Becomes `db/agents` |
| `packages/web/server/core/pairing/runtime/bridge/router.ts:39-45` | 5 mobile functions + `conversationIdForAgent` | Mechanical; `conversationIdForAgent` becomes `repo.findByAgent(id).id` or stays as a free function exported from `db/sessions.ts` (kept for source-line economy) |
| `packages/web/server/core/observe/service.ts:22-23` | `WebAgent`, `queryAgents` | Mechanical |
| `packages/web/server/core/observe/service.sources.test.ts:7` | `WebAgent` | Mechanical |
| `packages/web/server/core/mobile/service.ts:17` | `queryFleet` | Becomes `db/fleet` |
| `apps/desktop/src/core/mobile/service.ts:17` | `queryFleet` | Same |
| `apps/desktop/src/core/pairing/runtime/bridge/router.ts:44` | mobile functions | Same |
| `apps/desktop/src/server/db-queries.test.ts:15` | 12 functions | Same (this is a copy of the web test) |
| `apps/desktop/src/server/create-scout-control-plane-server.ts:31` | imported set | Same |

Note: `apps/desktop/src/server/db-queries.ts` is **not** a vendor mirror — it has diverged. As of 2026-05-13 the web copy is 3611 LOC, desktop is 1863 LOC. The web copy has additional types (`WebBrokerRouteAttempt`, `WebBrokerDialogueItem`, `WebBrokerDiagnostics`), additional imports (`AgentRun`, `FlightRecord`, `InvocationExecutionPreference`), and extra fields on `WebAgent` (`model`, `harnessSessionId`, `harnessLogPath`, `conversationId`) that desktop lacks.

Recommendation: **migrate web only in the SCO-031 PR**. Desktop gets its own scoped split as a follow-up when convenient — its surface is smaller and its identity helpers (the parts SCO-030 cares about) likely match web's structurally. A pre-work reconciliation pass would balloon SCO-031 scope without payoff.

## 7. Migration strategy for `ConversationsApi`

The repo lands with the same behavior as today's helpers, then SCO-030 changes the semantics.

**Step 1:** Create `packages/runtime/src/conversations/api.ts` and `repos/index.ts`. Export `ConversationsApi` from `@openscout/runtime` package. Implement all eight methods using the existing structural-ID logic (lifted verbatim from `db-queries.ts:2459-2530`) and the store's `loadConversation` (promoted to public). `findByNaturalKey` returns null pending SCO-030. `ensureByNaturalKey` uses `naturalKey` as the literal `id` as a transitional bridge.

**Step 2:** Update `db/sessions.ts` to call the repo for `findByAgent` / `resolveLegacyId` lookups. The conversation-id helpers in db-queries are deleted from web; their content lives only in the repo.

**Step 3:** No runtime/broker call site changes yet. The broker continues to use `store.upsertConversation` directly. SCO-030 is the PR that flips broker mint sites to `repo.ensureByNaturalKey`.

**Step 4 (in SCO-030, not SCO-031):** Add `natural_key` column + index, fill `findByNaturalKey` body, switch mint sites, deprecate `resolveLegacyId`.

## 8. Test impact

- `db-queries.test.ts` (line 7-23 imports): paths change in Phase C. Bodies unchanged. The 1000-LOC test file gets split alongside the source split into `db/agents.test.ts`, `db/messages.test.ts`, etc. — but that split is a follow-up; for SCO-031 the test file imports from the new modules and stays one file.
- `db-queries.readonly.test.ts`: import path updates to `db/internal/db`. Body unchanged.
- `sqlite-store.test.ts`: unchanged unless we promote `loadConversation` to public. If we do, add one test for `store.getConversation(id)`.
- `sqlite-projection.test.ts`: unchanged.
- `work-materials.test.ts`: import paths update mechanically.
- **New tests:** `packages/runtime/src/conversations/conversations.test.ts` covers `findById`, `findByAgent` (structural-ID path), `findByParticipants`, `upsert`, `delete`, `resolveLegacyId` (legacy parsing). `findByNaturalKey` / `ensureByNaturalKey` get tests in SCO-030, not here.

No test hard-codes the path `"./db-queries.ts"` in a way that breaks if the file becomes a barrel; all imports are by name.

## 9. What's deferred

- **Other repositories** (`MessagesRepo`, `WorkRepo`, `FlightsRepo`, `FleetRepo`). Extract when each domain gets surgery. Messages is the most likely next candidate because thread UI work (SCO-029) will surface it.
- **Read/write type enforcement** (`WriteStore` vs `ReadDb`). The store already has separate handles; lifting that into the type system is a separate SCO and risks ballooning generic-parameter noise.
- **Projection refactor.** `sqlite-projection.ts` stays as-is.
- **ORM query-layer migration.** Reads and writes stay on the typed-Row raw
  SQL pattern; SQLite stays. Out of scope. *(Revised 2026-07-01: this item
  originally scoped Drizzle to deliveries and ruled ORM/DB migration "out of
  scope forever." Schema and migrations are now Drizzle-managed — see
  [SCO-075](./sco-075-drizzle-managed-migrations.md), which supersedes the
  original clause on the migration point only; the query-layer boundary here
  is unchanged.)*
- **`db-queries.test.ts` split per domain.** Done in a follow-up once the source split has settled.

## 10. Sequencing with SCO-030

SCO-031 is mechanical, low-risk, no-behavior-change. SCO-030 builds on top: adds a column, fills `findByNaturalKey`, switches mint sites, and (eventually) deprecates `resolveLegacyId`. Two separate PRs is the right shape — reviewers can verify SCO-031 with a simple "imports moved, exports unchanged" check, then focus SCO-030 review on identity semantics rather than module shuffling.

If under PR-budget pressure, SCO-031 phases A+B+C can be one PR, and `ConversationsApi` introduction (the heart of §7) can be the SCO-030 PR. We prefer two PRs.

## 11. Acceptance criteria

- `packages/web/server/db-queries.ts` is either deleted or a pure re-export barrel under 50 lines.
- `packages/web/server/db/` exists with 8 domain files + `mobile/` subdir + `types/` subdir + `internal/` subdir. Each domain file is 300-600 LOC except `agents.ts` (~80 LOC) and `messages.ts` (~50 LOC) where the domain is naturally small.
- Every former export of `db-queries.ts` resolves to a single home in `db/` (no duplicate exports across files).
- `packages/runtime/src/conversations/api.ts` exists, exports a `ConversationsApi` interface and a `Conversations` class, has the eight methods listed in §5.
- `ConversationsApi` is the only module containing the structural-ID parse/build helpers (`dm.operator.<agent>`, the `dm.<agent>.scout.main.mini` legacy form, etc.). No structural-ID string literal appears outside the repo.
- `SQLiteControlPlaneStore` exposes `store.conversations: ConversationsApi` (lazy getter).
- All existing tests pass with no behavior changes. One new test file `conversations/api.test.ts` exists.
- Both `packages/web/server/db-queries.ts` and `apps/desktop/src/server/db-queries.ts` are migrated in the same PR (or coordinated PRs).

## 12. Verification

```bash
bun test packages/web/server/db-queries.test.ts
bun test packages/web/server/db-queries.readonly.test.ts
bun test packages/web/server/work-materials.test.ts
bun test packages/web/server/core/observe/service.sources.test.ts
bun test packages/runtime/src/sqlite-store.test.ts
bun test packages/runtime/src/sqlite-projection.test.ts
bun test packages/runtime/src/conversations/conversations.test.ts
bun run --cwd packages/web build:server
bun run --cwd packages/runtime build
npm --prefix packages/cli run build
```

Grep checks (should return zero hits after the split):

```bash
grep -rn "from.*db-queries" packages apps  # only the barrel itself
grep -rn "buildDirectConversationId\|parseDirectConversationId" packages apps  # only inside conversations/api.ts
grep -rn '"dm\.' packages/web apps/desktop  # only inside ConversationsApi (and tests)
```

## 13. Open questions

1. **`runs.ts` vs `flights.ts` granularity.** Today `queryRuns`, `queryFlights`, `queryFlightRecordById`, and `queryFollowTarget` all live in the runs region (db-queries.ts:1098-1534) and share `RunQueryRow` projection helpers. Split into two files or stay one? Recommendation: stay one (`runs.ts`), 440 LOC, well within the target band, projections are tightly coupled.
2. **Where the repo lives.** Proposed: `packages/runtime/src/conversations/api.ts`. Alternative: a new package `packages/data` containing both the schema and all repos. Recommendation: stay in runtime. A new package adds a build target without adding clarity until we have ≥3 repos.
3. **Promote `loadConversation` to public on `SQLiteControlPlaneStore`?** Recommendation: yes. Rename to `getConversation` and make it public. The repo then calls `store.getConversation(id)` rather than reaching into a private. The cost is one line in `sqlite-store.ts` and a tiny test.
4. **Should the web server own a `ConversationsApi` instance too?** Recommendation: not in SCO-031. Web mints go through HTTP to the broker. If the web server later starts writing conversations directly (e.g., for offline mode), revisit.
5. **`ensureByNaturalKey` transitional behavior.** In SCO-031, should it (a) use `naturalKey` as the row's `id` directly, or (b) refuse with an error pending SCO-030? Recommendation: (a). It keeps the API callable and gives SCO-030 a feature flag rather than a hard switch.
6. **Naming.** `ConversationsApi` (plural, "repository for conversations") or `ConversationRepository` (singular, classic DDD)? Recommendation: `ConversationsApi`. Matches OpenScout terseness; the codebase already uses `repos/` plural in directory names elsewhere (none yet — but this sets the convention).
