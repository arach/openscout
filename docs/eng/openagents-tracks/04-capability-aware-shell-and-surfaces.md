# Capability-Aware Shell and Surfaces

## Purpose

Make OpenScout surfaces explain what the system can actually do, what is ready right now, and what still needs setup. The shell should not just show agents and runtimes; it should surface capability, readiness, and shared resources as first-class product state.

This track is the presentation layer for the catalog and resource model. It does not define the catalog schema itself or the broker protocol; it consumes those inputs and renders them consistently across the native shell, desktop host shell, web surfaces, and CLI/TUI.

## Goals

- Show harness capability and readiness everywhere the operator looks.
- Make shared resources visible as durable inventory, not hidden tool outputs.
- Reduce onboarding friction by turning "what do I install or configure?" into a direct UI answer.
- Keep shell chrome thin and drive the same state model across Swift, desktop, web, and terminal surfaces.
- Make degraded or partial setups legible instead of binary on/off.
- Remove legacy wrapper terminology from operator-facing UI in favor of agent, harness, transport, and endpoint language.

## Non-Goals

- Do not invent a new broker protocol in this track.
- Do not move orchestration logic into the UI.
- Do not make every surface identical. The contract should be shared; the presentation should fit the surface.
- Do not treat capability icons or badges as decoration. They must map to real runtime or catalog state.

## Product Shape

The shell should answer four questions fast:

1. What is installed?
2. What is ready?
3. What can this runtime do?
4. What shared resources already exist?

The shell should also avoid leaking legacy implementation nouns. If the operator is looking at a persistent local project runtime, the UI should describe it as an agent or endpoint, not as a separate wrapper object.

The current repo already has the right surface split:

- Native shell: `ScoutApp`, sidebar, footer status bar, embedded WebKit surface, helper supervision.
- Desktop host shell: overview, machines, plans, relay, inter-agent, agents, logs, settings.
- Web surfaces: broker-backed workspace views and product framing.
- CLI/TUI: bootstrap, doctor, status, add/list-style operator commands.

This track makes those surfaces read from the same capability model.

## UI Information Architecture

### Native Shell

The native shell should stay the operator cockpit. Its job is to show status, inventory, and launch points, not full management workflows.

- Sidebar: add a dedicated capability entry under integrations or system, not another generic settings page.
- Dashboard: show top-level counts for installed harnesses, ready harnesses, degraded harnesses, and shared resources.
- Workers view: show per-harness readiness, current transport, and the shared resources that each harness can access.
- Footer: show a compact readiness summary, not just helper heartbeat.
- Embedded web surface: host deeper inventory or onboarding flows when the user needs detail.

### Desktop Host Shell

The desktop host app should become the dense control surface for inventory and reconciliation.

- Overview: show the capability catalog summary and onboarding status.
- Machines: render machine-level capability availability and which endpoints are currently reachable.
- Plans: show which tasks depend on unavailable capabilities or missing resources.
- Relay and inter-agent views: show which peers can collaborate now versus later.
- Settings: host credential and environment setup where it is safest to edit them.

### Web Surfaces

The web app should be the shared workspace inspection and onboarding surface.

- Make capability cards queryable and shareable.
- Make shared resources persistent and linkable.
- Show browser contexts, files, and notes as objects with names, owners, scope, and status.
- Prefer a browser-friendly onboarding flow for setup and recovery, especially when the user is remote from the host machine.

### CLI/TUI

The terminal surface should be the fastest path to truth.

- `scout init` should end with a readiness summary, not just file creation.
- `scout doctor` should report missing capabilities, missing credentials, and stale resources.
- `scout list` or an equivalent inventory command should group by harness, status, and shared resource class.
- TUI rows should expose a stable symbol and one short status label, not long prose.

## States And Affordances

Every harness or resource should render through the same state vocabulary:

- `ready`
- `installed`
- `configured`
- `degraded`
- `missing`
- `offline`
- `unsupported`

The shell should prefer a compact pattern:

- icon or glyph
- short label
- one-line detail
- action affordance

Examples:

- `ready` means the harness can be launched and collaborated with now.
- `installed` means the binary exists but configuration is incomplete.
- `degraded` means the capability is present but one or more required resources are stale or unreachable.
- `missing` means the shell can explain how to install it.
- `unsupported` means the surface should hide actions that are not valid for that runtime.

## Readiness Rendering

Readiness is not a single boolean. It should be rendered from a small decision tree:

- transport reachable
- binary installed
- credentials present
- workspace linked
- shared resources accessible
- collaboration enabled

Render the result as both:

- a categorical state for layout and filtering
- a short explanation for the operator

The shell should never force the user to infer why something is unavailable. If a capability is blocked, the UI must say whether the problem is install, config, auth, network, or resource access.

## Shared Resources

Shared resources should appear as a first-class inventory panel in every major surface.

- Browser sessions and persistent contexts
- Shared files and artifacts
- Notes or memory objects that can be reused in prompts
- Future credential or secret handles, if the broker exposes them safely

Each resource row should show:

- name
- class
- scope
- owner
- status
- last used or last updated time

The important distinction is between a resource that exists and a resource that is currently usable by the selected harness.

## Onboarding Surface Design

Onboarding should be a guided path, not a settings hunt.

- Step 1: detect installed harnesses and surface only the ones the machine can plausibly use.
- Step 2: show missing prerequisites inline, grouped by harness.
- Step 3: offer one-click install or open-config actions where possible.
- Step 4: after setup, rerun readiness checks automatically.
- Step 5: deep-link into the first usable workspace, session, or resource.

Good onboarding states:

- "Install available"
- "Configured but not linked"
- "Ready for collaboration"
- "Ready, but shared resources are empty"

Bad onboarding states:

- a blank list
- a generic "something is wrong"
- a settings page with no next action

## Rollout Phases

### Phase 1

- Define the shared capability/readiness vocabulary in the UI layer.
- Render the catalog summary in native and desktop surfaces.
- Add resource inventory views for files and browser contexts only.

### Phase 2

- Add onboarding cards and guided actions for missing prerequisites.
- Wire CLI/TUI status commands to the same readiness summary.
- Add filtering by capability class and readiness state.

### Phase 3

- Add resource-specific actions: open, inspect, reuse, revoke, close.
- Add cross-surface deep links so a resource opened in one surface can be resumed in another.
- Add per-harness capability comparison in the shell.

## Testing And Verification

- Verify every harness state maps to one and only one visible UI state.
- Verify no surface shows an action that the catalog marks as unsupported.
- Verify missing credentials and missing install produce different messages.
- Verify resource inventory counts match broker state after refresh and restart.
- Verify onboarding can be completed from a cold start without opening raw config files.
- Verify each surface degrades cleanly when the broker is unavailable.

## Risks

- Capability sprawl can turn into a long badge list with no decision value.
- If the UI diverges from broker truth, operators will trust the wrong surface.
- If readiness is too coarse, the shell will hide useful partial states.
- If onboarding is too opinionated, it will block advanced setups.
- If shared resources are not typed carefully, the UI will blur transient state and durable state.

## Open Questions

- Which capabilities are truly shell-visible versus only broker-visible?
- Should the catalog distinguish "install", "workspace", and "collaboration" the same way everywhere, or only in surfaces that can act on them?
- Which shared resources are safe to expose in the native shell versus only in the web workspace?
- Do we want one universal readiness state, or separate readiness states for install, auth, collaboration, and resource access?
- What is the smallest onboarding flow that still feels complete on a fresh machine?
