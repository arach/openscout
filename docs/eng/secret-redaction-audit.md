# Secret redaction: leak-path audit and boundary implementation

**Status:** audit complete; boundary redaction implemented (2026-08-05)
**Companion:** [secret-redaction-brief.md](./secret-redaction-brief.md) (incidents, motivation, gotchas)

## 1. What was landed

A default-deny redaction registry plus scrubbing at the log/tail/persistence
boundaries. Provenance, not names: every credential resolver registers the
exact string it resolved; every boundary scrubs registered strings.

**Core module** — `packages/agent-sessions/src/secret-redaction.ts`
(exported via `@openscout/agent-sessions` and
`@openscout/agent-sessions/secret-redaction`):

- `registerSecretValue(value, source)` — registry of resolved credential
  strings, min length 8, compiled into one longest-first alternation regex.
- `redactSecrets(text)` / `redactSecretsDeep(value)` — string and
  structured-payload scrubbing.
- `patchConsoleForSecrets()` — scrubs all `console.*` string/Error args
  (covers broker stdout/stderr log files; `process.stdout.write` bypasses it
  and is scrubbed at call sites instead).

**Registration sites (resolver → registry):**

- `packages/agent-sessions/src/adapters/opencode-acp/adapter.ts` —
  `providerKeyEnv()` registers the keychain-resolved and env-provided key.
- `packages/runtime/src/pi-rpc.ts` — `buildPiRpcCredentialEnv()` registers
  every resolved mapping value (env or `secret` CLI).
- `packages/agent-sessions/src/adapters/pi/adapter.ts` —
  `buildPiProcessEnv()` registers copied provider credentials.
- `packages/agent-sessions/src/adapters/grok-acp/adapter.ts` —
  `resolveGrokEnvironment()` registers the bridged xAI key.
- `packages/runtime/src/secret-redaction-bootstrap.ts` (new) — broker boot:
  (a) loads the varlock env graph from `.env.schema` **as a library**
  (`internal.loadEnvGraph` → `resolveEnvValues` → register every item that is
  `isSensitive` **or has any value resolver** — the layer that catches the
  `GH` case); (b) registers values of the declared credential env names
  (the harness-catalog contract list) for launchd-provided env that no
  resolver touches. Best-effort, never throws; wired into
  `broker-daemon.ts` before `listenTcp`, with `patchConsoleForSecrets()`.

**Scrubbing sinks:**

- Tail firehose: `packages/runtime/src/tail/service.ts` — `compactEvent`/
  `compactRawValue` (all buffered + streamed events) and `redactTailEvent`
  on the whole-file `parseFile` path.
- Durable persistence chokepoint: `broker-flight-lifecycle-service.ts`
  `recordFlight()` scrubs `output`/`error`/`summary` before journal →
  sqlite → work-item promotion → mesh forwarding.
- Raw disk logs: `claude-stream-json.ts` and
  `agent-sessions/src/local/transports/codex-app-server.ts` scrub chunks
  before `appendFile` (incl. the unparsable-output dump).
- `acp/adapter.ts` — stderr scrubbed before it lands in
  `providerMeta.lastStderr` (served to the web UI).
- stderr-derived errors: `pi/adapter.ts` exit error, `local-agents.ts`
  relay-agent spawn error, `mcp-discovery.ts` `formatStderr()`.

Tests: `agent-sessions/src/secret-redaction.test.ts`,
`runtime/src/secret-redaction-bootstrap.test.ts` — hermetic, fake values
only.

## Verification

- `bun run --cwd packages/agent-sessions check` clean; 171 tests pass incl.
  `secret-redaction.test.ts` (12 tests, fake values only).
- `bun run protocol:check` clean.
- `bun run runtime:check` clean; runtime suite 1051 pass / 6 fail — the 6
  are the other agent's churn (thread/mesh `/v1/messages` 400s, cardless
  session record shape) plus none from this change; the two
  broker-daemon-thread-mesh failures were flagged pre-existing in the brief.
- Smoke against the real `.env.schema`: broker bootstrap registers 5 values
  — sources `varlock:EXAMPLE_ITEM`, `varlock:GH`, `varlock:HERMES_API_KEY`,
  `varlock:NPM_TOKEN`, `varlock:SCOUT_OPENCODE_API_KEY`. The `GH` PAT
  (incident 2) is covered by provenance; name heuristics are not involved.

## 2. Audit: every path a resolved credential can reach a reader

### 2.1 Resolution sites (credential → plain string)

| Site | Mechanism |
| --- | --- |
| `packages/agent-sessions/src/adapters/opencode-acp/adapter.ts:100-114` | `keychainSecret()` — `spawnSync("secret", ["get", name])`; falls back to absolute `~/.local/bin/secret`, which is why PATH-prepend test isolation failed (incident 1) |
| `packages/agent-sessions/src/adapters/opencode-acp/adapter.ts:125-140` | `providerKeyEnv()` — env → keychain fallback; result injected as `OPENCODE_API_KEY` into child env at :151-162 |
| `packages/runtime/src/pi-rpc.ts:159-169` | `readSecretValue()` — `execFileSync("secret", ...)`. **No command-override seam** (unlike opencode-acp); any test touching it is non-hermetic by default |
| `packages/runtime/src/pi-rpc.ts:171-217` | `readMappedCredentialValue()` / `buildPiRpcCredentialEnv()` — minimax + xai mappings |
| `packages/agent-sessions/src/adapters/pi/adapter.ts:59-96,227-249` | `PROVIDER_CREDENTIAL_ENV` (18 providers incl. AWS triple) + `buildPiProcessEnv()` — env-only copy |
| `packages/agent-sessions/src/adapters/grok-acp/adapter.ts:49-71` | `resolveGrokEnvironment()` — env-only xAI bridge |
| `packages/runtime/src/cursor-transport-spike/auth.ts:36-61` | `resolveCursorApiKey()` — env, else parses `~/.cursor/api_key.env` |
| `crates/scoutd/src/main.rs:2382-2401` | `security find-generic-password -s net.oscout.session` → `OPENSCOUT_PUSH_RELAY_SESSION` child env |
| `scripts/pi-minimax-up.mjs:328-344` | `readLocalSecret()` — third independent `secret` CLI resolver |
| `apps/desktop/src/core/broker/service.ts:5220` | `OPENAI_API_KEY \|\| config.openaiApiKey` — **plaintext key in `config.json`** (loaded :5154-5164) → `Authorization: Bearer` :5228 |
| `packages/web/server/scoutbot-credentials.ts:53-61` | encrypted scoutbot store; `previewSecret` (:103-105) deliberately exposes first-5/last-4 chars to UI |
| `packages/web/server/scoutbot-assistant.ts:395-399`, `routes/voice.ts:169,477-485,519-527`, `service-budgets.ts:962-969,1549-1551`, `routes/scoutbot.ts:935-940` | web-server OpenAI/Kimi/MiniMax key paths — **outside this change's scope; web has no redaction wiring** |

### 2.2 Leak paths (string → something a human/agent reads)

Severity: does a resolved credential plausibly pass through?

1. **Raw harness stream logs on disk — highest volume.**
   `agent-sessions/src/local/transports/codex-app-server.ts:987-993,1117`;
   `packages/runtime/src/claude-stream-json.ts:1021-1035`; tmux `pipe-pane`
   at `packages/runtime/src/local-agents.ts:4178-4182`. Unbounded append-only
   capture under `runtime/agents/*/logs` and `~/.scout/local/codex/*/logs`.
   **Now scrubbed** except pipe-pane (see §3).
2. **Tail firehose.** `tail/service.ts` `pushEvent()` (:261) funnels
   transcript-derived events (`raw` strings up to 1000 chars — truncation,
   not redaction) into buffers → tRPC `tail.recent`/`tail.events`
   (`broker-trpc-router.ts:318-360`) → SSE broadcast
   (`packages/web/server/core/broadcast/service.ts:24`) and HTTP
   `GET /v1/tail/recent` (`broker-http-router.ts:635-641`) → ~8 web screens.
   **Now scrubbed** at `compactEvent`/`compactRawValue`/parseFile path.
3. **Flight records (durable + cross-machine).** Adapter `result.text` →
   `BrokerFlightLifecycleService.recordFlight()`
   (`broker-flight-lifecycle-service.ts:221`) → journal JSONL → sqlite
   `flights.output/error/summary` (`drizzle-schema.ts:321-323,345-346`) →
   work items (:258) → mesh POST `/v1/flights`
   (`broker-mesh-forwarding-service.ts:343`) → A2A responses
   (`a2a-http-endpoint.ts:476-484`) → `GET /v1/invocations*`
   (`broker-http-router.ts:1010-1092`). **Now scrubbed** at `recordFlight`.
4. **stderr → providerMeta → UI.** `acp/adapter.ts:666-670` put 4KB raw
   stderr into `providerMeta.lastStderr`, shipped in session snapshots
   (`packages/web/server/pairing.ts:968-991`). Provider SDKs print auth
   failures/key fragments to stderr. **Now scrubbed.**
5. **stderr-derived Error messages.** `pi/adapter.ts:336-342` (→
   `registry.ts:87` console.error + session error state);
   `local-agents.ts:4218-4225` (→ `flight.error` → sqlite + mesh);
   `mcp-discovery.ts:246-248,375-378`; `broker-process-manager.ts:767-771`
   (scoutd buffers); `iroh-bridge.ts:186,315,321` → `broker-daemon.ts:707`
   console.warn. **Now scrubbed** at each construction site; broker
   console.* additionally patched at boot.
6. **Broker daemon logs.** ~87 `console.*` sites in `packages/runtime/src`
   (`broker-daemon.ts` alone ~58, many logging raw Error objects with
   stacks) → `broker.stdout.log`/`broker.stderr.log` under
   `~/Library/Application Support/OpenScout/logs/...`
   (`base-daemon.ts:112-116`, `broker-process-manager.ts:430-431`).
   No site logs env/headers directly; risk is stderr-bearing errors (5).
   **Covered** by `patchConsoleForSecrets()` at broker boot.
7. **Knowledge index (`scout search` corpus).**
   `knowledge/session-indexer.ts:523,534,780-782` deliberately indexes tool
   results and assistant text into a durable, full-text-searchable corpus.
   **Not scrubbed** (see §3).
8. **Test output.** Incident-1 site
   (`opencode-acp/adapter.test.ts:256-290`) is already remediated
   (`secretCommand` stub), but `useKeychain` still **defaults to true**
   (`adapter.ts:155`) and the value-into-assertion pattern
   (`adapter.test.ts:63,221,251,288`) remains the amplifier for any future
   test that forgets both guards. Fake-harness env dumps also persist
   env-derived values (`acp-agent-invocation.test.ts:28,37-39`,
   `kimi-acp-invocation.test.ts:33`, `grok-acp-invocation.test.ts:38`).
9. **Journal/durable text fields generally** (`broker-journal.ts:270-291`):
   `messages.body`, `invocations.task`/`contextJson`,
   `delivery_attempts.error`, `durable_checkpoints.payloadJson`. These carry
   operator/agent-authored text; flight text is now scrubbed upstream, but
   nothing stops an agent from pasting a key into a message body — see §3.
10. **executionResolution** — clean: harness/model/effort dimensions only
    (`packages/protocol/src/runtime-execution.ts:307-315`); no env content.
    No production code logs a child env dict. The env risk is indirect:
    children inherit `{...process.env, ...config.env}`
    (`acp/adapter.ts:656`), so any env-dumping tool call or SDK auth error
    prints keys to stdout/stderr, which then flows through paths 1-6.

### 2.3 readiness.anyOf inventory (for §4)

`packages/runtime/src/harness-catalog.ts`: claude :181-189
(`ANTHROPIC_API_KEY`); grok :220-229 (`XAI_API_KEY`, `SCOUT_XAI_API_KEY`);
codex :264-271 (`OPENAI_API_KEY`); grok-acp :303-311 (xAI pair); kimi
:343-349 (file only); opencode :381-395 (`OPENCODE_API_KEY`,
`SCOUT_OPENCODE_API_KEY`); cursor :432-436 (healthcheck only); flue
:464-472 (`MINIMAX_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`OPENROUTER_API_KEY`); pi :500-513 (7 keys). Evaluation is pure
env-presence (:643-649 against `options.env ?? process.env` :826) — **no
keychain awareness**, so a launchd-started broker misreports readiness.
Duplicate: web BYOK catalog
`packages/web/server/create-openscout-web-server.ts:4433-4465`.

## 3. Residual gaps (not fixed in this pass)

- **tmux `pipe-pane`** (`local-agents.ts:4178-4182`): tmux writes the pane
  directly to `stdout.log`; the broker never sees the bytes. Needs a
  post-hoc scrubber (watcher that rewrites the log) or replacing pipe-pane
  with an intermediary. Highest-volume unscrubbed sink remaining.
- **Knowledge indexer** (`knowledge/session-indexer.ts`): durable,
  queryable corpus of tool results/assistant text. Scrubbing at record
  construction (~:508-543) is the same one-line pattern; left out to keep
  this diff additive-only in churned-adjacent files. Recommended next.
- **Web server** (`packages/web`): own credential paths (scoutbot store,
  voice, budgets) and its own console/logging; no registry wiring. The
  registry module is importable from `@openscout/agent-sessions` when web
  is ready to adopt it.
- **apps/desktop**: plaintext `openaiApiKey` in relay `config.json`
  (`service.ts:593,5154-5164`) — a storage defect, not just a logging one.
- **`process.stdout.write`/`process.stderr.write`** bypass the console
  patch; known call sites that append streams were scrubbed, but the
  pattern is a convention, not a guarantee.
- **Encoded variants**: a secret that reaches output base64- or
  URL-encoded does not match the registry. Could register encoded forms at
  registration time if this shows up in practice.
- **Message bodies / invocation tasks**: agent-authored free text is only
  scrubbed if it passes a boundary that scrubs (flights do; messages don't).
  An agent that pastes its own key into a DM body still lands in sqlite.
  Consider scrubbing `messages.body` at the journal boundary as follow-up.
- **`pi-rpc.ts:159` has no `secretCommand`-style override seam** — any
  future test near it can run the real `secret` CLI (incident-1 shape).
  Add the seam before writing tests there.
- **`useKeychain` defaults to true** (`opencode-acp/adapter.ts:155`):
  correct for production, hazardous for tests. Consider an explicit
  opt-in in test construction instead.

## 4. Proposal: readiness.anyOf → .env.schema (NOT landed)

**Recommendation: worth doing, in two steps, after operator sign-off.**

What `.env.schema` already proves: `exec(\`secret get NAME\`)` resolvers work
on macOS today, `varlock()` covers non-macOS, and the graph load added in
this change already makes the schema the runtime's source of sensitive-value
truth at broker boot.

Proposed shape:

1. Declare every provider key in `.env.schema` once, with resolvers:
   macOS `exec()` → `secret`, elsewhere `varlock()` (or 1Password plugin for
   teams). Mark `@required=false`; `@defaultSensitive=true` stays pinned.
2. Replace each `readiness.anyOf` env-check in `harness-catalog.ts` with a
   lookup against the loaded varlock graph (or a thin
   `credentialAvailability()` helper backed by the graph): readiness becomes
   "is this schema item resolvable" instead of "is this env var present" —
   which also fixes the launchd/keychain blind spot (:643-649) for free.
3. The three independent `secret` CLI resolvers (opencode-acp :100,
   pi-rpc :159 — which lacks an override seam, scripts/pi-minimax-up.mjs
   :328) collapse into schema `exec()` lines; adapters keep an env-var
   override path for ad-hoc use.
4. Keep file-based checks (`auth.json`, CLI presence, healthchecks) in
   harness-catalog — they are not credentials and don't belong in the schema.

Watch-items:

- `exec()` does **not** declare `impliesSensitive` in varlock 1.16 (only
  `varlock()`/`keychain()` do). With `@defaultSensitive=true` this is
  harmless, but if that decorator is ever flipped, exec-resolved credentials
  silently become non-sensitive. The bootstrap's
  "has a resolver ⇒ sensitive" rule already compensates.
- `varlock`'s `internal` API is semi-private — the bootstrap accesses items
  structurally (optional chaining, typeof checks) so a shape change degrades
  to zero registrations rather than a crash, but pin the version.
- Do **not** wrap the launchd plist in `varlock run` (brief §"Integration
  constraint") — this change uses the library API only; boot never depends
  on an external binary.
- `varlock init`'s `bunfig.toml` (`env = false`) must stay out of this repo
  (brief gotcha); the library load path does not need it.
