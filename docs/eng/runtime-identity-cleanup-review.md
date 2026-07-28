# Design review: runtime-identity-cleanup.md

Reviewer stance: skeptical, implementation-minded. No restatement of the
spec's intent. Findings only. Section refs point at
`docs/eng/runtime-identity-cleanup.md`.

---

## Critical / must resolve before A2 lands

### F1 — Positional sigil reuse is a protocol footgun, not a convenience

**Where:** A2 ("shorthand sigils step down the identity hierarchy relative to
the base").

**Claim under review:** `@hudson#codex?sonnet` means agent·harness·model, while
`codex#gpt-5.6-sol?xhigh` means harness·model·effort, same sigils, different
dimensions, disambiguated only by whether the base is "agent" vs "reserved
runtime word".

**Why this is unsound:**

1. **Shared parser path.** Today both forms would enter
   `parseShorthandIdentity` (`packages/protocol/src/agent-identity.ts:186-234`).
   That function hard-codes `# → harness`, `? → model` after a segmented base.
   A2 requires the *same characters* to mean different `AgentIdentity`
   fields (or a new runtime-spec type) depending on base classification. That
   is not a grammar extension; it is a second grammar overlaid on the first
   with a context-sensitive base check. Every consumer of
   `parseAgentIdentity` — dispatcher, delivery routing, composer chips,
   alias resolve, mention parsing — becomes sensitive to "was the base
   reserved at parse time?"

2. **Base kind is not stable over time.** B reserves harness words *from the
   agent namespace*, but model-family keys (`sonnet`, `opus`, `haiku`, `mini`,
   `nano`, `pro` per `modelAliasKeys` at `agent-identity.ts:514`) and profile
   ids (`fable`, `opus`, `kimi`, `grok`) already collide with each other and
   with harnesses. If tomorrow a new harness is named `pro` or a profile is
   added that matches an existing agent, historical strings flip meaning.
   Context-sensitive sigils make parse results non-local: you cannot know
   what `?x` means without the current reserved set.

3. **Display/copy round-trip breaks.** Agent cards already render shorthand
   (`@lattices#codex?5.5` in architecture docs). If a human copies
   `codex#gpt-5.6-sol?xhigh` into a mention body expecting an agent chip,
   mention parsers that only know agent identity will either reject it or
   invent a definitionId `codex`. Spec never says whether runtime literals
   are valid *targets* in body text, chips, or only as CLI/MCP route
   selectors.

4. **The "relative step-down" metaphor does not match the dimension sets.**
   Agent shorthand steps: base → harness → model. Runtime shorthand steps:
   base → model → effort. The middle and tail dimensions are different
   *kinds*, not "one more step on the same ladder." Calling that "step down
   the identity hierarchy" papers over a type error.

**Defensible alternative (pick one and delete the other reading):**

- **Fixed sigils, fixed dimensions:** `#` always harness, `?` always model.
  Effort only via `effort:…`, `--effort`, or a *new* sigil (e.g. `!xhigh` or
  trailing `/xhigh`). Runtime form becomes `codex` / `codex?gpt-5.6-sol` /
  `codex?gpt-5.6-sol.effort:xhigh` — boring, unambiguous.
- **Separate production:** runtime-spec is not an agent identity at all.
  Prefix or flag only (`--runtime codex/gpt-5.6-sol/xhigh`, or
  `runtime:codex#…`). Do not overload `parseAgentIdentity`.

Recommend rejecting relative-dimension sigils. The cost is permanent
cognitive load for every agent and human who learns one grammar and then
hits the other.

### F2 — Shell metacharacters make the unquoted A2 examples wrong

**Where:** A2 examples:

```
scout ask codex#gpt-5.6-sol?xhigh to review the diff
```

In zsh/bash, unquoted `#` starts a comment. Unquoted `?` is a glob. The
example as written does not survive a real shell. Spec E promises
copy-paste examples per harness and never mentions quoting.

Either:

- mandate quotes in every example and in CLI help, and treat unquoted
  parse failure as a teaching error; or
- choose a shell-safe delimiter set for the compact form (`/`, `+`, `@`,
  none of which comment-terminate).

This alone is enough to demote A2 from "primary compact form" to "quoted
advanced form" if the sigil design is kept.

### F3 — Profile / harness / model-family triple collision is undiscussed

**Where:** A3, B.1 reserved list composition.

Today:

| Word   | Profile | Harness | Model family / model word |
|--------|---------|---------|---------------------------|
| `kimi` | yes     | yes     | —                         |
| `grok` | yes     | yes     | —                         |
| `opus` | yes     | —       | yes (Claude family)       |
| `fable`| yes     | —       | yes (Claude model word)   |
| `claude`| —      | yes     | vendor prefix in model ids|
| `codex` | —      | yes     | —                         |

A2 says bare `codex` becomes harness-only because agents cannot own the
name. It says nothing about bare `kimi` / `grok`, which are *already*
runtime profiles in NL ask (`options.ts:269-306`) *and* harnesses. After B:

- `scout ask kimi to …` — profile path (today).
- `scout ask kimi#…` — A2 would claim harness·model·effort.
- `scout ask --harness kimi` — harness.
- `scout ask --profile kimi` — profile.

Profile `kimi` and harness `kimi` currently map to the same execution
shape, so the collision is latent. The day they diverge (profile gains a
default model; harness stays bare), A2+A3 become contradictory. Spec needs
an explicit priority table for bare reserved words:

1. profile id?
2. harness name?
3. model family?
4. agent name (never, post-B)?

Without that table, B "unites the lists" but does not define *lookup
order* when a token is in more than one list.

### F4 — Long-form `codex.model:….effort:…` is not a free grammar add

**Where:** A2 paragraph on `DIMENSION_ALIASES` + `effort`.

`parseSegmentedIdentity` treats the first segment as `definitionId`. So
`codex.model:gpt-5.6-sol.effort:xhigh` parses today as definitionId=`codex`
plus model — which is an *agent* identity, not a runtime spec, unless B
plus a new post-parse rewrite reclassifies reserved definitionIds into
runtime specs.

Adding `effort` to `AgentIdentityDimension` also expands the address
grammar used for *existing agents*. Spec never says whether
`@hudson.effort:xhigh` becomes a legal agent address, a no-op, or an
error. If effort is only meaningful on launch/execution, it does not
belong on durable identity at all — it belongs on
`InvocationExecutionPreference` only. Mixing launch-time effort into the
six-dimension address model contradicts architecture.md's identity
section (effort is not one of the six dimensions).

**Missing decision:** effort is execution preference, not identity.
Long-form runtime specs should not be shoehorned into
`parseAgentIdentity` without an explicit new type
(`RuntimeSpec` vs `AgentIdentity`).

---

## A — Exact specification gaps

### F5 — Existing-target re-stamp (A1.4) changes agent semantics without a product rule

**Where:** A1.4.

Re-stamping endpoint metadata so `attached*LaunchArgs` see model/effort on
an *existing* agent means:

- the durable agent endpoint's model becomes whatever the last ask
  requested;
- concurrent asks with different models race on endpoint metadata;
- "ask agent Hudson to …" is no longer "route to Hudson as configured"
  but "mutate Hudson then continue".

Spec frames this as fixing silent ignore. The silent ignore may be the
*correct* product rule for existing-target asks (capabilities of a named
agent are sticky; exact runtime is for fresh capability routes). Missing:

- Does re-stamp apply only when the existing endpoint has null model?
- Only when the ask is cardless / fresh session (`session: "new"`)?
- Is it a one-shot launch override that does not write back to the
  endpoint record?
- Conflict when the existing agent is mid-flight on a different model?

Without this, A1.4 is a footgun dressed as exactness.

### F6 — Fallback ladder is named but not ordered against live config

**Where:** A intro: "profile preset → endpoint metadata → harness config
file → harness default".

Ambiguities:

1. Where does **explicit flag** sit? Obviously first, but say it.
2. Where does **agent identity shorthand on `--to`** sit relative to
   endpoint metadata? `executionWithRouteParams` today fills from identity
   only when `payload.execution` lacks the field
   (`broker-delivery-routing.ts:95-98`) — identity loses to explicit
   execution, but endpoint-stored model is a third source not in the
   ladder.
3. "Harness config file" (`~/.codex/config.toml`) is process-environment
   state outside the broker. Recording "resolved value" (A intro, C/D)
   cannot observe config-file defaults without reading those files at
   spawn or scraping harness stdout. Spec never says *who* resolves the
   ladder or *what receipt field* carries the post-resolution triple.
4. If resolution is spawn-time only, displays that claim "what is
   running" still depend on observe (C's rule) — so the ladder is for
   *launch*, not for *readout*. Spec conflates them in one sentence.

### F7 — Conflict rules underspecify "compatible override"

**Where:** A1.7, A3.

`--profile opus --model gpt-5.5` errors (good). What about:

- `--profile opus --model sonnet` (same harness, different model family)?
- `--profile opus --model claude-opus-4-…` (same intent, different id
  spelling)?
- `--profile opus --effort high` (today allowed)?
- `--profile opus --harness claude` (redundant same harness)?
- runtime literal `opus?max` — is `opus` profile base or model-family
  base under A2?
- `--runtime codex#…` combined with `--profile fable`?

"Contradictory harness: error; compatible value: fine" needs a
compatibility matrix, not prose.

### F8 — NL form `scout ask codex#… to …` has no parse path specified

**Where:** A2 first example; E.2.

`parseNaturalLanguageAskTarget` only recognizes `agent … to …` and
reserved *profile* leading tokens. A2's unflagged literal form is not
wired to any existing target kind (`runtime_profile` |
`existing_handle` | project). Spec needs:

- new target kind `runtime_spec` on the deliver payload; or
- desugar to `--harness/--model/--effort` + current-project inference
  before target counting (`options.ts:894-904`).

Also: does `codex#… to review` require the `to` keyword, or is the
remainder the message? Profile form allows optional `to`; existing-handle
requires `agent … to`. Inconsistency will produce silent mis-parses
("review" swallowed as effort token — already a risk in profile effort
parsing at `options.ts:288-294`).

### F9 — Model shorthand normalization is harness-local and not catalog-owned

**Where:** A2 last paragraph.

Codex `5.6 → gpt-5.6-sol` lives in transport code; Claude family words
resolve "through the model catalog". Spec says the resolved id is
recorded. Missing:

- Is the catalog the generated `model-windows.generated.ts`, runner
  options, or a third list?
- What if shorthand is ambiguous across harnesses (`mini`)?
- Does recording store both requested and resolved, or only resolved
  (breaks A1.7 conflict diagnosis and C's requested-vs-observed drift)?

Exactness requires a single normalize function with (harness, raw) →
resolved | error, shared by CLI, MCP, web, and spawn — not "stays and is
documented" in two places.

### F10 — ACP fail-closed (A1.6) vs profile supportsReasoningEffort already disagree

**Where:** A1.6.

Broker profiles already encode `supportsReasoningEffort: false` for kimi
and grok. A1.6 says ACP fails closed until transports expose control.
Does that also block `--model` on grok/kimi when the transport might
accept model but not effort? Spec says "effort/model" together. Verify
per harness; do not assume the pair is atomic.

---

## B — Reserved vocabulary gaps and migration hazards

### F11 — Reservation set is both too wide and too narrow

**Where:** B.1.

**Too wide:** "model-id pattern check against the generated catalog"
reserves *every known model id* as an illegal agent name. Catalogs grow;
yesterday's fine agent name becomes tomorrow's doctor failure. Model ids
are high-cardinality and versioned (`claude-opus-4-…`). Reserving them
all is operationally hostile. Reserve **family keys and harness/profile
words**; validate model *ids* only when used in runtime-spec position,
not as a global name ban.

**Too narrow / missing:**

- session/route grammar words already in `RESERVED_ROUTE_ALIASES`
  (`session`, `ref`, `target`, `alias`, `channel`, …) — B says "route
  grammar words" but should cite the full set and confirm
  `broadcast`/`shared`/`operator`.
- effort enum tokens (`none`, `minimal`, `low`, `medium`, `high`,
  `xhigh`, `max`, `ultra`) — if bare tokens can appear in NL effort
  position, naming an agent `high` is a footgun even if not a harness.
- transport/backend words (`tmux`, `zellij`, `herdr`) if they ever appear
  in runtime pickers as first-class.
- built-in definition ids (`builder`, `reviewer`, `research`) — reserved
  for product reasons, currently not in the creation guards B lists.
- dimension keys themselves (`harness`, `model`, `profile`, `node`,
  `workspace`, `effort`) so `scout up --name model` cannot happen.

### F12 — Migration is "retire-and-recreate" without a bridge

**Where:** B.6.

No rename path is correctly noted. Missing:

- How many production nodes are expected to have offenders (codex/claude
  named agents are the motivating example — likely non-zero)?
- Does doctor *block* broker start, warn, or only list?
- Soft-read path: pre-existing reserved-named agents remain addressable
  via `agent <name> to` / exact id / session handle, while bare runtime
  words prefer runtime semantics (resolution-side B.3). Spec says
  resolution-side symmetry so bad names cannot shadow runtime — that
  *breaks* existing agents named `codex` with no migrate tool. That is a
  deliberate break; call it a breaking change, version it, and give
  operators a one-shot `scout doctor --fix-reserved-names` that emits
  recreate commands, or a forced rename in sqlite.

Silent "you must retire" with no tool is how pilots lose workers.

### F13 — Normalizer unification (B.5) can invalidate stored ids

**Where:** B.5 "no silent rewriting".

Today `normalizeAgentIdentitySegment` rewrites `gpt-5.6-sol` →
`gpt-5-6-sol`. Stored definitionIds, aliases, and transcripts may already
contain rewritten forms. Flipping to reject-on-charset without a
read-compat path will fail resolve for historical handles. Spec needs
read-normalize vs write-validate split.

### F14 — Cardless session handles and alias charset are different domains

**Where:** B.2 cardless + aliases.

Bundling "real charset validation" for cardless session handles with
agent-name reservation confuses session ids (often harness-native,
opaque) with human agent names. Cardless handles may *need* characters
agent names forbid. Specify two policies.

---

## C — Composer convergence underspecification

### F15 — "One capability endpoint" is asserted, not designed

**Where:** C intro, `/api/runner/options`.

Open questions the implementer will hit:

1. **Auth/surface matrix:** iOS bridge, macOS HUD, web, CLI `scout
   runtimes` — same payload schema? Versioned? Partial (harness-only)
   responses?
2. **Offline / broker-down:** iOS hardcoded catalog exists because the
   phone is often away from the host. Spec says "fetch over the bridge"
   with no offline cache policy. Converging to the endpoint without a
   stale-while-revalidate story regresses mobile.
3. **Project scope:** runner options today take `currentDirectory`.
   BrokerScreen is project-scoped; home quiet-start may not be. Does the
   endpoint filter models by project fleet, global catalog, or both
   (today: static + observed fleet)?
4. **Effort × model legality:** not all efforts apply to all models. The
   endpoint must return the cross-product constraints or composers will
   keep inventing invalid combinations — which A1.7 then rejects late.
5. **RuntimePicker ownership:** web is landing a new
   `MessageComposer/RuntimePicker.tsx` (uncommitted in tree). Spec says
   "replace with RuntimePicker" without defining the shared component
   contract across web/iOS/macOS (props: value, onChange, options,
   disabled dimensions, requested-vs-default markers).

### F16 — Retry resend of execution (BrokerScreen) needs a stored snapshot

**Where:** C BrokerScreen bullet.

If retry "resends the original execution", the flight/invocation record
must retain requested execution even when observe later differs. Confirm
invocation persistence already stores `execution.*`; if not, C depends on
a record-schema change not listed in A.

### F17 — Requested-vs-observed drift "everywhere" is unbounded scope

**Where:** C displays bullet.

"Everywhere" is not a shippable criterion. Need a surface inventory with
accept/defer, or C never closes. Same for "effort renders wherever model
renders".

---

## D — Projects readouts

### F18 — D1 history feed is a product surface, not a bugfix

**Where:** D.1.

A per-project transcript-history feed is a new durable API over
harness-owned files (architecture: observe, don't absorb). Spec puts it
in the same workstream as `?? 0` nullability fixes. That is scope
collapse:

- D1 empty-state copy ("no live session") is a one-line honesty fix.
- D1 realpath / worktree / stripNodeQualifier bugs are project-identity
  bugs.
- D1 `observedAt = now()` on journal replay is a projection bug with
  fleet-wide impact (dormant folding, active counts).
- D1 history feed is a multi-week feature (indexing, caps, privacy,
  multi-harness path rules).

These should not share a single PR or a single "item 1". Sequencing §4
admits item 1 is largest and overlaps C, then still groups them.

### F19 — Active-agent definition still unresolved after the "fix"

**Where:** D.3.

"Count live signals (active flight, or presence in tail-discovery
process set) — or relabel". Those are three different products:

| Definition                         | Operator meaning        |
|------------------------------------|-------------------------|
| active flight                      | doing work for someone  |
| harness process live               | runnable / warm         |
| registry row not blocked           | addressable (today)     |

Picking "or relabel" without choosing the default statistic leaves the
Projects header meaningless. Recommend: ship **relabel to "Agents" /
"Registered"** immediately; design "Live" as a separate metric with an
explicit definition in concepts.md. Do not invent a hybrid count in the
same PR as the false readout fix.

### F20 — Transport nullability vs launch defaults

**Where:** D.4.

Dropping Transport when nothing is attached is correct for
history/transcript sessions. For a live tmux-attached session, transport
*is* an observation. Spec should say: show transport only from live
attach/observe metadata, never from `DEFAULT_TRANSPORT` / endpoint
column defaults. Also: endpoint.transport may still be useful for "how
was this agent last launched" — that is a different label ("Launch
transport") and should not be deleted from the data model, only from the
misleading RuntimeGrid slot.

---

## E — Guidance

### F21 — E is incomplete as a discoverability plan

**Where:** E.

Missing audiences and surfaces:

- MCP tool descriptions (agents often never see CLI help).
- Error code stable strings for agents to branch on (not only prose).
- Receipt / ask response fields documenting resolved harness·model·effort
  (the verification path E.3 tells agents to use).
- Natural-language profile docs must be updated for interaction with
  runtime literals (Fable vs `claude#fable?max` — when to use which).
- architecture.md identity section and concepts.md — A2 changes the
  public grammar; eng doc alone is not enough (E lists only agent
  guidance files).

---

## Sequencing

### F22 — B-before-A2 is right; B-before-A1 is not required

**Where:** Sequencing 1–2.

A1 (flags through deliver, schema enum, MCP/HTTP mirrors) does not depend
on reserved vocabulary. It depends on execution threading. Holding A1
behind B delays the original incident fix (exact model/effort on ask)
for a larger breaking rename project.

Recommended sequence:

1. **A1 + receipt fields + E scaffold** (flags, schema, deliver,
   fail-closed ACP, conflict on explicit flags only) — fixes the
   trigger incident.
2. **D2–D4 + D1 empty-state copy + D1 observedAt** — high-value honesty,
   small diffs.
3. **B** (reserved module + guards + doctor) — breaking; needs migrate
   story.
4. **A2** only after F1/F2/F3 decisions and shell-safe grammar.
5. **C** web first against existing `/api/runner/options`; mobile after
   offline policy.
6. **D1 history feed** as its own lane.
7. **E** completes as each surface ships (not only "with A").

### F23 — C before D1 history is right; C does not unblock D2–D4

D2–D4 are independent of RuntimePicker. Sequencing should allow them
parallel to A1.

---

## What I would cut

| Cut | Why |
|-----|-----|
| A2 relative-dimension sigils | F1; replace with fixed dimensions or separate runtime-spec production |
| Unquoted `#`/`?` compact form as primary UX | F2 |
| Reserving full model-id catalog as agent names | F11 |
| Existing-target endpoint re-stamp as default | F5; prefer launch-only override or reject model on existing-target |
| D1 transcript-history feed from this lane | F18; separate eng doc |
| "Effort on AgentIdentity" via DIMENSION_ALIASES | F4 |
| "Everywhere" display scope in C | F17; inventory or cut |

## What is missing entirely

1. **RuntimeSpec type** distinct from AgentIdentity (parse, format, JSON,
   MCP, receipts).
2. **Resolved execution on the ask receipt** (requested + resolved +
   source per dimension: flag | profile | endpoint | config | default).
   Without this, E.3's "verify what spawned" has no machine-readable
   surface.
3. **Bare-token priority table** across profile / harness / model-family
   / effort / agent (F3).
4. **Shell quoting / delimiter policy** (F2).
5. **Compatibility matrix** for profile × flag overrides (F7).
6. **Migration tool + breaking-change note** for reserved names (F12).
7. **Write-validate vs read-normalize** for identity segments (F13).
8. **Offline/cached capability catalog** for iOS (F15).
9. **Effort legality per model/harness** in the capability payload (F15.4).
10. **Concurrency rule** when two asks specify different model/effort for
    the same existing agent (F5).
11. **Whether runtime literals create cardless sessions, ephemeral
    workers, or require `--project`** — A2 examples omit project; current
    CLI requires a target class.
12. **Interaction with session policy** (`--new`, `session:reuse`,
    `session:<id>`): does exact model force `session:new`? Continuing a
    session on a different model is nonsense; spec never says.
13. **Mesh / remote node**: exact runtime on a remote worker — whose
    catalog validates model ids? Local catalog can accept a model the
    remote harness lacks.
14. **Tests as acceptance criteria** — no required cases listed (parse
    tables, conflict matrices, doctor fixtures, readout golden tests).
15. **architecture.md / concepts.md grammar update** as a gated doc PR
    for A2, not only agent README crumbs.

---

## Sigil rule — direct verdict

**Not defensible as specified.** Relative-dimension sigils couple parsing
to a mutable reserved-word set, overload a shared identity parser, and
teach two meanings for one glyph. The reservation work in B is necessary
for *bare harness words as route selectors*; it is not sufficient to make
`#`/`?` mean effort on one base and model on another.

Keep B. Drop relative sigils. Give runtime specs either fixed-dimension
sigils or a separate literal production. Put effort on execution
preference and receipts, not on agent identity dimensions.

---

## Suggested decision checklist before implementation

- [ ] RuntimeSpec ≠ AgentIdentity (yes/no; if no, write the parse
      ambiguity tests that prove safety)
- [ ] Sigil meanings fixed forever (table) or A2 redesigned
- [ ] Shell-safe examples only
- [ ] Bare token priority: profile vs harness vs model family
- [ ] Existing-target + model: reject | launch-override | re-stamp
- [ ] Session policy when model/effort specified
- [ ] Receipt shape for requested/resolved/source
- [ ] Reservation cardinality: families yes, full model ids no
- [ ] Migration: doctor-only vs fixup command
- [ ] A1 ships without waiting for B/A2
- [ ] D1 history feed split out
- [ ] Active Agents: relabel now, redefine later
