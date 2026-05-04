# Proposal: Operator Override for Stuck Plan Steps

**Status:** Draft. Not implemented.
**Owner:** TBD.
**Related:** `docs/eng/stuck-ui-states.md` (Plan block — stuck unchecked steps).

## Problem

Agents emit plans as markdown lists with task-state markers (`- [ ]` / `- [x]`). The iOS renderer at `apps/ios/Scout/Views/Blocks/TextBlockView.swift:240-305` shows them as a checklist with a progress bar, but **rows are static images, not buttons**.

If the agent abandons the plan (crash, killed by user, ran out of budget), the plan freezes with N/M completed forever. The user sees, e.g., "0/8 complete" with no way to:

- Mark a step done (operator override).
- Mark the whole plan abandoned and stop staring at it.
- Edit the plan to remove obsolete steps.

This is the most defensible "I see something and there's nothing I can do" surface in the app, because plans imply momentum and a stuck plan is anti-momentum.

## Decisions to make

### D1. Are plans agent-owned, user-owned, or shared?

This is the load-bearing question.

**Option A — Agent-owned (status quo).** The agent emits the plan, the agent updates it. The renderer shows whatever the agent says. User has no edit rights; if the agent dies, the plan is a tombstone.

**Option B — User-owned, agent-suggested.** The agent proposes a plan; once it lands in the session, the user can check/uncheck/edit any step. Agent re-reads the plan state each turn.

**Option C — Shared with override flag.** The plan is agent-owned by default, but the user can apply a manual override per step (`userMarked = true`). Agent sees both its own state and the override flag and decides whether to honor it.

**Recommendation:** **A** for plan content (agent owns the steps), with a top-level **C-flavored** override at the *plan* level: the user can mark the entire plan abandoned. Step-level override is too messy without a co-design with the agent runtime.

### D2. What does "Mark plan abandoned" actually do?

**Option A — Visual-only.** The plan card collapses or fades, but the agent's state is unchanged. If the agent comes back to life, it picks up where it left off.

**Option B — Signal to the agent.** A `planAbandoned` event is emitted on the session, the agent sees it, and on its next turn it acknowledges the abandonment.

**Option C — Hard stop.** Marking a plan abandoned terminates the agent if it's still running, freeing budget. Drastic.

**Recommendation:** **A** for v1 (visual-only). Cheap. Reversible. Doesn't require agent changes. Promote to B if we observe users hitting it expecting the agent to actually stop.

### D3. Step-level interaction — yes or no?

**Option A — No.** Steps stay static. User has the plan-level abandon as their out.
**Option B — Tap to toggle, agent ignores.** Each step becomes a button; tapping toggles a local check state. Agent state untouched. Pure UI satisfaction.
**Option C — Tap to toggle, agent reads.** Tap signals an override; agent honors it on its next turn (per D1.C).

**Recommendation:** **A** for now. The user's stated pain is the *whole plan being stuck*, not individual steps. Step-level toggle introduces ambiguity ("did I actually finish that?") and risks divergence from agent state.

## Recommended v1

The smallest fix that addresses the user pain:

1. Plan card gets a trailing menu button (3-dot or context menu) with **Mark Plan Abandoned**.
2. On tap, the card visually collapses to a one-line "Plan abandoned · N/M complete" pill, locally only. State persists for the session, not across launches.
3. No agent-side semantics. No step-level interaction. No edit. No retry.
4. Document the limitation in the menu's accessibility hint: "Hides the plan from your view. Does not stop the agent."

This buys the user an out for the obvious failure mode without committing to a co-designed plan-state contract with the agent.

## Open questions

- Should the abandon decision be remembered across app launches? Probably yes; without persistence, the abandoned plan reappears on cold start.
- Is "abandon" the right verb, or "hide"? "Abandon" implies a state change to the agent that we're not making in v1. "Hide" is more honest. Lean toward **Hide** for the first ship, rename later if we promote to D2.B.
- If the user hides a plan and the agent later updates it (resumes, completes), do we surface a "plan is alive again" toast or stay hidden?

## Out of scope

- Step-level toggling of any kind.
- Agent-side awareness of user override.
- Editing plan content.
- Persisting hidden state to the broker for cross-device sync.
