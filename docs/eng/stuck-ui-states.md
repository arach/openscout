# Stuck UI States — Working Inventory

> **Pattern:** the UI surfaces a status, alert, or "needs input" item, the user opens it, and there is **no action to take** — not even *dismiss*. The item sits there forever.
>
> **Rule of thumb going forward:** if a row, card, or banner can show up unbidden, it must answer *"what can I do about it right now?"* — even if the only answer is **Dismiss**. Pure reads that the user can't make go away are the bug.

This is a working file. Check items off as we land fixes. Don't add things here that aren't actually a stuck state — connection-warning dots, healthy-state pills, etc. are out of scope unless they trap the user.

**Companion docs:**
- [`no-dead-end-ui.md`](./no-dead-end-ui.md) — the rule, in case you forget why this file exists.
- [`../proposals/ask-staleness-and-retry.md`](../proposals/ask-staleness-and-retry.md), [`denied-question-allow-or-dismiss.md`](../proposals/denied-question-allow-or-dismiss.md), [`plan-operator-override.md`](../proposals/plan-operator-override.md) — design calls deferred from this file.

---

## Surface: Fleet (the "Ops" view)

`apps/ios/Scout/Views/Fleet/FleetView.swift` — `Text("Ops")` at line 121 confirms this is the surface.

- [x] **Fleet error text below hero** — `FleetView.swift:71-76`
  - Trigger: `refreshNodes()` fails but `nodes` is non-empty (so we don't fall through to `errorState`).
  - Today: bare red-ish `Text(error)` rendered into the scroll view, no dismiss, no retry button.
  - Want: inline pill with **Retry** + **Dismiss**. Pull-to-refresh exists (`refreshable` line 111) but isn't discoverable when the error is what you're staring at.
  - Backing: `refreshNodes()` already exists; dismiss is local-only (clear `self.error`).
  - Bucket: **local-only fix**

- [x] **NodeDetail "Host not found" / load error** — `NodeDetailView.swift:30-33, 316`
  - Trigger: node id resolves to nothing, or `refresh()` throws.
  - Today: full-screen `errorState(message)` with no buttons.
  - Want: error state with **Retry** and **Back to Fleet**.
  - Bucket: **local-only fix**

- [x] **Fleet empty state when disconnected** — `FleetView.swift:40-41` + `emptyState`
  - Trigger: `nodes.isEmpty && !isLoading`.
  - Today: empty illustration/text, no CTA.
  - Want: **Reconnect** button that calls `connection.reconnect()` (or routes to OSN settings if that's the cause).
  - Bucket: **local-only fix**

---

## Surface: Activity Feed

`apps/ios/Scout/Views/Activity/ActivityFeedView.swift`

- [x] **`ask_failed` row** — `ActivityFeedView.swift:108-122`, kind label `RPC.swift:590-630`
  - Trigger: broker emits an `ask_failed` activity event (delivery timeout, transport error, agent rejected).
  - Today: red triangle row, message text, taps navigate to the session if resolvable. **Cannot be dismissed, retried, or marked seen.** Sits in the feed forever.
  - Want (priority order): **Dismiss** (local) → **Retry ask** (needs API) → optional **Copy details**.
  - Backing: no `clearActivity()` or `retryAsk()` RPC today. Local dismiss is free; retry needs broker work.
  - Bucket: **local-only fix for dismiss**, **needs API for retry**

- [~] **`ask_opened` orphan** — `ActivityFeedView.swift:108-122` (local dismiss shipped via Task #4; staleness contract → `proposals/ask-staleness-and-retry.md`)
  - Trigger: ask sent, no `ask_replied` / `ask_failed` ever arrives (broker drop, agent crash, network partition).
  - Today: orange "Asked" row sits forever; no client-side timeout, no manual escalation.
  - Want: a stale-after-N-min downgrade to `ask_failed` *or* a "Mark as failed / clear" affordance.
  - Bucket: **spec question** — who decides when an open ask is dead, broker or client?

- [x] **Item with no resolvable session** — `ActivityFeedView.swift:129-142, 268-272`
  - Trigger: session deleted server-side after the activity fired.
  - Today: row renders, `canNavigate()` returns false, no chevron, **tap is a no-op**. Untappable, undismissable row.
  - Want: at minimum **Dismiss**; ideally tag the row "(session removed)" to explain the missing chevron.
  - Bucket: **local-only fix**

---

## Surface: Tail Feed (firehose)

`apps/ios/Scout/Views/Activity/TailFeedView.swift:336-495`

- [x] **Per-row `ask_failed` / error events** in the dense stream
  - Today: monospace row with red glyph, no per-row interaction.
  - Want: long-press or context menu → **Copy line**, **Open session**, **Hide this kind for 5 min** (mute pattern).
  - Bucket: **local-only fix** — tail is ephemeral by design, but a "mute kind" filter respects the firehose nature without forcing dismiss-per-line.

---

## Surface: Session blocks

`apps/ios/Scout/Views/Blocks/`

- [~] **Question block — `denied`** — `QuestionBlockView.swift:114-137` (spec → `proposals/denied-question-allow-or-dismiss.md`)
  - Trigger: agent wanted to ask but was denied (safety, policy, user blocked).
  - Today: muted card "Agent wanted to ask: …" with no controls.
  - Want: **Allow now** (re-enable + re-emit) and/or **Dismiss**. At minimum a one-line "why denied" so the read isn't a mystery.
  - Backing: no `retryQuestion()` RPC. Allow-and-retry is a real product question.
  - Bucket: **spec question**

- [x] **Error block** — `ErrorBlockView.swift:1-52` (Copy shipped; Retry-turn still depends on a future RPC)
  - Trigger: turn-level error or runtime exception.
  - Today: red card with message + optional code, **no buttons**.
  - Want: **Copy details** (free) + **Retry turn** (replay the user message of this turn). Even if retry needs new RPC, copy is one-line.
  - Bucket: **local-only fix for copy**, **needs API for retry**

- [~] **Plan block — stuck unchecked steps** — `TextBlockView.swift:240-305` (spec → `proposals/plan-operator-override.md`)
  - Trigger: agent's plan never marks step N done (agent crash, plan abandoned).
  - Today: `planStepRow` renders a static `Image(systemName: "circle")`. **Not tappable.** Plan can show 0/8 forever.
  - Want: discuss whether the user should be able to manually toggle a plan step (operator override) or whether stuck plans should expose a top-level **Mark plan abandoned** action.
  - Bucket: **spec question** — overrideable plans is a meaningful design call.

---

## Good patterns (positive examples — pattern-match these)

- **Approval action block** — `ActionBlockView.swift:41,335,431-447`. Awaiting-approval card has Approve/Deny, hits `connection.decideAction()`, status updates, card transitions. Full loop.
- **Inbox approval item** — `InboxView.swift:136-218,229-243`. Same pattern, but also calls `inbox.removeItem()` after the decision so the item *leaves the list*. This is the pattern every other "needs input" surface should aim at: the action both resolves the underlying state **and** removes the row from the user's view.

The inbox model — *decide → remove from list* — is the template for every dismiss/ack we're going to add below.

---

## Cross-cutting work

- [ ] **Add `Dismissible` / `Acknowledgeable` protocol on the iOS side** — local-only, no broker round-trip needed for v1. Lets every list-row participate in swipe-to-dismiss without each renderer rolling its own.
- [ ] **Decide ownership of "clear an activity item"** — purely local (each device hides independently) vs. broker-tracked (acked-on-A is also acked-on-B). Local-only is the cheap right answer until proven otherwise.
- [x] **Document the rule** — landed at [`no-dead-end-ui.md`](./no-dead-end-ui.md).

---

## Out of scope for this file

These came up in the broader audit but aren't the "you can't even clear it" pattern this file is about — track separately if at all:

- macOS menu-bar status dot tappability (cockpit polish)
- iOS bottom-bar connection warning dot (indicator polish)
- Cloud landing alert/error badges (different surface entirely)
- Healthy-state pills, address-bar connection chip, onboarding permission rows — all already actionable in their own way

---

## Severity legend

- **Stuck-list** = item lives in a list/feed and the user has no way to make it go away. Highest pain.
- **Read-only-forever** = card persists in a session/turn view; less urgent because session itself can be left, but still a dead-end.
- **No-retry** = error/failure state with no manual retry path. Often acceptable if the agent retries automatically; worth confirming case-by-case.
