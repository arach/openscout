# Rule: No Dead-End UI

**Every status row, card, alert, or banner that can appear unbidden must answer the question "what can I do about this right now?" — even if the only answer is *Dismiss*.**

If the user sees something and has no path forward from where they're standing, that's the bug. We don't ship those.

## Why

UI that surfaces a problem without surfacing a response trains the user to ignore the surface. Once an "alerts" tab has been showing the same red badge for three days, it's not an alert anymore — it's wallpaper. The fix is not bigger badges or louder colors. The fix is to make sure every signal carries an action with it.

Some failure modes don't have a real fix from the device the user is holding. That's fine. The action in those cases is **Dismiss** — let the user clear it from their view. Local-only, no broker round-trip needed for v1.

## What counts as an action

In rough order of preference, from most to least useful:

1. **A direct fix** — Retry, Reconnect, Approve, Deny, Allow, Resolve. The action mutates the underlying state and the row updates accordingly.
2. **A specific path forward** — "Open Settings", "View logs", "Sign in with GitHub". The user can't fix it from this row, but they can click into the place where the fix lives.
3. **Diagnostics that the user can act on** — Copy details, Show error code, Open docs. They can paste it into Slack, search for it, or hand it to support.
4. **Dismiss** — The minimum. The row gracefully exits the user's view; the underlying state may persist server-side. The user can move on.

Anything below 4 — pure read-only — is a dead end.

## Where this rule applies

Anywhere the UI surfaces a status the user didn't explicitly request. Specifically:

- List rows in feeds (Activity, Tail, Inbox, Fleet)
- Cards in session timelines (Question, Action, Error, Plan blocks)
- Banners (error banners, "permission required", "offline", "needs attention")
- Empty states ("no hosts", "not connected", "sign in required")
- Status pills / chips when they indicate a problem state

It does **not** apply to:

- Status indicators that are healthy ("Connected", "Online") — these are by definition not asking for response.
- Static labels and headers.
- Loading spinners that complete in seconds — they're not stuck if they resolve.

## Rule of thumb when designing a new surface

Before merging, ask:

1. **Can this row appear without the user clicking it into existence?** If yes, this rule applies.
2. **What state is it telling the user about?** If something can be wrong, what's the user's path?
3. **If the only path is "wait for it to resolve itself", is that path obvious?** Add a hint or progress affordance, not just radio silence.
4. **If there is genuinely nothing to do, can the user dismiss it?** If not, add a dismiss action. No exceptions.

## Pattern to imitate

The Inbox approval flow (`InboxView.swift:136-243`) is the template:

- Each row has the action in-row (Approve / Deny).
- The action both resolves the underlying state **and** removes the row from view.
- After action: the list shrinks. The user is not asked to acknowledge that they acknowledged.

Aim for that lifecycle wherever a list shows "needs your attention" items.

## Pattern to avoid

The historical `ask_failed` row in the Activity feed (pre-fix) is the anti-pattern:

- Red "Failed" indicator attracts the eye.
- Tapping navigates to the originating session, where the failure is buried in turn history.
- No retry, no clear, no dismiss.
- Item persists across the user's view for as long as the buffer holds it.

If you're tempted to ship something that looks like that — pause. Add at least Dismiss before merging.

## Working inventory

`docs/eng/stuck-ui-states.md` tracks the surfaces that violate this rule today and the work to fix them. New violations should land there before being accepted.
