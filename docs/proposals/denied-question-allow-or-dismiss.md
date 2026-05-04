# Proposal: Denied Question — Allow-Now or Dismiss?

**Status:** Draft. Not implemented.
**Owner:** TBD.
**Related:** `docs/eng/stuck-ui-states.md` (Question block — denied state).

## Problem

When an agent emits a question (`AskUserQuestion`) and the surrounding policy/safety layer denies it before it reaches the user, we render the block with `questionStatus = denied`. The card shows "Agent wanted to ask: …" with the original question text, muted styling, and no controls.

`apps/ios/Scout/Views/Blocks/QuestionBlockView.swift:114-137`.

The user can read what the agent wanted to ask and… that's it. No reason given. No retry. No dismiss. No way to even mark the card seen.

## What's missing

The block should answer two questions for the user every time it appears:

1. **Why was this denied?** A bare "denied" card without reason is a paper-jam — the user doesn't know if it's their config, a global safety rule, an agent-side policy, or a transient infra issue. We send no signal today.
2. **Can the user override?** Today, no. This is the bigger product question.

## Decisions to make

### D1. Surface the denial reason

**Option A — Free-form `deniedReason` string on the block.** Whoever denies the ask attaches a short reason. Renderer shows it inline (italic, one line max).

**Option B — Enum of denial categories.** `policy | safety | rate_limit | offline | unknown`. Renderer maps to a localized string and an icon.

**Recommendation:** **A** for v1, with the convention that denying code provides a one-liner. Easier to ship, easier to evolve. We can introduce B later if categories become useful for filtering or telemetry.

### D2. Allow-now (override) — is it a thing?

**Option A — No override.** Denied means denied. The card explains why and stays read-only. Users wanting the answer must change the underlying config (settings, policy file, etc.) and re-prompt the agent.

**Option B — User-initiated allow.** "Allow now" button on the card. On tap, broker re-emits the ask through the normal path with a `bypassPolicy: true` flag. Auditing requirement: every override is logged.

**Option C — "Allow this kind for N minutes."** Override is scoped (allow this *type* of ask for the rest of the session). Reduces tap-fatigue if the same denial fires repeatedly, but expands the trust surface.

**Recommendation:** **A** for now. Override semantics are an audit-grade product call. Until we have a defined policy framework that knows how to express "allowed via user override on date X", building the button risks cementing a half-baked override flow. The dismiss rule (D3) gives the user a way out without inventing override semantics.

### D3. Dismiss

Independent of D2: the card should have a **Dismiss** action (long-press or trailing button) so the user can clear it from their view. Local-only, no broker call. Same pattern as the Activity feed dismiss in Task #4.

This is the cheap, correct first step regardless of D2.

### D4. Surface the original question text — or hide it?

Today the card shows the question the agent wanted to ask. There's a subtle leak risk: if the agent was denied because the question itself was sensitive (PII fishing, policy violation), echoing the text on screen partially defeats the policy. But hiding it makes the denial mysterious.

**Recommendation:** Show by default. If denial reason is `policy`/`safety` (post D1.B), collapse the question text behind a "Show" toggle.

## Recommended v1

Combine the conservative options:

1. Add optional `deniedReason: String?` to the question block payload.
2. `QuestionBlockView` deniedView renders the reason if present (italic, muted, one line).
3. Add a **Dismiss** button (or context menu item) that locally hides the card for the session.
4. **Do not** ship "Allow now" yet — defer until override audit semantics are designed.
5. Update `docs/glossary.md` with the new field if/when we add it.

## Out of scope

- Server-side override ledger.
- Per-user policy editing UI.
- Allow-this-kind-for-N-min scoping.
- Cross-device sync of dismissals.
