# SCO-048: Native HUD — Desktop Ranger Cockpit And Slot Shell

## Status

Proposed.

## Proposal ID

`sco-048`

## Intent

Define the product and architecture for a native macOS HUD that brings
OpenScout's Ranger persona to the desktop as a deeply-iterated, always-on
cockpit, and that hosts the rest of the studio's surfaces as configurable web
view slots bound to operator-chosen hotkeys.

The proposal asserts two things at once:

1. **One native surface, deeply owned.** The Ranger cockpit is a hand-crafted,
   keyboard-driven, multi-column conversational surface that runs in a glass
   `NSPanel` — the operator's persistent home for fleet management. This is the
   surface we iterate on continuously.
2. **Everything else stays web.** Tail, fleet, mission, agent detail, canvas,
   brief in-flight — anything else the operator wants always-near — lives as a
   studio web view slotted into the HUD shell and bound to a hotkey. The shell
   handles glass, position, hotkey routing, always-on-top, multi-space; the
   views render themselves.

The goal is to put fleet operation one keypress away from anywhere on the
desktop without porting the studio's full UI to native.

## Context

The product surface today has three live forms:

- **Studio web app** (`apps/web`) — the rich operator surface. Reading the
  brief, composing in the brief-author, browsing studies, working in any of the
  Ranger / mesh / fleet / inspector / canvas screens.
- **Menu bar app** (`apps/macos`) — a thin native presence today; mostly a
  launcher with palette tokens shared with lattices.
- **iOS Scout** (`apps/ios`) — the mobile remote / Ranger surface (see
  [`sco-045`](./sco-045-mobile-fleet-posture-and-ranger-tiers.md)).

What's missing is **the always-near desktop surface**. Today the operator has
two options to check the fleet:

- Switch to a browser tab and load the studio (heavyweight, breaks focus)
- Squint at a menu bar icon (no detail, no interaction)

The brief-author (per `/studies/brief-author`) and operator-brief (per
`/studies/operator-brief`) work assume an operator who's actively driving from
the studio. The native HUD covers the time *between* those sessions — when the
operator is in another app (editor, terminal, browser) and wants fast,
low-friction visibility into what their agents are doing without leaving the
current context.

A separate constraint: porting the studio's surfaces to native Swift would
consume years of engineering and never reach feature parity. The slot model
dodges this entirely by hosting web views inside the native shell.

Relevant prior work:

- [`sco-035`](./sco-035-ranger-chip-unification.md) — Ranger surface
  unification on the web
- [`sco-037`](./sco-037-ranger-brief-pipeline.md) — Ranger brief two-stage
  pipeline (analyst + presenter)
- [`sco-045`](./sco-045-mobile-fleet-posture-and-ranger-tiers.md) — Mobile
  Ranger tiers, including hosted Ranger
- [`sco-046`](./sco-046-cross-machine-agent-ui-spec.md) — Cross-machine agent
  UI (slots and shell must handle multi-node fleets)
- Sibling lattices repo at
  `/Users/arach/dev/lattices/apps/mac/Sources/Core/Overlays/HUD/` — the visual
  DNA and the existing NSPanel + glass framework to build on
- Studio study `/studies/hud-native` — the visual spec for everything in this
  proposal

## Product Thesis

The HUD is not a parallel app. It is the desktop face of the studio, brought
close enough to the operator's work that checking on the fleet is friction-free.

The Ranger cockpit is the deeply-iterated native heart: one well-thought
surface that the operator's keyboard-driven workflow can settle into.
Everything else is a slot — and the slot system is what lets the HUD grow with
the studio without doubling our build cost.

When the operator hits the cockpit hotkey, three things must be true:

- The cockpit appears in a known, persistent location
- It shows enough to answer "what is my fleet doing right now?" in two seconds
- The next thing the operator wants to do — message an agent, decide a blocked
  ask, surface a tail of events, browse the fleet at depth — is one keypress
  away

That's the entire product contract.

## Scope

In scope:

- Native macOS HUD shell architecture (NSPanel, glass, hotkey, position memory,
  multi-space, always-on-top)
- Ranger cockpit information architecture, modes, keyboard navigation,
  conversational input
- Slot model: shell-as-host pattern, web view contract, configuration surface,
  hotkey binding
- Hotkey scheme (cockpit chord + slot hotkeys + in-cockpit modes)
- Initial library of candidate slottable web views
- Relationship to existing menu bar app, studio web app, iOS Scout, lattices
  HUD framework
- Implementation phases and acceptance criteria

Out of scope:

- Cross-platform (Windows, Linux) — macOS-first; Windows / Linux follow if
  proven
- iOS Ranger parity — the desktop cockpit and the mobile Ranger share persona
  but ship independently per `sco-045`
- Hosted Ranger (oscout.net) — covered by `sco-045`
- Voice synthesis (TTS) for the Ranger's spoken output — handled by `sco-037`'s
  presenter stage; the cockpit consumes the analyst's markdown report
- New broker primitives or protocol changes — cockpit and slots consume
  existing surfaces

## The Native Shell

The HUD shell is the constant: glass treatment, NSPanel window, hotkey
routing, always-on-top, multi-space, position memory. Built on top of the
existing lattices HUD framework at
`/Users/arach/dev/lattices/apps/mac/Sources/Core/Overlays/`.

### Window pattern

`NSPanel` with `.nonactivatingPanel` style mask:

- Appears without stealing focus from the underlying app
- `collectionBehavior: [.canJoinAllSpaces, .fullScreenAuxiliary]` — follows the
  operator across Spaces, available in fullscreen apps
- `.floating` window level — above normal windows
- Hidden title bar, `.darkAqua` appearance forced
- Position remembered per slot; the cockpit's position is the canonical one

### Glass treatment

Translated directly from lattices `HUDChrome.swift`:

- Dark base (`rgb(14, 15, 18)` top → `rgb(6, 7, 10)` bottom) with a slight cool
  cast
- `.ultraThinMaterial` substrate behind the panel for backdrop blur
- Thin white overlays (`rgba(255,255,255,0.045)` default, `0.075` strong) for
  inner surfaces
- Color discipline: cyan + rose as a signal-only spotlight pair; amber dropped
  entirely
- Mesh-light cursor specular: subtle 3×3 highlight tracking mouse position
  (max 6% intensity)
- Top-edge rim light + corner halos: cockpit-illuminated-from-above signal
- Hairlines as pure white-alpha gradient bars between regions

### Hotkey routing

The shell registers global hotkeys via `Core/Actions/HotkeyManager.swift`:

- Cockpit chord: `⌃⌥⇧⌘ + A` (locked, built-in; not user-rebindable)
- Slot hotkeys: `⌘1` through `⌘6` default-bound; user-configurable
- Esc dismisses the active surface (cockpit or slot)
- Re-summon while open: cockpit chord toggles the cockpit; a slot hotkey while
  a different slot is up swaps content in the same shell

### Position memory

The cockpit's position is sticky to the operator's choice (a setting). Slots
share the cockpit's position when summoned — same physical location, content
swaps.

## The Ranger Cockpit

The cockpit is the one native surface we deeply own and iterate on. Visual
spec: `/studies/hud-native` (the "conversational cockpit" section).

### Form

- Size: 860 × 540 (initial target; operator-resizable in later phases)
- Layout: three Miller-style columns + top status strip + bottom conversational
  dock
- Top strip (~30 px): mode indicator (vim-style `-- NORMAL --` / `-- COMMAND --`
  / `-- SEARCH --` / `-- TALK --`), fleet pulse summary, hotkey hint
- Three columns:
  - **Fleet (~210 px)** — agent list with hue stripes, status glyphs, current
    task one-liner. `j/k` navigates. Selection drives column 2.
  - **Context (~320 px)** — selected agent's recent state: 2–3 line italic
    last-turn summary, stat KV block (runtime / files / tokens / model /
    branch), last cross-agent message, pending asks, drill targets at bottom
  - **Focus (~330 px)** — drill content. Default: full text of the most recent
    turn rendered as editorial prose. Other drill states: file diffs, message
    log, files-touched list
- Bottom dock (~48 px): always-pinned mic + text input. Empty hint: *"talk to
  the assistant: ':' for commands, '/' for search, anything else
  conversational."*

### Modes

- **NORMAL** — read state, `j/k/h/l` navigation
- **COMMAND** — `:` prefix; floating glass palette above the dock lists matching
  commands (`:spawn`, `:msg`, `:focus`, `:list`, `:dismiss`)
- **SEARCH** — `/` prefix; fuzzy match across agents, threads, files, message
  log
- **TALK** — toggled by `t` (or hold-to-talk modifier); mic active, the
  operator dictates intent in natural language. Response materializes in
  column 3 with a thinking pulse and inline composing cursor. The
  `live · will commit on stop` footer signals voice-as-gesture: the message
  commits when the operator stops speaking, not as each word is transcribed.

### Conversational contract

The cockpit IS the operator's QB agent (per `project_qb_agent_vision`) made
manifest. The conversational layer:

- Operator speaks or types intent in natural language
- The cockpit's resident agent (the QB) interprets and either executes (sends
  a message, focuses a thread, spawns an agent) or asks for clarification
- The QB knows the operator's projects, sessions, and preferences; absorbs
  infrastructure choices (harness, model, branch, worktree)
- The vim-style modes (`:` `/` `t`) are escape hatches for operators who want
  determinism over conversation

### Keyboard navigation

- `j/k` — up / down in the current column
- `h/l` — move between columns
- `enter` — drill down (drives the next column to the right)
- `:` — command mode
- `/` — search mode
- `t` (or modifier hold) — toggle TALK mode
- `⎋` — dismiss cockpit (or exit current mode)

### Attention treatment

When an agent in the fleet needs the operator (the study's example:
Drover · `waiting on you · which migration to roll first`), the cockpit:

- Shows the attention agent's row in column 1 with the rose treatment (left
  bar narrow rose, status glyph rose)
- Auto-focuses that agent when the cockpit is summoned with pending attention
- Column 2 shows the dedicated `waiting on you` block above the standard
  context
- Column 3 shows the full ask and decision options
- The single warm element rule holds: rose appears in exactly two places (col 1
  row + col 2 ask block); a recommended option in col 3 may carry a small cyan
  tick

## The Slot Model

Every studio surface that the operator might want always-near is a candidate
slot. The shell hosts a web view; the view is the studio page rendered at the
shell's dimensions.

### Initial slot library

Six candidates ship as defaults (visible in `/studies/hud-native` slot library
section):

1. **Tail** — recent firehose events. Stacked event list, scoped to the
   operator's fleet, ~12 events visible.
2. **Fleet** — denser grid than the sheet variant: compact agent chips with
   hue stripe + name + status, no per-agent depth.
3. **Mission** — initiative-grouped view: agents clustered by what they're
   working on (Auth audit, Migration roll, Landing copy).
4. **Agent detail** — single agent deep dive: name + role header, recent turn
   summaries, full stat block, message log.
5. **Canvas** — spatial layout: agents positioned freely, message-flow
   connections drawn between them.
6. **Brief in-flight** — the current brief specimen summoned into the shell
   (the surface from `/studies/operator-brief` and `/studies/brief-author`).

The library is open-ended; any studio page that renders cleanly at shell
dimensions is a candidate.

### Web view contract

A slot is a studio page that:

- Renders at the shell's dimensions (initially 860 × 540, matching the
  cockpit; future shells may vary)
- Reads `data-theme="dark"` (the shell forces dark appearance)
- Adapts to the glass substrate: own background is transparent or
  near-transparent; text contrast tuned for the dark base
- Handles its own keyboard interaction within the shell
- Implements a minimal lifecycle: `onMount`, `onUnmount`, `onResize`

Studio pages that don't yet meet the contract can be wrapped in a
slot-adapter component that handles the shell-specific concerns.

### Configuration surface

The operator's slot bindings live in a settings table (see the study's
hotkey-registration section):

```
⌃⌥⇧⌘ + A    cockpit                  [built-in · not editable]
⌘1          tail                     ▾
⌘2          fleet                    ▾
⌘3          mission                  ▾
⌘4          agent (Hudson)           ▾
⌘5          canvas                   ▾
⌘6          brief in-flight          ▾
```

Defaults ship sane; everything except the cockpit row is reassignable. The
picker is direct selection — this is settings, not artifact editing, so the
agent-mediated principle from `/studies/brief-author` doesn't apply here.

### Slot summoning

- Operator presses a bound hotkey from anywhere
- If the shell is closed: shell opens at its remembered position with the
  bound view loaded
- If the shell is open with a different slot: content swaps in-place (same
  shell, same position, same glass — only the inner view changes)
- Esc dismisses

The single-shell-swap rule is deliberate: the operator's spatial memory is
for *where the HUD lives*, not *which HUD is which*. Multiple stacking shells
fragment attention and defeat the always-on-top discipline.

## Hotkey Scheme

### Layered

| Layer            | Hotkey            | What it does                              |
| ---------------- | ----------------- | ----------------------------------------- |
| Cockpit summon   | `⌃⌥⇧⌘ A`          | Toggle the Ranger cockpit                 |
| Slot summon      | `⌘1` – `⌘N`       | Open or swap to the bound slot view       |
| In-cockpit nav   | `j/k`, `h/l`, `↵` | Column / row navigation, drill down       |
| In-cockpit modes | `:` `/` `t`       | Command / Search / Talk                   |
| Dismiss          | `⎋`               | Exit current mode, then dismiss surface   |

### Conflict rules

- `⌘1` – `⌘6` are reserved at the shell level only while the shell is
  summoned; the underlying app sees no `⌘N` keystroke during that time. While
  the shell is dismissed, host apps see their normal `⌘N` behavior.
- The cockpit chord is intentionally a hyper key (all four modifiers) to avoid
  collision with any reasonable app shortcut.
- Operators can rebind slot hotkeys to other combinations; the shell does the
  rebinding without restart.

## Relationship To Existing Surfaces

### Menu bar app (`apps/macos`)

The menu bar app is the HUD shell's host process. The status bar icon stays
as the always-visible "OpenScout is running" indicator (with a thin pulse
glyph showing fleet state at a glance). Clicking the icon summons the
cockpit; the dropdown menu offers the slot list as an alternative summoning
path.

### Studio web app

The studio remains the rich operator surface for any deep work: composing a
brief, reviewing a debrief, browsing studies, deep agent inspection. The HUD
does not replace it; it lives alongside, summoned for fast checks and quick
steers.

Slot views are studio pages rendered in the shell — same code, same design
system, same data. Updates to a studio page automatically update the slot
version.

### iOS Scout

The desktop cockpit and the mobile Ranger surface (per `sco-045`) share the
Ranger persona but ship independently. Both consume the same Ranger brief
pipeline (`sco-037`) and the same broker reads. Desktop cockpit is the
keyboard-driven, dense form; mobile Ranger is the speech-and-glance form.

### Lattices HUD framework

The HUD shell is built on lattices' existing `HUDChrome.swift`,
`OverlayPanelShell.swift`, `HotkeyManager.swift`, `MenuBarController.swift`.
The lattices framework is the substrate; OpenScout adds the cockpit content
and the slot-hosting layer.

### Cross-machine fleets (`sco-046`)

The cockpit must reflect cross-machine fleet state without trying to be a
mesh diagnostic:

- Column 1 fleet list shows agents from all reachable nodes; node ownership
  rendered as a thin annotation, not a category
- Slot views inherit `sco-046`'s capability gating — operator can see remote
  agents but actions that require local authority are appropriately gated
- A future Mesh slot covers diagnostic / reachability concerns explicitly

## Decisions

### One cockpit, many slots — not three cockpits

Rationale:

- The operator's spatial memory tolerates one persistent surface, not three
- The Ranger cockpit's depth and conversational nature justify its dedicated
  form
- Other surfaces don't need a hand-crafted native treatment; web views suffice
- This concentrates engineering effort on the one surface that benefits most
  from deep native iteration

### Web view slots, not native ports

Rationale:

- The studio already implements every candidate slot surface — porting them
  costs years and never matches
- Web views inherit the studio's design system, theme tokens, and
  accessibility automatically
- A studio surface change ships to the HUD slot the same day
- The native shell does a small, well-defined job (glass, hotkey, position) —
  exactly where native delivers leverage

### Same shell, content swap on slot change

Rationale:

- Operator's spatial memory binds to *where*, not *which*
- Multiple floating shells fragment attention and defeat always-on-top
  discipline
- One position to learn; content cycles
- Esc always means "dismiss whatever's there," with no ambiguity

### Cockpit chord is hyper, slots are simple

Rationale:

- The cockpit is the always-on identity surface; its chord should be
  unforgettable and conflict-free
- Slot hotkeys are utilitarian; simple `⌘N` keeps muscle memory shallow
- Operators who want non-`⌘N` slot bindings can rebind

### Color discipline: cyan + rose, signal-only

Rationale:

- This is a serious operator surface, not a toy
- Color in the chrome reads as decoration; color on agent state reads as
  signal
- Cyan = working / focused, Rose = needs you. Two colors, two meanings, no
  others
- Amber and other accents drop; ink + thin white overlays carry 95% of the
  surface

### Direct selection in settings, agent-mediated everywhere else

Rationale:

- The agent-mediated editing principle (per
  `feedback_agent_mediated_editing_only`) applies to artifact editing —
  briefs, plans, content the agent helps compose
- Settings is configuration, not artifact. A dropdown to pick a slot view is
  fine; no need to route through a conversational agent
- The cockpit's conversational layer remains the channel for fleet
  operations, not for app settings

## Implementation Phases

### Phase 1 — Shell foundation

- Wire up the HUD shell on top of lattices' `OverlayPanelShell` and
  `HUDChrome` primitives
- Implement the cockpit chord (`⌃⌥⇧⌘ A`) via `HotkeyManager`
- Empty cockpit window with the glass treatment, top strip skeleton, three
  empty columns, bottom dock skeleton
- Position memory
- Dismiss / re-summon roundtrip

Acceptance: operator can summon and dismiss an empty glass cockpit from any
app, and it remembers its position across launches.

### Phase 2 — Cockpit content (NORMAL mode)

- Column 1: fleet list backed by broker fleet reads, with `j/k` navigation
- Column 2: selected agent context (recent turn, stats, drill targets),
  populated from existing agent detail reads
- Column 3: drill content (default to last-turn full text)
- Attention treatment for the rose agent
- Status strip live (mode indicator, fleet pulse, hotkey hint)

Acceptance: operator can summon the cockpit, see their fleet, navigate to any
agent, and drill into a turn — entirely from the keyboard, no mouse.

### Phase 3 — Cockpit modes (COMMAND, SEARCH, TALK)

- COMMAND mode: `:` prefix, palette, dispatching to existing broker actions
  (`:spawn`, `:msg`, `:focus`, `:list`, `:dismiss`)
- SEARCH mode: `/` prefix, fuzzy match across fleet / messages / files
- TALK mode: mic + text input wired to the QB agent (per
  `project_qb_agent_vision`); response materialization in column 3 with the
  live-cursor + commit-on-stop UX

Acceptance: operator can drive fleet operations conversationally OR via
commands, and the search mode surfaces relevant context within 250 ms of
typing.

### Phase 4 — Slot model

- Web view hosting in the shell (`WKWebView`)
- Slot configuration surface in app settings
- Default slot bindings (`⌘1` – `⌘6`) for tail / fleet / mission / agent
  detail / canvas / brief in-flight
- Shell content swap on slot hotkey
- Studio pages refactored as needed to meet the slot contract

Acceptance: operator can press `⌘1` through `⌘6` to summon any of the six
default slots, and the studio page renders cleanly in the shell.

### Phase 5 — Polish and operator-facing extension

- Operator rebinding of slot hotkeys
- Slot view library extended beyond the six defaults
- Multi-space and multi-monitor edge cases tightened
- Onboarding: first-summon experience teaches the cockpit + chord

Acceptance: a new operator can be productive in the HUD within their first
session without external documentation.

## Open Questions

- **Multi-monitor:** does the cockpit follow the mouse's screen, the active
  app's screen, or a chosen primary? Lattices' `OverlayPanelShell` offers
  `mouseScreenCentered`; this is the right default but may want a
  sticky-screen override.
- **TALK mode interruption:** if the operator starts speaking, then changes
  their mind, what's the cancel UX? Esc clears; should there also be a
  "press `t` again to discard" path?
- **Slot lifecycle:** when the shell dismisses, do hosted web views unload
  (saving memory but losing scroll state) or stay alive (faster re-summon but
  resource cost)? Probably stay alive for the cockpit-bound slot and unload
  for less-frequent ones; this needs measurement.
- **Cross-app focus stealing:** the `.nonactivatingPanel` style means the
  shell appears without stealing focus, but the cockpit must accept keyboard
  input. The handoff (operator's keystrokes route to the cockpit while typing,
  return to the host app on Esc) needs careful testing against editors with
  their own modal modes.
- **Brief in-flight slot:** the brief is per-session; what does the slot show
  when no brief is in-flight? Empty state? Most recent debrief? List of recent
  briefs to pick from?
- **Cockpit on tiny screens:** 860 × 540 is large for a 13" MacBook. Does the
  cockpit shrink? Operator-resize? Or is there a "compact mode" with col 3
  collapsed?

## Non-Goals

- The cockpit is not a window manager. It doesn't tile, arrange, or capture
  host windows. (Lattices does that.)
- The cockpit is not a terminal multiplexer. It doesn't host shells or capture
  tmux sessions.
- The cockpit doesn't try to replicate every studio surface natively. Slots
  cover the rest.
- The cockpit isn't a notification center. Apple's notification system
  handles event push; the cockpit handles glance + steer.

## References

- Visual spec: `/Users/arach/dev/openscout/design/studio/app/studies/hud-native/page.tsx`
  (the `/studies/hud-native` study)
- Lattices HUD framework:
  `/Users/arach/dev/lattices/apps/mac/Sources/Core/Overlays/HUD/`
- Lattices NSPanel shell:
  `/Users/arach/dev/lattices/apps/mac/Sources/Core/Overlays/OverlayPanelShell.swift`
- Lattices hotkey:
  `/Users/arach/dev/lattices/apps/mac/Sources/Core/Actions/HotkeyManager.swift`
- Memory: `project_qb_agent_vision` (long-running QB agent as conversational
  session manager)
- Memory: `reference_lattices_design` (lattices as openscout's macOS visual
  reference)
- Related: `sco-035`, `sco-037`, `sco-045`, `sco-046`
