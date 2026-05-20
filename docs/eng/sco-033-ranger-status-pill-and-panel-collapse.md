# SCO-033: Ranger Status Pill and Panel Collapse

## Status

Proposed.

## Proposal ID

`sco-033`

## Intent

Move Ranger's always-on summoning, state indication, and Brief trigger out of
the right-sidebar drawer and into a single persistent pill in the status bar.
Reduce the docked Ranger panel to a summon-only conversation surface. Make
"Brief" a voice + UI-navigation experience rather than an inline panel block.

The goal is to give Ranger a permanent, low-noise home in app chrome — the same
status-bar real estate that already carries `status`, `agents`, `mesh`, and
`broker` — and free the right inspector from carrying a ~320px drawer that
most users see in an empty state.

## Problem

The Ranger panel today lives at the bottom of the right inspector
(`packages/web/client/scout/slots/Inspector.tsx`), vertically resizable from
180px to 70% of inspector height, default 320px. It is always rendered, even
when collapsed.

When expanded, it stacks up to seven concurrent surfaces above the textarea:
error banner, reminders, brief panel, voice setup, speaking indicator, ask
status, sending hint. At peak, the chat scroll area is squeezed to ~80-120px
exactly when context is most needed.

The bottom control row currently carries five buttons sharing one line —
`mic / state / brief / voice-toggle / discard` — three of which (`state`,
`brief`, `voice-toggle`) are not chat input peers but mode triggers. New users
cannot distinguish "type a question" from "tap State" from "tap Brief" by
label alone. The collapse strip does three jobs simultaneously (ambient peek
of last reply, header icons, expand pill).

Brief in particular has outgrown its inline rendering. The brief is now
delivered verbally (TTS) with synchronized UI navigation events
(`applyRangerUiAction`). The inline title/summary/freshness/action card is a
historical artifact — it duplicates the voice payload and competes with the
chat scroll for vertical space.

## Decision

OpenScout SHOULD add a **Ranger status pill** to the right end of the global
status bar and demote the docked Ranger panel to a summon-only conversation
surface.

The pill is the persistent affordance. The panel opens when the user wants to
read, scrub, or type — not by default.

### Why the right side of the status bar

The Ranger panel docks at the bottom of the right sidebar. A pill in the
bottom-right corner sits directly under the panel it summons — click the pill,
the surface immediately above it focuses or expands. The left side of the
status bar already carries the infra cluster (`agents`, `mesh`, `broker`);
Ranger is the operator's interlocutor, not an infra readout, and a small
category gap helps the eye parse the bar. Convention also favors bottom-right
(Cursor, Copilot, JetBrains AI, Zed).

The tradeoff is that Ranger is no longer literally "next to broker." That is
accepted in exchange for the spatial-continuity gain.

## Pill State Machine

One pill, layered states. Compact at rest, informative when active.

| State          | Visual                                      | Notes |
| -------------- | ------------------------------------------- | --- |
| idle           | `[ ⌁ Ranger ]` (dim)                        | default |
| brief-fresh    | `[ ⌁ Ranger · 2m ]`                         | decays after ~5m |
| listening      | `[ ⌁ Ranger · ● listening ]` pulse          | mic open |
| thinking       | `[ ⌁ Ranger · ⟳ thinking ]`                 | sending / awaiting reply |
| speaking       | `[ ⌁ Ranger · ◜ speaking ]`                 | TTS playing |
| briefing       | `[ ⌁ Ranger · ⟳ briefing ]`                 | brief in flight; nav events incoming |
| reminders-due  | `[ ⌁ Ranger · ● 2 due ]` amber              | promotes the current reminders banner |
| error          | `[ ⌁ Ranger · ● error ]` red                | promotes the current red banner |
| voice-offline  | `[ ⌁ Ranger · ⚠ setup ]`                    | replaces VoxSetupPanel as default surface |

Priority when stacked (only one shown; rest available via hover tooltip):

```
error > reminders-due > active(listening|thinking|speaking|briefing)
       > brief-fresh > voice-offline > idle
```

### Interactions

- **Left-click** — focus Ranger. Expands the right panel if collapsed,
  scrolls input into view, focuses textarea.
- **Right-click / overflow** — menu:
  - Brief me now
  - Ask state
  - Toggle voice replies
  - Mute reminders (when applicable)
  - Settings
- **Hover** — tooltip with full state + last activity time + active session
  title.
- **Keybind** — `Cmd+;` to focus Ranger from anywhere; second press collapses.

## Brief Flow

1. User triggers Brief (pill menu, `Cmd+;` chord, or command palette).
2. Pill transitions to `briefing` (spinner).
3. TTS narrates the brief. `applyRangerUiAction` nav events fire to walk the
   operator across screens.
4. On completion:
   - Pill transitions to `brief-fresh · 0m`, decays over ~5m.
   - A one-line broadcast posts to the broadcast ticker:
     `Ranger brief · 4 working · 2 needs-attention · 9:12`.
   - The brief transcript still lands in the Ranger session as an assistant
     message (chat history retains it).
   - The inline brief panel block is **not** rendered.

## Panel Deltas

### Removed

- Bottom-row **Brief** button → pill menu item.
- Bottom-row **State** button → pill menu item (`Ask state`).
- Inline brief panel block (title / summary / freshness / action buttons) —
  superseded by voice + nav + ticker headline.
- Always-on reminders banner — promoted to pill `reminders-due` attention
  state, with a popover on click. A deeper reminder list remains accessible
  via settings or session view.

### Kept

- Chat history (markdown, copy/say-again/file chips, right-click menu, session
  picker).
- Textarea + Send.
- Mic + voice-replies toggle (voice is in-conversation; belongs adjacent to
  input).
- VoxSetupPanel, but rendered only when voice is unavailable and collapsed to
  a one-line strip until clicked.
- `+` new-chat in the header.
- Settings drawer (low-frequency; fine to keep in panel).

### Default Behavior Change

- `openscout.ranger.collapsed` default flips from `false` to `true`. New users
  see Ranger as a chrome pill, not a docked drawer.
- Default `openscout.ranger.height` drops from `320` to `260`.
- Existing users with a persisted `collapsed: false` are honored as-is. No
  retroactive flip.

Net effect on the panel: header + chat + small voice row + input. Empty state
finally has room to surface starter prompts.

## Wiring

- **Pill component** — `RangerStatusPill`, mounted by extending
  `OpenScoutStatusBarRight` in
  `packages/web/client/OpenScoutAppShell.tsx:68`. Reads a new
  `useScoutRangerState()` hook.
- **State source** — bookkeeping for `briefing / recording / speaking /
  sending / reminderState / voiceAvailable / error / brief-freshness`
  currently lives inside `RangerPanel.tsx:263+`. Lift into the existing Scout
  provider context at `packages/web/client/scout/Provider.tsx` so the pill and
  panel both subscribe.
- **Brief trigger** — the existing `briefRunRef` flow is unchanged. Pill menu
  item dispatches the same action the bottom-row button does today.
- **Post-brief broadcast** — emit on brief completion via the broadcast
  emitter used by other server-side events. Tier: `info`. Identify so that
  multiple briefs in a short window coalesce or replace rather than stack.
- **Inline brief block removal** — delete the inline brief render in
  `RangerPanel.tsx`. The assistant message itself stays in the session
  transcript.
- **Collapse default** —
  `usePersistentBoolean("openscout.ranger.collapsed", true)`.

## Ship Order

Each step is independently shippable and does not break the prior state.

1. **Lift Ranger state to context.** No UI change. Prep for the pill. Verifies
   the panel still works against the new provider source.
2. **Add the pill** in `idle / active / brief-fresh` states; click focuses the
   existing panel. No menu yet.
3. **Pill menu** with `Brief me now` and `Ask state`. Remove those buttons
   from the panel bottom row.
4. **Voice + reminders + error states** on the pill. Promote reminders banner
   out of the panel into the pill attention state and popover.
5. **Verbal + nav-only brief.** Delete the inline brief panel block. Emit the
   post-brief broadcast headline.
6. **Flip collapsed default + reduce default height.** Pill becomes the only
   always-on Ranger affordance.

After step 6, the right sidebar is back to "the inspector" rather than "the
inspector with a Ranger drawer pinned to the bottom" — the original UX goal.

## Non-Goals

- No change to the Ranger server-side session model, brief generation, voice
  pipeline, or reminders persistence.
- No change to the broadcast event schema. The post-brief headline reuses the
  existing `Broadcast` shape (`tier: "info"`).
- No new status-bar surfaces for other actors (Hudson, Concierge) in this
  proposal. The pill convention is documented here so future surfaces can
  follow the same pattern.
- No retroactive flip of the collapsed preference for existing users.

## Open Questions

- **Reminders on the pill vs in the panel.** Promoting to a pill attention
  state is the proposal, but we may find the popover discoverability is worse
  than the always-visible banner. Validate after step 4; if regression,
  re-introduce a compact in-panel strip.
- **Voice-setup placement.** Currently proposed: a one-line strip above the
  input that expands on click. Alternative: drive entirely from the pill's
  `voice-offline` state with a popover. Decide after step 4.
- **Brief headline coalescing.** If a user triggers Brief twice within a
  minute, do we emit two broadcasts or replace the first? Lean replace.
- **Keybind.** `Cmd+;` is the current proposal. Confirm it is unclaimed by
  the command palette and Hudson chord set.
- **Pill in narrow viewports.** Status bar already truncates the build label
  at `max-w-[38vw]`. Define the pill's minimum width and which fields drop
  first (label → dot only).
