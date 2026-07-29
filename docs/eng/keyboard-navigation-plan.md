# Keyboard Navigation — repair and convergence plan

Status: DRAFT v2 (2026-07-29). Grounded in the full-client keyboard survey + verified review,
revised after Kimi's design review (10 findings; ⟨K&lt;n&gt;⟩ markers below; every code claim in
it re-verified — including that the focus pull consumes its request *before* the row-ref
lookup, and that `g g` today re-arms the chord). Companion grammar: the agents-tree study
(`design/studio/views/agents-tree.tsx:583-718`).

## Where we are

The client has two proven keyboard assets and a lot of divergence around them:

- **`ledger-focus-core`** (`packages/web/client/screens/broker/ledger-focus-core.ts`) — the
  numbered-request focus protocol hardened in #503. State-index navigation whose *intent to
  focus* is a counter, not a boolean, so clamps and re-renders can never spend a user's
  keypress. Wired and healthy in Dispatch (`useBrokerLedgerKeyboard.ts`).
- **The agents-tree grammar** (studio) — the target vocabulary: `j/k` + arrows, `h/l`
  structure, `Enter`/`o` activate, `Space` toggle, `/` search, `gg`/`G` extremes, chords.

Around them: four confirmed defects, five surfaces hand-rolling incompatible cursor systems,
eight window handlers with no modal suppression, five independent claims on `/`, ARIA roles
promising keyboard that doesn't exist, and a help overlay describing bindings that are dead.

## Principles

1. **One grammar.** The agents-tree vocabulary is the house standard. A key means the same
   thing on every list surface. `o` = open/activate (never three meanings), `i` = inspect,
   `/` = focus the surface's own filter, `Enter` = activate the row the user is looking at.
2. **One primitive.** Every list/tree surface navigates through the same react-free core
   (generalized `ledger-focus-core`), not a per-screen cursor. Cursor and DOM focus move
   together — what the eye tracks is what `Enter` activates and what screen readers announce.
3. **One arbiter.** A key has one owner per mount. Global chrome (shell) claims are explicit;
   surface claims are scoped and guarded; modal contexts suppress everything below them
   through a single gate (`isModalShortcutContext`), not eight hand-rolled typing checks.
4. **ARIA tells the truth.** A `role` that implies keyboard behavior ships with that behavior
   or the role comes off. No `role="menu"` without arrows, no `role="tree"` without `h/l`.
5. **The help overlay is generated truth.** `KeyboardHelpOverlay`'s GROUPS list is derived
   from the registry, not parallel prose that drifts.

## The one product decision to ratify

**Bare `g` belongs to the shell.** The go-prefix chord (`g`+key navigation,
`OpenScoutAppShell.tsx:875-880`) stops propagation at capture phase, so surface-level bare-`g`
bindings (`g`→first row in ledger/lanes/scope, `g`→jump-to-live in Tail) have been dead since
the chord shipped. Two ways out:

- **(A — recommended)** Ratify shell ownership. Surfaces drop bare `g`; `Home`/`End` and `G`
  stay; "top of list" becomes the `g g` chord *routed through the shell's own prefix table*
  (when armed and the second key is `g`, the shell emits a scoped "list-home" action instead
  of clearing). One owner, chord preserved, agents-tree grammar intact.
- (B) Shell yields `g` when a surface claims it. Requires the registry (K6) first and makes
  `g`-nav unavailable on list screens — worse trade.

Everything below assumes (A).

## Workstreams (each row ≈ one PR, temp-index peel, clone-verified)

### K1 — Stop lying about `g` (small, immediate)
Remove the dead bare-`g` bindings and their help-overlay entries; land the `g g` chord in the
shell prefix table.
- `OpenScoutAppShell.tsx` go-prefix: on armed + `g`, dispatch `scout:list-start` and
  **return**. ⟨K3c, verified⟩ Today armed-then-unknown clears and *falls through* to line
  875, so `g g` re-arms the chord — the relay branch must not fall through, or you get
  list-start plus a re-armed chord eating the next key.
- ⟨K3b⟩ The event is `scout:list-start` (not "list-home"): "start of this surface's stream."
  Lists interpret it as first row; Tail interprets it as the live edge. One event, one
  meaning, surface-local projection.
- Drop bare `g` from: `useBrokerLedgerKeyboard.ts:90`, `useAgentLanesKeyboard.ts:82`,
  `useScopeLanesKeyboard.ts:72`, `TailView.tsx:531`, **and `lib/keyboard-nav.ts:90`**
  ⟨K3a⟩ (`useListArrowNav` binds bare `g` as Home — equally dead; K2 touches this file, the
  removal belongs to K1's sweep).
- `KeyboardHelpOverlay.tsx` GROUPS: correct Lists/Tail entries.
- ⟨K4⟩ The relay is **temporary plumbing**: K6's acceptance criteria delete it (see K6).
- Tests: relay fires exactly once per chord and the chord does not re-arm; armed-then-unknown
  still clears.
- GOTCHA: BrokerScreen greps need `grep -a` (non-UTF8 bytes).

### K2 — Revive the rails (small, immediate)
`listButtons` (`lib/keyboard-nav.ts:67-77`) matches nothing at any of its three consumers.
- Fix the selector to a marker-based query: `button[data-list-primary]:not([disabled])` via
  `list.querySelectorAll` at any depth, keeping DOM order.
- Stamp `data-list-primary` in `RailRow` (`scout/slots/RailRow.tsx:101`) so chat rail and
  ops mission rail participate; terminal rail already stamps it.
- Tests (react-free): extract `listButtons` + step logic into `lib/list-buttons-core.ts`,
  fixture the three real DOM shapes, prove non-empty resolution and `makeSearchHandoff`.
- Acceptance: `j/k`/arrows/Home/End + search→list handoff work on chat, terminal, mission rails.

### K3 — Projects inbox: one row of truth (medium)
`ProjectsInbox.tsx:2107-2136`: Enter navigates the *cursor* row (default 0) while the user's
*focus* may be elsewhere; cursor never moves focus; handler ignores modals; rows are buttons
whose native activation half-collides with the document handler.
- Adopt the K5 primitive early here (it's the proving ground): cursor = focus (roving
  tabindex), `Enter` activates the focused row's *open* route, single-click select stays on
  the row button, document handler goes away in favor of a container-scoped one.
- Add `Escape` (clear cursor), `Home`/`End`, modal gate.
- Tests: the #503 reproduction discipline — focus/cursor can never disagree; Enter with no
  prior j/k activates the focused row, not row 0.

### K4 — Atop repairs (small)
- `AtopView.tsx:748-751`: make `Enter` activate the selected row (route to session), not a stub.
- Move the `Escape` clear *after* the editable bail so typing in the filter isn't hijacked
  (`:727-735`); filter Escape keeps clearing the query at the input level.

### K5 — The shared list-focus primitive (the core lane)
Generalize `ledger-focus-core` → `lib/list-focus-core.ts` (react-free; bun test cannot import
react — all logic stays in the core, the hook is a thin adapter):
- ⟨K2⟩ **Design constraint, stated up front: the core stays small.** Exactly the
  numbered-request surface (move/track/clamp/shouldPull) plus stable-ID row resolution.
  Wrap, scroll policy, presence guards, activation, and every future knob live in the
  `useListFocus` adapter or per-surface options — never in the core. If a surface needs
  something the adapter doesn't expose, extend the adapter. The K3 proving ground must not
  bake inbox-shaped assumptions into the shared core.
- ⟨K6, verified⟩ **Row identity is a stable ID; index is a projection.** The scalar-index
  clamp lands on arbitrary neighbors when rows vanish (tree parent collapses, page swaps);
  ID-based resolution lands on the nearest visible ancestor-or-sibling instead. And the
  focus pull must leave the request **unconsumed until the target node actually receives
  focus**, re-attempting on row mount — today `useBrokerLedgerKeyboard.ts:47` consumes
  before the ref lookup, so a virtualized/unmounted row silently spends the keypress: the
  exact "never spend intent" guarantee, violated through the DOM side. Decide and document
  whether focus-managed lists may be virtualized; if yes, the re-attempt path is mandatory.
- ⟨K7⟩ **Two DOM projections, one protocol.** Roving tabindex is the default; an
  `aria-activedescendant` projection covers surfaces where an owning input keeps focus while
  arrows move a cursor (command palette, search→results handoff). Same core underneath.
- One hook `useListFocus` replaces the per-screen systems in: agents library
  (`screens/agents/library.tsx:441-499`), RawSessionsTable (`:358-393`), Atop, ProjectsInbox
  (from K3), and becomes the implementation inside `useBrokerLedgerKeyboard`,
  `useAgentLanesKeyboard`, `useScopeLanesKeyboard` (API unchanged, protocol shared).
- Kill the tab-stop explosion where the primitive lands: DataTable rows
  (`components/DataTable/DataTable.tsx:333-335`) get roving tabindex + `aria-selected`.
- ⟨K9⟩ Acceptance: every `useListFocus` surface ships a visible cursor style token
  (distinct from hover; not a suppressed button focus ring), demonstrated on the K3 proving
  ground. This is the difference between the grammar existing and users finding it.

### K6 — Scoped shortcut registry + generated help (the arbitration lane)
A small registry (`lib/shortcut-registry.ts`): claims = {key, scope, guard, handler, label,
group}. Shell chrome claims are one scope; each surface registers on mount, unregisters on
unmount; the dispatcher runs at capture once, applies the modal gate once, and resolves
exactly one owner (innermost surface wins; shell chords beat surface singles).
- ⟨K1⟩ **The registry owns the overlay stack.** The modal gate is "overlay stack non-empty",
  not attribute inspection — `isModalShortcutContext`'s hand-stamped DOM attributes fail
  open whenever an overlay forgets its attribute, the same defect class as the eight
  hand-rolled typing checks. Overlays register presence on mount (K7's
  `useDismissibleOverlay` does this anyway), which also yields Escape-stack ordering for
  free: only the top of the stack receives Escape.
- ⟨K5, verified⟩ **IME/composition gate, dispatcher-level, once.** No navigation handler in
  the client checks `e.isComposing` today — a CJK composition-confirming keystroke can fire
  surface shortcuts. One rule: `isComposing`/keyCode 229 suppresses all single-key claims.
  Policy: letter bindings are layout-dependent mnemonics — do **not** switch to `e.code`
  positional binding (it breaks the mnemonics and the help overlay). Verification bar: a
  composing keydown resolves no owner.
- Migrate: the shell handler (`OpenScoutAppShell.tsx:852-951`), the five `/` claimants, ⌘K
  (exclusive; palette presence goes through the overlay stack), `o`/`j`/`k` surface claims.
- ⟨K4⟩ Acceptance: the K1 `scout:list-start` relay is **deleted** and re-expressed as a
  shell-scope claim with scoped dispatch; verification grep — no
  `addEventListener("scout:` remains in the client.
- `KeyboardHelpOverlay` GROUPS becomes `registry.describe()` — the overlay can no longer drift.
- The hudsonkit `CommandPalette` stub either gets a real implementation (input, arrows, Enter,
  Escape — activedescendant projection from K5) or ⌘K stays unbound until it does — no dead
  affordance.

### K7 — ARIA honesty pass (mechanical, several small PRs)
- Tablists (`deck-parts.tsx:762`, `DiffHeader.tsx:211`, `CodeScreen.tsx:596`,
  `WorkFilesViewer.tsx:431`, `MissionControlCanvas.tsx:264`): one `useTabListNav`
  (Left/Right/Home/End, roving) or drop the roles. ⟨K8⟩ **House rule: manual activation** —
  arrows move focus, Enter/Space activates. Consistent with "Enter activates what you're
  looking at", and automatic (selection-follows-focus) activation on heavy panels causes
  focus-triggered data churn — the class #503 hardened against. All five tablists, one policy.
- Menus (`components/ContextMenu.tsx`, `scout/nav-system-menu.tsx`, lanes deck popover
  `AgentLanesView.tsx:1013-1085`): arrows + Enter + Escape + typeahead, or drop `role="menu"`.
- Code tree (`CodeScreen.tsx:542-586`): `role="tree"` gets the agents-tree `h/l/j/k` grammar
  via the K5 primitive with a collapse dimension — this is also the Repos→Code keyboard story.
- Overlay hygiene: fold the ~10 Escape-but-no-trap overlays onto `SlidePanel`'s contract or a
  shared `useDismissibleOverlay` (Escape + trap + return-focus + scrim); give the four
  no-Escape dialogs Escape.

### K8 — Zero-keyboard surfaces (scheduled by traffic, not completeness)
Projects rail, Agents console/rail first (daily-driver surfaces, K5 drop-in). Mesh, Repos,
Work, Harnesses, sidebar/inspector only as they earn it — minimum cog load; not every surface
needs a cursor.

## Explicitly not doing ⟨K10⟩

- **No key remapping / preferences system.** The house grammar is hardcoded; configurability
  is a separate product decision and building for it now doubles the registry's complexity.
- **No vim superset.** No counts (`3j`), no marks, no leader key, no operator-pending chords
  beyond `g`. The agents-tree grammar is the ceiling.
- **No terminal/xterm key routing through the registry.** `isTerminalInputTarget` stays a
  hard outer guard; xterm owns its keys.
- **No third-party hotkeys library.** The registry is ~200 lines; a dependency imports
  someone else's arbitration semantics and buys nothing.
- **No new ARIA roles in repair PRs.** K7 wires behavior to existing roles or removes them.
  Adding roles to surfaces that lacked them is feature work.
- **No mouse or visual-design changes riding along.** The K5 cursor style token is the one
  sanctioned exception.

## Sequencing and collision guards

K1 → K2 → K4 ship immediately (small, independent). K3 next (proves K5's shape on the
hardest surface). K5 → K6 are the core; K7/K8 ride behind them.

**Runtime-identity lane collisions:** BrokerScreen and the composer surfaces are inside the
active runtime-identity implementation footprint. K1 touches `useBrokerLedgerKeyboard` only
(hook file, not BrokerScreen) — safe. RuntimePicker's missing arrow-nav
(`components/MessageComposer/RuntimePicker.tsx:274-288`) is deliberately **deferred to
strand F** — it lands with the picker, not this plan. Any K-lane touching `OpenScoutAppShell`
must re-diff against origin/main at peel time (concurrent sessions commit to this branch).

## Verification bar

Every PR: react-free core tests beside the logic (bun cannot import react), clone-verify via
temp-index + `bun run check`, and — for K3/K5/K6 — one adversarial review round with an
executable reproduction of the class defect (stale intent, focus/cursor divergence, double
owner). Help-overlay truthfulness is an acceptance criterion from K1 on: nothing listed that
doesn't work, nothing working that isn't listed.
