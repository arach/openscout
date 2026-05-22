# SCO-037: Ranger Brief Pipeline

## Status

Proposed.

## Proposal ID

`sco-037`

## Intent

Rebuild the Ranger brief pipeline as a two-stage call: an **analyst** stage that does the thinking (Codex 5.5 on a large-context model) and a **presenter** stage that does the talking (small cloud model + TTS). The intermediate between them is a **clean markdown report** — a human-readable artifact that gets persisted in Briefing Room as the canonical brief, then phrased into sentences for TTS at delivery time.

This proposal also explicitly *defers* the "analyst as a specialist agent" abstraction. We ship the pipeline as a direct query and treat agent-promotion as an option to exercise only when the use case actually warrants it.

## Problem

Today's brief endpoint (`POST /api/ranger/brief`, `GET /api/fleet/brief`) packs the entire control-plane snapshot — ~15 data slices, briefingEvidence with 50 agent-log events plus 50 Scout messages, broker diagnostics, fleet activity, harness activity, etc. — into a single OpenAI Responses prompt on every call. The model is asked to do two things at once: analyze a large context, *and* produce TTS-ready prose in one shot.

Failure modes that fall out:

- **Latency.** Big context, big synthesis ⇒ slow turns.
- **Hangs.** No `AbortController` on the fetch (fixed on `codex/brief-timeout-fix`, pending merge), so a slow call closes the connection silently and surfaces in the browser as a generic 500.
- **Per-brief recomputation.** Every brief re-analyzes the same snapshot from scratch; no amortization beyond OpenAI's prompt cache.
- **Single point of failure.** If the model picks the wrong phrasing or skips the "synthesize evidence" step, we lose both the analysis *and* the speakable output.

The renderable Briefing Room is already a real surface (`packages/web/server/db/briefings.ts`, `GET /api/briefings`, `BriefingsScreen` + `BriefingDetailScreen`), but it renders today's structured `RangerBrief` (title / summary / steps / recommendation / actions). The report and the TTS payload are not cleanly separable.

## Decision

Split the brief into two stages with a markdown intermediate.

### Stage 1 — Analyst (Codex 5.5 or other large-context model)

A direct LLM call with the full control-plane snapshot. Output is **clean markdown** matching the convention in the next section. The analyst does:

- Read the snapshot
- Notice attention, risk, progress, context signals
- Cross-reference recent events with agents/work/sessions
- Cite evidence concretely with markdown links
- Emit a markdown report — *not* prose for speaking, *not* structured JSON

No agent abstraction. No broker invocation. Just a direct call to the analyst model from the brief endpoint. Same path the current code takes, with a new system prompt that emits markdown.

### Stage 2 — Presenter (gpt-4o-mini or similar)

A second, smaller LLM call. Input:

- The markdown report from Stage 1
- A voice spec (target word count, tone, persona, optional emphasis hints)

Output: 3–4 spoken sentences ready for TTS, honoring breath breaks the existing brief-segment plumbing expects. The presenter selects the top findings by weight (encoded in the markdown headers), incorporates the headline + recommendation, and ignores the lower-weight findings if word budget is tight.

The presenter is decoupled from the report. Same markdown can drive multiple voice variants by changing the voice spec. If the report is already in the cache, only the presenter call is paid.

### Markdown Intermediate — Conventions

Codex emits, the presenter consumes, BriefingDetailScreen renders. Convention, not strict schema — the value of markdown over JSON is precisely that it tolerates light drift.

```markdown
# Brief · fleet
*as of 2026-05-20T00:51:00Z · ttl 90s · vs prior brief 12m ago*

## Headline
One signal-rich phrase, no counters the hero already shows.

## Findings

### Attention · 8
Codex Talkie Auth has been retrying Cluster A wire for 18m; three
"answered" turns but no shipped surface. Most likely waiting on
the editor handoff.
- agent: [Codex Talkie Auth](agents/codex-talkie-auth.feat-ios-shell-phase-0.arts-mac-mini-local)
- conversation: [DM](conversation/dm.operator.codex-talkie-auth…)

### Risk · 6
Two flights in `waiting` past their declared TTL.
- work: [Cluster B wire](work/wrk-…)
- work: [Cluster C wire](work/wrk-…)

### Progress · 4
Editor landed `13a6e9a` — Cluster C wire merged.

## Deltas since last
- New attention item: codex-talkie-conn returned "Empty reply from server" (2m ago)
- Cluster C wire moved completed → archived

## Recommendation
Open the Codex Talkie Auth DM and clear the editor-handoff question.

## Actions
- [Open Activity](activity)
- [Open Codex Talkie Auth](agents/codex-talkie-auth…)
```

Conventions:

- Sections are stable: `Headline`, `Findings`, `Deltas since last`, `Recommendation`, `Actions`.
- Each finding is `### <Tone> · <weight>` where Tone ∈ {`Attention`, `Risk`, `Progress`, `Context`} and weight ∈ 1..10.
- References are markdown links. The href is a Scout route string (`agents/<id>`, `conversation/<id>`, `work/<id>`, `session/<id>`, `activity`, `broker`, etc.) — the same shapes the chip popover already navigates to.
- Deltas are flat bullets; the presenter can drop them entirely if word budget is tight.
- Actions are markdown links the BriefingDetailScreen and chip popover both already understand.
- No JSON-mode coercion. If the analyst drifts the format slightly, the parser is lenient.

### Persistence

The markdown report becomes the canonical persisted body in Briefing Room:

- New persisted shape: `{ id, mode, asOf, ttlMs, markdown, captureMeta }`.
- Convenience derived fields (`title` from the `#` header, `summary` from the `## Headline` body) parsed lazily for list rendering in `BriefingsScreen`.
- `captureMeta` carries: analyst model + responseId, presenter model + responseId (when delivered), snapshot pointer, generation timing.

Backward-compat: the today's structured `RangerBrief` shape is derivable from the markdown for one release so existing consumers (BriefingDetailScreen's current rendering, fleet-home hero) keep working without a coordinated swap. Deprecate after the new renderer lands.

### BriefingDetailScreen → markdown renderer

`BriefingDetailScreen` swaps its body to render the markdown directly using the existing `RangerMarkdown` component. Adds a small "Presented as" disclosure that shows the TTS sentences the presenter produced (so the report and the spoken version are inspectable side-by-side).

### `brief-sequence` (deferred richer view)

The `components/brief-sequence/` component (`scan / collect / inspect / analyze / synthesize` step kinds, currently fixture-driven) is genuinely interesting as a "watch how the brief was made" view, but it requires step-level metadata the analyst doesn't currently emit. Out of scope for v1. If/when we add per-step tagging in the analyst's output, brief-sequence becomes the rich detail view; today's markdown rendering stays the default.

### "Respawn from a nice state"

Without a chained session, there's nothing to respawn. The analogue is the **canonical seeding recipe**: the analyst's system prompt + the snapshot-ingestion preamble. Each brief call uses this recipe; OpenAI's prompt cache amortizes the seed prefix automatically (~50% cheaper cached input tokens after the first call inside the ~5–10 min cache TTL). If the recipe changes (new fields in the snapshot, new section in the markdown convention), version it in the prompt itself so cache invalidation is deliberate.

### Failure floor

`callOpenAIResponse` gets the 60s `AbortController` from `codex/brief-timeout-fix`. Worst case is a real 504 with a message, not a hang. The presenter call gets its own (shorter, e.g., 30s) timeout — if it fails, fall back to returning the markdown alone without TTS sentences.

## Why direct query (and not a specialist agent)

We considered making the analyst a "specialist" agent: a Codex harness session in the fleet with `kind: "specialist"`, invoked via the broker, with a long-running session that maintains continuity across briefs.

Arguments **for** the agent abstraction: transparency (analyst's conversation is the debug trail), automatic per-harness usage tracking, per-workspace scoping for free, and the "respawn from nice state" maps to harness session lifecycle.

Arguments **against** (and why we're not doing it in v1):

- **Briefing Room already gives us the debug trail.** Every brief is persisted with its markdown body and capture meta. Operators can scroll prior briefs. The analyst's "conversation" is the briefing list.
- **Cross-brief continuity isn't load-bearing yet.** OpenAI's prompt cache handles the cost story. The agent argument's main remaining win is "the analyst remembers prior briefs and can say 'third time this week'" — we don't know we need that yet.
- **YAGNI on the specialist pattern.** Building a generic specialist classification mechanism for one instance is overhead. When the second specialist appears (code-search analyst, broker-watcher, etc.), extract then.
- **No interaction.** The brief is one-shot ("give me a brief"). Agent abstraction earns its keep when there's multi-turn interaction; this is single-turn.

**Deferred promotion path.** If any of these become real, the analyst can be promoted to a specialist agent with mostly local changes:

1. Briefs benefit from cross-brief memory in a way prompt caching can't match
2. We add a second specialist that exercises the same plumbing
3. We want operators to follow up interactively after a brief

Until then, the direct-query shape is simpler and ships sooner.

## Non-Goals

- No change to the brief HTTP surface (`POST /api/ranger/brief`, `GET /api/fleet/brief`) from the outside.
- No new agent model fields. No `kind: specialist` data model change.
- No broker invocations from Ranger's brief path.
- No change to the existing `briefings` SQLite table schema beyond adding a `markdown` column (the structured fields can stay derivable).
- No richer `brief-sequence` view in v1. That's a follow-up when analyst-emitted step metadata exists.

## Ship Order

1. **Land the 60s abort fix** from `codex/brief-timeout-fix` (already pushed). Failure floor first.
2. **Markdown system prompt for the analyst.** Replace today's brief system prompt + operator request with the new convention. Keep the structured-shape derivation around as a fallback. Now `/api/ranger/brief` and `/api/fleet/brief` emit markdown.
3. **Briefing Room schema + persistence.** Add `markdown` column; `persistBriefing` writes it; `GET /api/briefings/:id` returns it.
4. **BriefingDetailScreen markdown renderer.** Swap the body to render markdown via `RangerMarkdown`. Keep the structured fallback for unmigrated rows.
5. **Presenter call.** Add a second LLM call after the analyst that takes the markdown + a voice spec and emits TTS-shaped sentences. Wire into the existing brief delivery path (current TTS pipeline already segments by paragraph; the presenter output drops straight in).
6. **Failure / fallback paths.** Presenter timeout → return markdown without TTS. Analyst error → surface real 504 with the abort message.
7. **Cache + cost telemetry.** Log analyst + presenter tokens and timings into `captureMeta`. Will eventually feed Thread 2 usage tracking.

Each step is shippable independently; the pipeline degrades gracefully through every intermediate state.

## Open Questions

- **Analyst model choice.** GPT-4.1 (1M context, most expensive), GPT-4.1-mini (128K, current default), Codex's actual model selection — depends on how big the snapshot grows in practice. Probably 4.1-mini works for ~80% of workspaces; tip to 4.1 for the busy ones via config.
- **Presenter model + cost cap.** `gpt-4o-mini` is the default candidate. Worth setting a per-day token budget so a stuck retry loop doesn't burn through the relay quota.
- **Voice spec shape.** Minimal v1: `{ targetWords: 60, persona: "calm dispatcher" }`. Open whether per-broadcast-tone variation matters.
- **When is a brief "stale"?** Persisted briefs have a TTL; what does the chip popover show when the latest brief is past its TTL? Lean: chip drops out of `brief-fresh` decay; popover still lists it as the latest under "Recent".
- **Cache key for the presenter.** `(markdownHash, voiceSpec)`. If the same markdown is presented with the same voice twice, hit the cache. Probably trivial savings but easy.
- **Snapshot trimming.** The current snapshot is ~30–90K tokens. Some slices (broker diagnostics dialogue, harness transcripts in full) are heavy. Worth a separate audit of what the analyst genuinely uses vs what's there because it was easy to include.
- **First call cost UX.** First brief after server boot pays the un-cached price. Acceptable, but worth measuring before deciding if we want a "warm-on-boot" sweep.

## Reference

- Current brief endpoint: `packages/web/server/create-openscout-web-server.ts:2169` (POST /api/ranger/brief), `:2520` (GET /api/fleet/brief)
- Current analyst call: `packages/web/server/ranger-assistant.ts:378` (`createBrief`)
- Current OpenAI fetch: `packages/web/server/ranger-assistant.ts:432` (now with abort timeout on `codex/brief-timeout-fix`)
- Briefing Room persistence: `packages/web/server/db/briefings.ts`
- Briefing renderers: `packages/web/client/screens/BriefingsScreen.tsx`, `BriefingDetailScreen.tsx`
- Deferred richer view: `packages/web/client/components/brief-sequence/`
- Markdown renderer for client: `packages/web/client/lib/ranger-markdown.tsx`

## Cross-References

- Builds on [[sco-035-ranger-chip-unification]] — the chip popover surfaces brief-fresh state and links to BriefingDetailScreen.
- Feeds [[sco-036-agent-state-vocabulary]] indirectly — when the analyst is promoted to a specialist agent later, it'll use the new state vocabulary as a first-class citizen.
