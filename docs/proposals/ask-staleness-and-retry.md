# Proposal: Ask Staleness + Retry Contract

**Status:** Draft. Not implemented.
**Owner:** TBD.
**Related:** `docs/eng/stuck-ui-states.md` (Activity feed `ask_failed` / `ask_opened` rows).

## Problem

The Activity feed's `ask_opened` row appears when an agent emits a question to the user. It transitions to `ask_replied` (success) or `ask_failed` (error) when the broker observes either outcome. Today:

1. **`ask_opened` can hang forever.** If the question is dropped (broker restart, agent crash, network partition between broker and agent), no terminal event is ever emitted. The orange "Asked" row sits in the feed indefinitely.
2. **`ask_failed` is read-only.** The user sees a red row with a message, but cannot retry the ask, rerun the agent prompt that produced it, or even hide it. The Activity feed dismiss work (Task #4) gives the user *local* dismiss; that fixes the visual problem but not the agent state.

We need a contract for: when does an open ask become stale, who marks it stale, and is there a path to retry?

## Decisions to make

### D1. Who declares an `ask_opened` dead?

**Option A — Broker-side timeout.** Broker tracks `ask_opened` events and emits `ask_failed { reason: "timeout" }` after N minutes of no reply. Single source of truth; clients render whatever the broker says.

**Option B — Client-side staleness.** Each client locally marks asks "stale" after N minutes from `tsMs` and renders them with a warning treatment. Broker remains agnostic; the underlying agent state may still be "waiting".

**Option C — Both.** Client-side staleness for fast UX feedback (e.g. 2 min), broker-side timeout as the authoritative kill (e.g. 30 min). Client downgrades from "asked" → "stale" → (when broker fires) "failed".

**Recommendation:** **C**, but staged. Ship B first (cheap, no broker work, immediately fixes the visual hang) and add A later if/when retry becomes a thing.

### D2. Should there be a `retryAsk(askId)` RPC?

**Option A — No retry, ever.** Asks are immutable historical events. To re-ask, the user re-runs the agent prompt from the originating session. Simple model; matches current architecture.

**Option B — Retry that resends the same payload.** Broker exposes `retryAsk(askId)`; the failed ask is replayed to whatever inbox/channel it originally targeted. Implies asks have a destination identity that survives the failure.

**Option C — "Re-ask in session" — re-send via the agent.** Tap retry → broker tells the originating agent to ask again (agent decides whether to literally repeat or rephrase). Requires the agent to be alive and listening for a re-ask signal.

**Recommendation:** **A** for v1. The retry model is genuinely unclear (an ask is rarely safe to blindly replay — context may have moved on). Punt until a real user need shows up.

### D3. What does the iOS client surface?

Given recommendations C+A:

- `ask_opened` younger than 2 min: orange "Asked" (today's behavior).
- `ask_opened` older than 2 min, no transition: orange "Asked · stale" with subdued styling — the row picks up a context menu item "Mark as failed" that locally marks it dismissed (no server-side mutation).
- `ask_failed` (broker-emitted, including future broker-timeout reason): red row with context menu "Copy details", "Open session", "Dismiss" (already shipped under Task #4).

Stale styling avoids lying to the user about state we don't actually know — the agent might still answer after 5 minutes — while giving the user a way out.

## Open questions

1. What's the right stale threshold? 2 min feels right for interactive use, too short for batch workflows. Maybe per-ask metadata declares `expectsResponseWithin: Duration` and the client uses that.
2. If we add D1.A later, does it backfill stale rows in older feed history, or only apply to new asks?
3. For non-mobile inboxes (CLI, web), is staleness a per-client concept or does the broker render it?

## Implementation outline (D1.B, D2.A only)

- iOS: in `ActivityFeedView` (after Task #4 lands), compute `isStale(item)` for `ask_opened` rows using `Date().timeIntervalSince1970 - item.tsMs/1000 > 120`.
- Render stale rows with `.opacity(0.6)` and append " · stale" to the kind label.
- Context menu on stale rows gets a "Mark as failed" item (alias for Dismiss in v1; future-proof name for when broker-side timeouts ship).
- No broker work. No new RPCs.

## Out of scope

- A `retryAsk` RPC and the agent-side machinery that would back it.
- Whether asks should be allowed to expire even if answered late (race condition: agent finally replies after stale threshold — what happens to the local dismiss?).
- Cross-device dismiss sync (out for the same reason as Task #4: local-only is the cheap right answer until proven otherwise).
