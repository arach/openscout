# SCO-030: Opaque Conversation IDs

## 1. Status / Proposal ID / Intent

- **Proposal ID:** SCO-030
- **Status:** Draft (pending review)
- **Intent:** Split conversation **identity** from **dedup natural-key** and **schema**. Replace structurally-encoded `ConversationDefinition.id` values (`dm.operator.{agentId}`, `dm.{a}.{b}`, `channel.{name}`) with short opaque IDs (e.g. `c_k7x9mq3p`). Move the structured form into a new `naturalKey` field used only by the broker upsert path. Stop the client from regexing IDs to infer participants, kind, or membership.
- **Companion to:** SCO-029 (Thread UI Unification, PR #104). This proposal is a precondition for SCO-029 Phase 3's split of `ConversationEntry` and a hard prerequisite for the broader "thread is the canonical UI noun" goal.

## 2. Problem

`ConversationDefinition.id` (typed `ScoutId = string` in `packages/protocol/src/common.ts:1`) is doing three jobs at once:

1. **Identity.** It is the SQLite primary key in `conversations`, the foreign key from `messages.conversation_id`, `thread_events.conversation_id`, `conversation_members.conversation_id`, `invocations.conversation_id`, `bindings.conversation_id`, `collaboration_records.conversation_id`, `unblock_requests.conversation_id`, `activity_items.conversation_id`, `thread_cursors.conversation_id` (10 FK sites in `packages/runtime/src/schema.ts:75–368`). It is also the URL handle in `/c/:conversationId`, `/messages/:conversationId`, `/agents/:agentId/c/:conversationId`, and the `conversationId=` query parameter on `/follow`.
2. **Natural key for dedup.** Multiple brokers and code paths must arrive at the same conversation record without coordination. They do this by constructing the same deterministic string. There are ten mint sites doing this (see §5).
3. **Schema.** The client parses `id` to extract participant info and infer kind:
   - `agentIdFromConversation(cid)` regexes `^dm\.operator\.(.+)$` (`packages/web/client/lib/router.ts:392`).
   - `conversationForAgent(agentId)` mints `dm.operator.${agentId}` from a guessed prefix (`packages/web/client/lib/router.ts:398`).
   - `isGroupConversation(c)` falls back to `c.id.startsWith("channel.")` (`packages/web/client/lib/conversations.ts:13`) and the same prefix appears in `ConversationScreen.tsx:878, 1602, 1611`, `conversations.ts:21, 28`, `broker-daemon.ts:1893`, server `db-queries.ts:847`.

This conflation produced the **disappearing optimistic message bug** that motivated SCO-029: the web `/api/send` route at `packages/web/server/create-openscout-web-server.ts:327–333` falls back to parsing `dm.operator.{x}` out of the conversation id to decide whether the send is an operator DM, and that guess can disagree with the broker's actual `kind`/`participantIds`. When the broker canonicalizes the conversation after send, the optimistic row gets routed to the inferred conversation and not the viewed one. SCO-029 patches the symptom in the message-feed reconciliation; this proposal removes the source.

Other consequences:

- **Bookmark fragility.** A two-person DM that grows into a group_direct or gets renamed (channel) forces the ID to change to keep the natural-key invariant true. Every persisted URL, every saved message, every FK references that old ID. We currently solve this by never letting participants change.
- **Awkward URLs.** `/c/dm.operator.openscout-6.main.mini` versus `/c/k7x9mq3p`. The structural form leaks routing/agent topology into history, screenshots, and shared links.
- **Thread URLs.** Threads are first-class `ConversationDefinition`s (`kind: "thread"`, `parentConversationId` set, per `packages/protocol/src/conversations.ts:15–27`). Once threads exist, either they need a new ugly natural-key pattern (`thread.{parent}.{messageId}`?) or the same `/c/{id}` route serves them — and that route works cleanly only if IDs are opaque. The thread roadmap forces this decision.
- **`buildLegacyScoutSessionConversationId`** at `packages/web/server/db-queries.ts:2477–2509` plus the alias-resolution dance proves we already cannot keep this invariant when the operator name changes. We're paying coordination cost to dodge a coordination cost.

## 3. Decision

1. `ConversationDefinition.id` stays typed `ScoutId` but its **values become opaque**. New format: `c_{8}` where `{8}` is 8 lowercase base36 characters (~41 bits, ~2 trillion values, collision rate negligible for any one-broker lifetime). Concrete generator: `` `c_${Date.now().toString(36)}${randomBytes(2).toString("hex")}` ``-style, but on the conservative side — a short pure-random tail. Picked `c_` prefix (not bare-opaque) so server logs and IDs in error messages remain greppable and so we can have parallel prefixes for `t_` (thread) and `ch_` (channel) later if SCO-029 Phase 4 wants nominal differentiation; rejected ULID (26 chars, too long for URLs) and bare nanoid (no prefix, harder to spot in logs). 8 chars beats 6 (50M is too tight under merge/rebase load) and is shorter than 12 (overkill at our scale).
2. New optional field `ConversationDefinition.naturalKey?: string`. Carries the structured dedup form: `dm:operator.{agentId}`, `dm:{sortedA}.{sortedB}`, `channel:{slug}`. Used **only** by `upsertConversationByNaturalKey` at mint time. Never parsed by the client. Picked `naturalKey` over `dedupKey` because "natural key" is the standard data-modeling term for "the business-meaningful key you'd use if you didn't have a surrogate key"; picked `:` separator over `.` so the field is visually distinct from old structural IDs in logs.
3. The client reads `kind` and `participantIds` directly off the conversation record (already present at `packages/protocol/src/conversations.ts:17,23`). `agentIdFromConversation` is deleted. `conversationForAgent(agentId)` becomes a server-side lookup wrapped in a `useConversationByAgent(agentId)` hook. `isGroupConversation(c)` collapses to `c.kind !== "direct"`.

## 4. Protocol changes

In `packages/protocol/src/conversations.ts`:

```ts
export interface ConversationDefinition {
  id: ScoutId;                        // opaque, ~c_k7x9mq3p
  kind: ConversationKind;
  naturalKey?: string;                // NEW: dm:..., channel:..., undefined for ad-hoc/thread
  title: string;
  visibility: VisibilityScope;
  shareMode: ShareMode;
  authorityNodeId: ScoutId;
  participantIds: ScoutId[];
  topic?: string;
  parentConversationId?: ScoutId;
  messageId?: ScoutId;
  metadata?: MetadataMap;
}
```

No change to `MessageRecord.conversationId`, `MessageRecord.threadConversationId`, or `ConversationDefinition.parentConversationId`. They are already `ScoutId` (`packages/protocol/src/messages.ts:40,46`, `packages/protocol/src/conversations.ts:24`). They become opaque transparently — these are pointer fields, not user-parsed.

Mint-time API: a single helper replaces ten local minters.

```ts
// in protocol or runtime
export interface EnsureConversationInput {
  kind: ConversationKind;
  participants: ScoutId[];
  channelName?: string;                // for kind: "channel"
  parentConversationId?: ScoutId;      // for kind: "thread"
  // visibility/shareMode/title/metadata as before
}
// returns the canonical ConversationDefinition (existing or newly minted).
ensureConversation(input): Promise<ConversationDefinition>
```

`ensureConversation` computes `naturalKey` internally, then calls `upsertConversationByNaturalKey` on the store. Callers never see the natural key.

`naturalKey` shape:
- DM operator→agent: `dm:operator:{agentId}` (operator is always normalized to canonical id at the broker)
- DM agent↔agent: `dm:agents:{sortedA}|{sortedB}`
- Channel: `channel:{slug}`
- group_direct: `gdm:{sortedParticipantsJoined}` (currently uses ad-hoc IDs; this would let it dedupe)
- thread, system, ad-hoc: `undefined` (identity-only conversations)

## 5. Server/runtime changes

Mint sites to rewrite:

| File:line | Today | Tomorrow |
|---|---|---|
| `packages/runtime/src/broker-daemon.ts:1981, 1985, 1987` (`directConversationIdForActors`) | returns `dm.operator.x` etc. | private helper computes `naturalKey`; calls `ensureConversation` |
| `packages/runtime/src/broker-daemon.ts:2095` (channel branch) | `id: \`channel.${slug}\`` | `ensureConversation({ kind: "channel", channelName })`; id comes back opaque |
| `packages/runtime/src/scout-broker.ts:519, 1142, 1194, 1197, 1199` | mirrors broker-daemon | same |
| `packages/runtime/src/setup.ts:642` (`primaryDirectConversationIdForAgent`) | mints `dm.operator.{x}` | becomes `ensureConversation({ kind: "direct", participants: ["operator", agentId] })`, returns opaque id |
| `packages/web/server/db-queries.ts:2474, 2478` (`buildDirectConversationId`, `buildLegacyScoutSessionConversationId`) | duplicate-minting | these go away entirely; replaced by `findConversationByNaturalKey` for lookups + the legacy alias table (§7) for old IDs |
| `packages/web/server/db-queries.ts:2518` (`parseDirectConversationId`) | regex parse `dm.{operator}.` | becomes a `findConversationByAgent(agentId)` SQL query that joins on natural key |
| `packages/web/server/core/broker/service.ts:675, 1327, 1371, 1375, 1377` | mirrors broker-daemon | same |
| `packages/web/server/create-openscout-web-server.ts:327–333` | parses `dm.operator.` from cid as a last-ditch fallback | use `findConversationById(cid)` (or `findConversationByNaturalKey` on the legacy form) and read `participantIds` and `kind` directly |
| `packages/web/server/core/pairing/runtime/bridge/router.ts:828` and `apps/desktop/.../router.ts:876` | `rawId.startsWith("dm.") ? rawId : conversationIdForAgent(rawId)` | becomes opaque-vs-agent-id check (`/^c_/.test(rawId)`) then `findConversationByAgent` |
| `apps/desktop/src/core/broker/service.ts:935, 1645, 1712–1718` | mirror runtime | same |
| `apps/desktop/src/core/mobile/service.ts:574` (`startsWith("dm.operator.")`) | infers agentId | reads `conversation.participantIds` |
| `apps/desktop/src/cli/commands/ask.ts:90` (`startsWith("dm.")`) | inferred routing | branch on `conversation.kind === "direct"` |

Well-known channel IDs (`BROKER_SHARED_CHANNEL_ID = "channel.shared"`, etc., at `packages/runtime/src/broker-daemon.ts:287–289`, `packages/runtime/src/scout-broker.ts:225–227`, plus `SCOUT_PRIMARY_CONVERSATION_ID = "dm.scout.primary"` at `packages/runtime/src/setup.ts:30`) stay as their current string values. They are valid opaque strings; the client should treat them as opaque. We pin them at boot via `ensureConversation` so they always have a `naturalKey` row entry — but no migration needed.

### Storage migration

Add a `natural_key` column to `conversations` with a partial unique index (only on rows where `natural_key IS NOT NULL`). Sketch:

```sql
ALTER TABLE conversations ADD COLUMN natural_key TEXT;
CREATE UNIQUE INDEX conversations_natural_key_uq
  ON conversations(natural_key) WHERE natural_key IS NOT NULL;
```

Dedup at the DB layer instead of via deterministic-string collision. `upsertConversation` in `packages/runtime/src/sqlite-store.ts:1274–1310` splits into:

- `insertConversation(conversation)` — INSERT with the opaque id (will conflict on natural_key index if a parallel writer beat us).
- `upsertConversationByNaturalKey({ naturalKey, ... })` — try insert; on natural_key conflict, SELECT existing by natural_key, merge `participantIds`, UPDATE. Returns canonical `ConversationDefinition` (with the existing winner's id).

The current ON CONFLICT(id) DO UPDATE pattern at `sqlite-store.ts:1281–1290` becomes the path for explicit updates after lookup-by-id; the natural-key path is a separate codepath.

## 6. Client changes

`packages/web/client/lib/router.ts`:
- Delete `agentIdFromConversation` (line 392).
- `conversationForAgent` (line 398) cannot stay as a pure string function — the mapping is no longer local. Two choices:
  - **(a)** Make it return a Promise: `async function conversationForAgent(agentId): Promise<string>` that hits `/api/conversations?agentId=...`. Forces all 13 call sites in `MissionControlView`, `AgentsScreen`, `ConversationScreen`, `AgentInfoScreen`, `PlanView`, `ConductorView`, `HomeScreen`, `SessionObserve`, `ranger.ts`, `hooks.ts` to become async.
  - **(b)** Introduce `useConversationByAgent(agentId)` hook that subscribes to the `/api/conversations` cache (which `useScout` already maintains — see `useScout()` in `packages/web/client/scout/Provider.tsx` and the `setRailSessions` flow at `ConversationScreen.tsx:897`). Hook returns `string | undefined`. Call sites either await it via existing `agents`/`sessions` arrays or guard the render.

**Recommend (b).** The Provider already pulls `/api/conversations` for every user; piggybacking a `Map<agentId, conversationId>` derivation on top is one `useMemo` and zero extra network calls. The async migration in (a) would cascade across every screen.

For `routeFromUrl` `agents/{agentId}` with `tab=message` (`router.ts:113–120`): the URL no longer contains the conversation id explicitly — and that's fine. The route says "open agent X's DM"; the screen resolves the id on mount through the hook. Concretely, the route shape changes from `{ view: "agents", agentId, conversationId, tab: "message" }` to `{ view: "agents", agentId, tab: "message" }` and `AgentsScreen` calls `useConversationByAgent(agentId)`.

`packages/web/client/lib/conversations.ts`:
- `isGroupConversation(c)` collapses to `c.kind !== "direct"`. Delete the `startsWith("channel.")` fallback at line 13.
- `conversationDisplayTitle` (line 17) and `conversationShortLabel` (line 27) drop the `channel.` strip — once IDs are opaque, falling back to the id displays `c_k7x9mq3p`, which is wrong. The fallback should be `c.title` always; if a `kind:"channel"` conversation lacks a title, that's a server-side bug to fix at mint.

`packages/web/client/screens/ConversationScreen.tsx`:
- `useEffect(() => { if (conversationId.startsWith("channel.")) navigate(...) }, ...)` at line 877–881 is doing route-by-structure. With opaque ids it must read `sessionMeta?.kind === "channel"` after the load. The redirect moves out of the synchronous effect and into the `load` callback at line 934.
- Line 1602's `session.id.startsWith("channel.")` filter collapses to `session.kind === "channel"`.
- Line 1611's `channel.{slug}` minting goes through `ensureConversation` via a new `/api/conversations/ensure` POST endpoint (or reuses the existing `/api/send` flow, which already ensures the channel server-side).

`packages/web/client/screens/SessionObserve.tsx:802` and `packages/web/client/lib/ranger.ts:116`: replace with `useConversationByAgent` or with an awaited lookup.

`packages/web/client/scout/hooks.ts:151, 160, 169` (command-palette `Open/Tell/Ask {agent}` commands): currently sync. Become `async`-action handlers (the action lambdas already return `Promise<void>` in some cases — check the `applyRangerUiAction` shape). Same `useConversationByAgent` map lookup, fallback to the agent's existing `agent.conversationId` field (the API already returns it on `Agent`).

URL surface inventory (every place a conversation id appears in a URL):
- `/c/:conversationId` — pathname segment.
- `/agent/:conversationId` — `view: "agent-info"` route.
- `/agents/:agentId/c/:conversationId` — nested.
- `/messages/:conversationId` — `view: "messages"`.
- `/channels/:channelId` — note that `channelId` is *not* a conversation id today, it's a channel slug. Verify this stays a slug or becomes opaque consistently.
- `/follow?conversationId=...` — search param.
- `routeKey()` cases at `router.ts:323–354` all use the id as a cache key — no change needed, opaque ids are still strings.

## 7. URL backward compatibility

Old links like `/c/dm.operator.openscout-6.main.mini` must keep working through the transition.

**Client side:** `routeFromUrl` detects the structural form (`/^(dm|channel)\./`) on the conversation-id segment, returns a transitional route `{ view: "conversation", conversationId: structuralId, legacy: true }`. The screen calls `/api/conversations/resolve?legacyId=...` once, gets the opaque id back, and calls `navigate({ ..., conversationId: opaqueId }, { replace: true })` to rewrite the URL with `history.replaceState`. Net effect: legacy URL works; user lands on canonical URL; browser back-stack stays clean.

**Server side:** every conversation lookup-by-id has a two-step fallback:
1. `SELECT * FROM conversations WHERE id = ?`
2. on miss: `SELECT * FROM conversations WHERE natural_key = ?` (after computing the natural key from the legacy structural form by parsing it once)

This shim lives in a single helper `resolveConversationId(rawId)` and gets called from every route handler that takes a conversation id. Remove the parsing-from-legacy-structural-form path after ~6 months / one major version, leaving only natural_key lookups by intentional `naturalKey:` values.

We do **not** need a redirect-aliases table for Option A (§8) — old IDs continue to exist as their own primary-key rows.

## 8. Migration story

**Option A — Coexist forever.** Old conversations keep their structured IDs. Nothing in the protocol or schema forces ids to be opaque — only the *new* mints are opaque. The client treats every id as opaque regardless of shape. No SQL migration of FKs needed; the natural_key column lands empty and gets backfilled on first read or on a one-shot best-effort job. **Pros:** zero coordinated downtime, no FK rewrite (10 tables, see §2). **Cons:** old URLs stay ugly forever; the structural pattern remains a footgun if someone re-introduces parsing.

**Option B — One-time rewrite.** Migrate every existing conversation id to opaque. Build a `conversation_id_aliases` table mapping old → new for 6 months. Update every FK in 10 tables in one migration. **Pros:** clean slate. **Cons:** every persisted message ref, every URL in someone's notes, every harness journal entry that quotes a conversation id breaks unless aliases catch it. The aliases table is a permanent piece of infrastructure to maintain. The migration is destructive enough that a partial-failure recovery story is required.

**Option C — Lazy rewrite.** First time a structured-id conversation is touched after deploy, the server allocates a new opaque id, inserts a redirect row, and (within a transaction) updates all FK rows. **Pros:** spreads load across time. **Cons:** dual-write window for every conversation; debugging "why are there two rows for this conversation" forever; tests can't fix a snapshot of IDs because they shift on access.

**Recommendation: Option A.** The structural-id "is opaque from the client's perspective" property is enough to unblock SCO-029, thread URLs, and the primitives sprint. The ugliness of legacy URLs is a one-time, finite cost. Cleanup can be a separate proposal once Option A has been in production for a quarter and we have real numbers on (a) how many legacy URLs are still being hit and (b) how many conversations would actually need rewriting. The natural_key column gets populated for all *new* mints from day one; backfilling old rows is a cheap idempotent job we can run any time.

## 9. Thread URLs as a forcing function

Threads are `ConversationDefinition` records with `kind: "thread"` and `parentConversationId` set (`packages/protocol/src/conversations.ts:13,24`). The runtime already inserts them; nothing in the broker treats them specially relative to other conversations. SCO-029 Phase 1 explicitly wants `/c/{conversationId}` to be the renderer for *every* conversation kind.

Without opaque IDs, a thread either:
- inherits an awkward natural-key pattern like `thread.{parentId}.{messageId}`, which double-encodes parent and message into the id (and breaks the moment a thread is reparented or its anchor message moves), or
- uses a fresh non-structural id ad-hoc, at which point we already have opaque ids for threads but not for DMs/channels — and the inconsistency means client code keeps the `startsWith` paths.

With opaque ids, threads, DMs, and channels all share `/c/{c_xxxxxxxx}`. The same `MessageBubble` / `MessageComposer` / `ConversationScreen` render every kind. A thread URL like `/c/c_t8k3l9pm` works on day one of SCO-029 Phase 3 without parallel routing logic.

This is the strongest reason to do SCO-030 *before* SCO-029 ships Phase 3. If we ship threads on structured ids, we're committing to a fourth structural pattern.

## 10. Coupling with the primitives sprint

The primitives sprint expects three composable client building blocks: `useConversationList()` (#3), `LeftPanelList<T>` (#4), and the existing `MessageBubble` / `MessageComposer` already taken as primitives.

- **`useConversationList`** must return the new shape from day one: `ConversationSummary[]` with `id: ScoutId` (opaque), `kind: ConversationKind`, `participantIds: ScoutId[]`, `title`, and the existing UX-affecting fields (`lastMessageAt`, `messageCount`, `preview`, `agentName` for `kind:"direct"`). It must **not** include the legacy `SessionEntry` shape or anything that requires the consumer to parse `id`.
- **`LeftPanelList<T>`** is structurally agnostic — it just renders rows. But its consumers in `MessagesLeftPanel.tsx:196`, `ConversationLeftPanel.tsx:102`, `ChannelsLeftPanel.tsx:42` currently call `isGroupConversation(s)` to colorize rows. Those calls need to read `s.kind` directly. That cleanup *is* SCO-030 work — list it in the migration checklist.
- **`MessageBubble` / `MessageComposer`** are unaffected. They take `Message` and `MessageRecord` respectively; `conversationId` is just a string to them.

Sequencing: SCO-030 lands *before* primitives sprint #3 and #4 start in earnest. If primitives ship first with the old shape, both will have to be touched again — and given that the whole point of the primitives sprint is to lock in stable shapes, that's wasted work.

## 11. Acceptance criteria

- `ConversationDefinition.id` for every newly minted conversation matches `/^c_[a-z0-9]{8}$/` (or a well-known constant from the pinned set).
- `agentIdFromConversation` and `conversationForAgent` (in `lib/router.ts`) are deleted; no caller remains.
- `isGroupConversation` is defined as `c.kind !== "direct"`; the `startsWith("channel.")` fallback is removed.
- No source file outside `packages/runtime/src/setup.ts`'s natural-key helper and the legacy-resolution shim parses `^dm\.` or `^channel\.` on a conversation id.
- Old URLs (`/c/dm.operator.x`, `/c/channel.shared`) resolve to the same screen as their opaque equivalents and rewrite the address bar within one navigation tick.
- New `conversations.natural_key` unique index rejects parallel-broker duplicate mints; `ensureConversation` returns the winning row both times.
- A DM conversation can have its `participantIds` extended (DM → group_direct, e.g. inviting a third agent) without changing its `id`. The url stays valid; bookmarks survive.
- Thread URLs work: opening `/c/{opaqueThreadId}` renders the canonical thread feed with the thread's own message list (SCO-029 Phase 1 acceptance, now unblocked).
- A message sent from `/c/channel.shared` (legacy URL) lands on the same conversation row as a message sent from `/c/{opaqueId}` — they share storage by natural key.

## 12. Verification commands

```bash
bun test packages/web/client/lib/router.test.ts
bun test packages/web/server/create-openscout-web-server.test.ts
bun test packages/web/server/core/broker/service.test.ts
bun test packages/web/server/db-queries.test.ts
bun test packages/runtime/src/broker-daemon.test.ts
bun test packages/runtime/src/scout-broker.test.ts
bun test packages/runtime/src/sqlite-store.test.ts
bun run --cwd packages/web build:server
npm --prefix packages/cli run build
```

Migration / regression check (greps that should return zero non-test hits after the migration):

```bash
grep -rn "agentIdFromConversation\|conversationForAgent" packages apps --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -v lib/router.ts
grep -rn 'startsWith("dm\.\|startsWith("channel\.\|`dm\.\|`channel\.' packages apps --include="*.ts" --include="*.tsx" | grep -v test
```

Manual smoke checks (extends SCO-029's list):

- Open `/c/dm.operator.<agent>` — confirm address bar rewrites to `/c/c_<opaque>` and the same thread loads.
- Open `/c/c_<opaque>` directly — loads without alias lookup.
- Send a message from agent A's DM, then via REPL update the conversation row to add a third participant; reload the URL; confirm message stays visible (id unchanged) and `isGroupConversation` now returns true (kind shifted).
- Open `/agents/<agentId>?tab=message` — confirm the screen resolves the conversation id via the hook and loads messages.
- Hit `/follow?conversationId=dm.operator.hudson` — confirm the legacy id is resolved server-side and the follow surface attaches to the right thread.

## 13. Open questions

1. **ID format.** Recommend `c_` + 8 base36 chars. Open: should we use `c_` + ULID-derived (sortable) instead, accepting longer URLs for time-orderability in logs? Should threads/channels get distinct prefixes (`t_`, `ch_`) from day one or all share `c_`?
2. **URL namespace.** SCO-029 Phase 4 contemplates `/threads` as the nav root. Does the URL become `/t/{id}` to match? If so, do we go straight to `/t/` or keep `/c/` as an alias forever? Recommend: keep `/c/` always (it's short and broker-agnostic); add `/t/` as an SCO-029 deliverable, not SCO-030.
3. **Migration option.** A/B/C. Recommend A. Decision needed before the SQL migration is finalized.
4. **Well-known IDs.** Should `BROKER_SHARED_CHANNEL_ID`, `BROKER_VOICE_CHANNEL_ID`, `BROKER_SYSTEM_CHANNEL_ID`, `SCOUT_PRIMARY_CONVERSATION_ID` (which currently look like `channel.shared` etc.) be left as-is, or also opaqued as part of this rollout? Recommend leaving as-is; they're valid opaque strings under "treat ids as opaque" — opaquing them is a separate, breaking-for-existing-users rename that buys nothing.
5. **Mobile / desktop parity.** `apps/desktop/src/core/...` mirrors much of `packages/web/server/core/broker/service.ts`. Is the desktop app on the same release train as the web package, or does it ship separately? If separately, both client and server need a compatibility window where each understands both shapes.
