# Runtime identity cleanup: exact harness · model · effort, everywhere

Status: draft v3 for review · 2026-07-28
Revised after two adversarial design reviews: Grok's
(`docs/eng/runtime-identity-cleanup-review.md`, 23 findings, marked ⟨F<n>⟩) and
a second operator-dispatched review of the same draft (findings marked ⟨R2⟩;
its resolver, tuple-validation, and migration claims were re-verified against
source before adoption).

Trigger: a dispatched codex review ran on the operator's intended model only by
coincidence — the ask carried no model or effort, and `~/.codex/config.toml`
happened to hold the right values. The audit that followed found the same
looseness at every layer: asks cannot express an exact runtime, agent names can
shadow runtime vocabulary, and the UIs approximate or fabricate what is running.

Workstreams: **(A)** exact specification, **(B)** reserved vocabulary,
**(C)** honest composers and displays, **(D)** true readouts, **(E)** the help
and guidance that make A–D discoverable. Sequencing at the end — A1 ships
first and does not wait for B ⟨F22⟩.

---

## A. Exact runtime specification

An agent (or human) must be able to state harness, model, and effort exactly,
and what they state must be what spawns. The **launch ladder** (per dimension):
explicit flag or runtime literal → profile preset → endpoint metadata →
harness config file → harness default. The ladder governs *launch* only;
*readouts* come from observation (C) — the two are different truths and are
never conflated ⟨F6⟩. A **protocol-level execution-resolution record** ⟨R2⟩
carries, per dimension, three values with provenance: **requested** (what the
ask said), **resolved** (what the ladder produced at spawn, with source
`flag | literal | profile | endpoint | config | default`), and **observed**
(what the harness actually reported through observe — because a launch
argument is not proof the harness accepted it). Today no such record exists:
`InvocationExecutionPreference` stores only the request and
`FlightSessionTraceEntry` records harness/transport but not model, effort,
source, or drift (`packages/protocol/src/invocations.ts:49,109`). This record
is the machine-readable surface E.3 tells agents to verify against, and it is
defined **first** — A1's receipts and C's drift displays both consume it.

### A1. Explicit flags

```
scout ask --project ../x --harness codex --model gpt-5.6-sol --effort xhigh "…"
```

Today: no `--model` on ask; `--effort` hard-errors without `--profile`
(`apps/desktop/src/cli/options.ts:905-907`); `--profile` cannot combine with
`--harness` (`:911-913`); `reasoningEffort` rides only the `runtime_profile`
route target (`apps/desktop/src/core/broker/ask.ts:281`) and never becomes
`execution.reasoningEffort`; `deliverScoutAsk` has no model/effort params
(`apps/desktop/src/core/broker/service.ts:3951-3971`).

The protocol already has the full vocabulary
(`packages/protocol/src/invocations.ts:49-66` `InvocationExecutionPreference`)
and both spawn paths already honor it: codex emits `-c model=…` and
`-c model_reasoning_effort=…` (`packages/agent-sessions/src/local/transports/codex-app-server.ts:282-380,960-974`),
claude passes `--model` / `--effort` (both real CLI flags, verified against the
installed binary) via `packages/runtime/src/local-agents.ts:1212-1331`. Only the
web ask route populates them (`packages/web/server/core/broker/service.ts:2898-2914`).

Changes:
1. `--model` flag on ask; `--effort` legal without `--profile`; `--profile`
   combinable with explicit flags — the profile is a base preset, explicit
   dimensions override its fields (`packages/runtime/src/broker-delivery-routing.ts:82-87`
   inverts: preset becomes base, `payload.execution` wins).
2. Thread model/effort through `ScoutAskCommandBase`
   (`apps/desktop/src/core/broker/ask-types.ts:15-40`) → ask handler →
   `deliverScoutAsk`, copying the web service's execution mapping verbatim.
3. Declare `reasoningEffort` in the boundary schema as the 8-value enum
   (`packages/runtime/src/broker-command-boundary-schemas.ts:150-159` — today it
   survives only via `.passthrough()`, unvalidated) — **and** validate the
   full harness × model × effort tuple at the broker against the capability
   catalog ⟨R2⟩: efforts are harness-scoped (`none`/`minimal`/`ultra` are
   codex-only, `create-openscout-web-server.ts:4394-4403`), so a shape-valid
   enum value like `claude` + `ultra` must still fail closed with the
   dimension named. The enum checks shape; the catalog checks legality.
4. **Existing targets: exactness requires an isolated session** ⟨F5,R2⟩. An
   exact runtime on an ask that targets an existing agent never writes
   endpoint metadata (no re-stamp — a named agent's durable configuration
   cannot be mutated by passing asks, and concurrent asks cannot race on
   shared state). But launch-only override is not sufficient either: the
   endpoint resolver reuses a live broker-runnable endpoint even when the
   session preference is `"new"`
   (`packages/runtime/src/broker-local-endpoint-resolver.ts:93-110`), and
   launch arguments cannot reconfigure a running session. Rule: an explicit
   runtime request **bypasses live-endpoint reuse and spawns an isolated
   session**, unless the selected session is *observed* to already match the
   requested tuple. Corollary session policy ⟨missing-12⟩: exact model/effort
   combined with `session:<id>` fails closed unless that session's observed
   runtime matches; exact runtime otherwise implies a fresh session, and the
   error message says so.
5. Mirror the fields into the MCP ask tool
   (`apps/desktop/src/core/mcp/scout-mcp.ts:3953-4004` — no model/effort/profile
   today) and the desktop HTTP contract
   (`apps/desktop/src/server/routes/ask-contract.ts:26-37`), and widen both
   harness enums from `["claude","codex","pi"]` to `SUPPORTED_SCOUT_HARNESSES`.
6. ACP harnesses: fail closed **per dimension, per harness** ⟨F10⟩ — grok/kimi
   reject effort today; whether each accepts model is verified per transport,
   not assumed to travel with effort. Rejections name the dimension.
7. Conflicts fail closed, per this compatibility rule ⟨F7⟩: a profile plus an
   explicit dimension is legal iff the explicit value is valid for the
   profile's harness (catalog-validated); a harness contradiction is an error;
   a redundant same-value flag is fine; `--runtime` (A2) plus any overlapping
   explicit flag with a different value is an error. The matrix ships as parse
   tests, not prose ⟨missing-14⟩.
8. **Normalization is catalog-owned and single-sourced** ⟨F9⟩: one shared
   `normalizeModel(harness, raw) → resolved | error` used by CLI, MCP, web,
   and spawn. Codex shorthand (`5.6 → gpt-5.6-sol`,
   `codex-app-server.ts:216-227`) folds into it; ambiguous shorthands
   (`mini`) are errors naming the candidates. Receipts store requested AND
   resolved (drift diagnosis needs both).

### A2. Runtime literal — a separate production, not an agent identity ⟨F1,F2,F4⟩

The review killed the relative-sigil design (same glyphs meaning different
dimensions by base kind): it couples parsing to a mutable reserved set,
overloads `parseAgentIdentity` for every consumer, and the unquoted form does
not even survive a shell (`#` comments, `?` globs). Decisions:

- **`RuntimeSpec` is its own type** — parse, format, JSON, MCP field,
  receipts — never an `AgentIdentity`. `parseAgentIdentity` is untouched.
- **Canonical spelling is slash-delimited, fixed positions, shell-safe:**

  ```
  codex/gpt-5.6-sol/xhigh
  claude/fable/max
  claude/opus
  codex
  ```

  Segments fill left to right: harness, harness/model, harness/model/effort.
  Sparse combinations (harness + effort, no model) use flags — no placeholder
  segments, no token-class guessing.
- Accepted as `--runtime <spec>` and as a bare leading token in the
  natural-language form (`scout ask codex/gpt-5.6-sol/xhigh to review the
  diff`), which **desugars to the equivalent explicit flags before target
  counting** ⟨F8⟩ — same `to`-keyword behavior and current-project inference
  as the profile form, producing a fresh cardless session; `--project`
  narrows it exactly as for profiles ⟨missing-11⟩.
- The agent-selector sigils keep today's fixed meanings forever — `#` is
  always harness, `?` is always model, on an agent base
  (`@hudson#codex?sonnet`) — and **effort never becomes an identity
  dimension**: it lives on `InvocationExecutionPreference` and receipts only.
  No `effort` entry in `DIMENSION_ALIASES`; `@hudson.effort:x` stays illegal.
- **Bare-token priority table** ⟨F3⟩, applied at NL parse and documented in
  the same words everywhere:
  1. reserved profile id → profile launch (today's behavior, preserved —
     `kimi`/`grok` stay profiles when bare);
  2. else reserved harness name → runtime spec (harness-only);
  3. model-family words are never valid bare — model belongs in model
     position (slash segment 2, `?` on an agent base, or `--model`);
  4. agent name — never, post-B.
  If a profile and harness of the same name ever diverge, bare stays profile
  and the slash form pins the harness — the table makes that day boring.

### A3. Profiles remain presets

`Fable` / `Opus` / `Kimi` / `Grok` stay as launch presets
(`packages/runtime/src/broker-runtime-profiles.ts:15-40`) — explicitly defined
as *defaults over the same execution fields*, overridable per A1.7.

---

## B. Reserved vocabulary — runtime words cannot name agents

Today there are three unconnected reserved lists (profiles
`packages/protocol/src/runtime-profiles.ts:7-12`, route words
`packages/runtime/src/broker-route-alias-service.ts:37-41`, product identities
`packages/protocol/src/agent-identity.ts:88-95`) and **none is consulted at any
creation path**. Consequences, all reproduced in the audit:

- `scout up --name codex` succeeds; `@codex` then resolves to that agent while
  `--harness codex` means the harness — two meanings, one word.
- An agent named `opus` is silently unreachable through the natural-language
  CLI (the profile always wins, `apps/desktop/src/cli/options.ts:266-303`).
- `gpt-5.6-sol` as an agent name is silently rewritten to `gpt-5-6-sol`
  (`agent-identity.ts:62-69`); as an alias it is rejected on charset — the two
  normalizers disagree.
- Cardless session handles get zero validation
  (`packages/runtime/src/broker-cardless-session.ts:90-92`).

Changes:
1. One composed reserved-vocabulary module in `packages/protocol`. Principle
   ⟨R2, narrowing F11⟩: reserve only tokens with **bare grammar meaning** —
   words that can stand alone in some parse position. **In**: the launchable
   runtime ids (`SUPPORTED_SCOUT_HARNESSES`, 8 —
   `packages/runtime/src/local-agents.ts:470-476` — not the internal
   `AGENT_HARNESSES` categories `native`/`worker`/`bridge`/`http`, which are
   never typed in a runtime position), profile ids, product identities, the
   full existing route-word set, the 8 effort tokens (bare in the
   natural-language effort position — naming an agent `high` is a real
   footgun), dimension keys (`harness`, `model`, `profile`, `node`,
   `workspace`, `effort`), and built-in definition ids (`builder`,
   `reviewer`, `research`). **Out**: the full model-id catalog (community-
   derived, churning — an update must never retroactively invalidate an agent
   name) and model-family keys (`sonnet`, `haiku`, … only ever appear in
   model *position*; the priority table already makes them never-bare).
   Exact model ids are validated only in model position, never as a global
   name ban. The boundary-schema harness duplicate
   (`broker-command-boundary-schemas.ts:15-27`) imports from protocol instead
   of re-declaring.
2. Enforce at every creation path:
   - the two normalizers — `provisional-agent-names.ts:44-51` explicit branch,
     `broker-route-alias-service.ts:54-63`;
   - the bypasses — `local-agents.ts:4500-4506` (`startLocalAgent`),
     `broker-daemon.ts:1094-1106` (explicit `projectAgent.handle`);
   - the boundary schemas — MCP `card_create.agentName`, `aliases_set.alias`.
   Cardless session **handles are a separate domain** ⟨F14⟩: they get their
   own charset policy (harness-native ids are opaque and may need characters
   agent names forbid) plus the reserved check, specified independently.
3. Resolution-side symmetry so pre-existing bad names cannot shadow runtime
   semantics: widen `isReservedProductIdentity`
   (`packages/runtime/src/scout-dispatcher.ts:177-189`) and apply it in
   `resolveExistingHandle` and `resolveTargetHandle` (today only
   `resolveAgentLabel:542` checks). **Bare** runtime words prefer runtime
   semantics; after the one-time development migration, any remaining stored
   offender fails startup with `reserved_name_existing` rather than entering a
   deprecation window.
4. Loud, teaching errors with stable error codes ⟨F21⟩: `name "codex" is
   reserved — it names a harness. To target the harness: --harness codex, or
   codex/<model>/<effort>. Pick a non-runtime word to name an agent.`
5. **Write-validate, read-normalize** ⟨F13⟩: new names must match the strict
   pattern after normalization or be rejected loudly — but resolution keeps
   normalizing historical stored forms (rewritten ids, transcripts, aliases)
   so existing handles keep resolving. No silent rewriting on the write path.
6. **One-time local migration, then fail closed.** The development control
   plane was migrated once in place so its two historical `openscout`
   identities retained their durable references. No general rename command is
   shipped. Any other stored project or registry entry using a reserved name
   fails startup with `reserved_name_existing` and must be repaired explicitly.
   Inferred new names use a non-reserved `-agent` suffix automatically.

---

## C. Honest composers and displays

Two surfaces already do this right — web `NewChatComposer`
(`packages/web/client/screens/agents/NewChatComposer.tsx:445`) and the macOS
HUD runner (`HUDRunnerState.swift:865-902`) — both consume
`/api/runner/options` (`create-openscout-web-server.ts:4485-4575`), which
merges the static catalog with observed fleet models. Every other composer
invents its own options. The rule: **option lists come from the capability
endpoint; readouts come from observation.**

The endpoint gets a defined contract before convergence ⟨F15⟩: versioned
payload schema shared by web, macOS, iOS bridge, and `scout runtimes`;
explicit project-scope parameter (global catalog vs project fleet vs both,
labeled by source); and **effort-legality per harness/model** in the payload
so composers cannot assemble combinations A1.7 would only reject at dispatch.
Mobile gets an offline policy — the iOS hardcoded catalog becomes a cold-start
seed only, replaced by a cached last-fetched catalog (stale-while-revalidate)
so a phone away from its Mac does not regress. The shared `RuntimePicker`
contract (value, onChange, options, disabled dimensions,
requested-vs-default markers) is specified once for web/iOS/macOS.

Composers to converge:
- Web BrokerScreen ask module (`screens/broker/BrokerScreen.tsx:1405-1482`):
  model select is the union of models already observed in the project, effort
  list is 4 of the 8 real values, there is **no harness control** (silently
  inherited from the chosen agent at `:1023`), and **Retry dispatch drops the
  entire execution block** (`:984-997`) while displaying the harness+model it
  just discarded. Replace the four bare selects with `RuntimePicker` fed by
  runner options; retry resends the original execution — which requires the
  invocation record to persist requested execution; if it does not today,
  that schema change is part of this workstream ⟨F16⟩.
- Web home quiet-start (`screens/home/content.tsx:1124-1139`): 3 hardcoded
  harnesses, model list = the agent's single current model.
- iOS `RuntimePicker.swift:77-120`: hardcoded catalog, 4-stop effort ladder
  missing `xhigh/max/ultra/none/minimal`. iOS session launcher
  (`AgentsSurface.swift:687,791`): 2 hardcoded harnesses, model as free text,
  no effort.
- macOS `ScoutSessionService.swift:36-55`: a second hand-maintained catalog
  diverging from the server's; delete in favor of the HUD path.

Displays to make truthful — a bounded inventory, not "everywhere" ⟨F17⟩; each
row is accept-or-defer at implementation time:
- `ConversationHeader.tsx:119` renders the harness name in the model slot when
  model is unknown — show "model unknown", never a substitute.
- Fields labeled `Harness` containing harness+model
  (`BrokerScreen.tsx:218`, `AgentDetailCard.tsx:106-113`) get honest labels.
- Effort renders beside model on: session observe (already does), ops lane
  card (already does), agent profile header, conversation header, macOS
  pending-ask card (reads `draft.reasoningEffort` and drops it,
  `ScoutRootView.swift:6167-6173`).
- Requested-vs-observed drift, generalizing `profile.tsx:407-410`: agent
  profile, session observe, work detail (`WorkDetailScreen.tsx:284-286` gains
  requested/resolved model+effort beside its harness rows).
- Project rollups stop synthesizing (`agents-project-model.ts:79-80` reports
  mostCommon harness + first non-null model for a mixed fleet).
- iOS wire structs gain `effort` (absent from all of `ScoutIOSCore`); Claude
  observe gains effort so the observed side is complete
  (`packages/runtime/src/claude-stream-json.ts:494-498` records model only).

### C.5 Host-published runtime catalog ⟨v3.1 addendum, operator-requested⟩

The picker must be instant and the menu must reflect what this host's
configured subscriptions actually offer — not just the seed plus whatever the
current project's 50 most recent agents happen to run.

**Assembly (broker-side, one product).** The catalog =
`SCOUT_RUNTIME_MODEL_CATALOG` seed ∪ **fleet-observed distinct
(harness, model) pairs across the store's full history** (agents + sessions
tables both carry `model`; one indexed `SELECT DISTINCT`, not
project-scoped `queryAgents(50)`) ∪ harness readiness from
`loadHarnessCatalogSnapshot()` (binary presence, version, auth state — this is
where "configured subscriptions" surfaces: a harness with no binary or no auth
is listed dimmed-with-reason, never hidden). Observed entries keep
`source: "observed"` so UIs rank curated defaults first; the retired-model
filter (`isRetiredHudRunnerModel`) still applies.

**Persistence + TTL.** The broker persists the assembled catalog
(`generatedAt`, schema v1) in its home dir. Recompute lazily after **24h**, or
eagerly when the harness-catalog snapshot changes (binary version or auth
delta — those are the only events that change the menu). Assembly is cheap;
the cache exists to make the payload *stable and pushable*, not to hide cost.

**Transport — the catalog comes with the host.** Pickers never fetch on open.
The persisted catalog rides the payloads each client already receives at
boot/handshake: the web bootstrap payload, the mobile bridge hello (the mobile
service already serves the v1 schema), and the macOS HUD state feed.
`/api/runner/options` remains the pull/refresh path serving the same persisted
object (ETag on `generatedAt` for cheap revalidation).

**Client semantics.** Cold-start seed (`lib/runtime-capabilities.ts`
`RUNTIME_CAPABILITY_SEED`, iOS hardcoded list) renders synchronously →
replaced by the host catalog from the boot payload → persisted per device
(localStorage / iOS defaults) with the same 24h stale-while-revalidate
window, so a phone away from its Mac keeps last-known-good. This subsumes the
C mobile offline policy above — one cache rule for all three clients.

2026-07-29: seed expanded with the host's verifiable subscription models
(Opus 4.8/4.7, Sonnet 4.5, Grok 4.5/4.3) in both `runtime-execution.ts` and
`runtime-capabilities.ts`; Kimi/Cursor model ids are deliberately absent from
the seed — no verifiable ids in-repo; they arrive via the fleet-observed
union.

---

## D. True readouts (Projects screen)

Observed 2026-07-28 on `/agents/...` (screenshot on file); all four traced
live. The class: records and defaults rendered as if they were observations.
Split ⟨F18⟩: **D-small** (this lane) vs the **history feed** (its own lane and
eng doc — a new durable API over harness-owned files, not a bugfix).

D-small:
1. **Turns counter** — `/api/agents/:id/session/context` returns the relay
   ledger's hard `0` for observed-only sessions
   (`packages/runtime/src/local-agents.ts:1997`) and `?? 0` shadows the
   correct observed count (`screens/agents/profile.tsx:238`; also
   `right.tsx:1233`, `SessionObserve.tsx:2586-2588`). Observed count wins;
   ledger only when a ledger exists; `—` when neither is known.
2. **Active-agents stat** — counts registry rows and structurally cannot do
   otherwise (`summarizeAgentState()` discards endpoint state via
   `void rawState;`, `packages/web/server/db/internal/sql-helpers.ts:131-148`;
   client "online" = not-blocked, `client/lib/agent-state.ts:29-56,88-91`; the
   number tracks the 100-row cap). Decision ⟨F19⟩: **relabel now** to what it
   counts ("Registered"); a real "Live" metric (definition: active flight vs
   live harness process) is designed separately in concepts.md — no hybrid
   count invented inside a readout fix.
3. **Transport** — `DEFAULT_TRANSPORT = "tmux"`
   (`packages/runtime/src/setup.ts:425,971,3315`) flows into
   `agent_endpoints.transport` and out through `RuntimeGrid`
   (`screens/agents/right.tsx:884-914`); all 100 agents uniformly report
   `tmux · Agent · general`. Rule ⟨F20⟩: transport renders **only from live
   attach/observe metadata**; the endpoint column survives in the data model
   as "launch transport" but leaves the runtime slot. RuntimeGrid takes
   observe metadata, labels the source ("observed via transcript"), and shows
   the observed model (`claude-fable-5` reaches the client today and is never
   rendered, `observe/service.ts:541-548`).
4. **Empty projects rail** — one-line honesty fix now: the empty state says
   "no live session" (the feed is a 24h live scan,
   `packages/runtime/src/tail/claude-source.ts:19-24,250`; history exists on
   disk and is simply not read). Plus the two projection/identity bugs:
   `upsertEndpoint` stamping `observedAt = now()` on every write including
   journal replay (`sqlite-store.ts:1795-1830`, `sqlite-projection.ts:210` —
   why every stale checkout looks active today, forever), and the
   canonicalization defects (`/tmp` vs `/private/tmp` never converge,
   `~/.codex/worktrees/*` collapses to a phantom `~/.codex` project,
   `stripNodeQualifier` invents on-disk-nonexistent roots —
   `screens/agents/project-identity.ts:67-140`).

D-history (separate lane, own doc): the per-project transcript-history feed —
indexing, caps, multi-harness path rules, privacy posture.

---

## E. Help and guidance

Exactness only works if agents can discover the exact names — in every
surface they actually read ⟨F21⟩.

1. `scout runtimes` (exists in both CLIs,
   `packages/cli/src/node-main.ts:73`, `apps/desktop/src/cli/registry.ts:16`)
   grows the full capability catalog — harness × models × efforts with
   legality, from the same source as `/api/runner/options`, with `--json`.
2. `scout ask --help` (`apps/desktop/src/cli/commands/ask.ts:27-84`)
   documents both forms side by side, the launch ladder, the bare-token
   priority table, and the conflict rules — with shell-safe copy-paste
   examples (the slash literal needs no quoting; that is part of why it won).
3. MCP tool descriptions carry the same contract — agents on MCP never see
   CLI help.
4. Stable error codes for every rejection (reserved name, unsupported
   dimension, conflict, session-policy) so agents can branch, plus prose that
   teaches the correct form.
5. Receipt shape documented: requested + resolved + source per dimension —
   the verification path ("check what actually spawned") in `AGENTS.md`,
   `docs/agent/README.agent.md`, `docs/agent/scout-comms.agent.md`.
6. `architecture.md` and `concepts.md` grammar/identity sections update in
   the same PR that lands the runtime literal — the public grammar does not
   change via agent-README crumbs alone.

---

## Sequencing ⟨F22,F23⟩

1. **Contracts, then A1 + E scaffold** ⟨R2⟩ — first the two protocol
   contracts (the execution-resolution record with
   requested/resolved/observed per dimension, and the versioned capability
   payload with tuple legality), then flags through deliver, boundary enum +
   broker tuple validation, MCP/HTTP mirrors, per-dimension fail-closed,
   conflict rules, isolated-session semantics for exact runtimes. Fixes the
   trigger incident; depends on nothing else.
2. **D-small** — the four honesty fixes + projection/identity bugs. Small
   diffs, high value, parallel to A1.
3. **B** — reserved module + creation/resolution guards + doctor check and
   fixup + read/write normalizer split. Breaking; ships with the migration
   note.
4. **A2** — the RuntimeSpec literal (needs B for bare harness words; grammar
   decisions above are settled).
5. **C** — endpoint contract first, then web composers against it, then
   mobile once the offline policy exists.
6. **D-history + fleet liveness** — a separate observability proposal ⟨R2⟩:
   the transcript-history feed and the real "Live" agents metric share a
   definition problem (what counts as observed-alive) and travel together,
   apart from this lane.
7. **E** — completes per surface as each lands, not only with A.

Each step rides the staging worktree and the two-review bar. Out of scope
here, already ticketed separately: `scout session intake` delete/dry-run verb;
`mobile/workspaces` latency budget; relay-registry name prettification.
