# Scoutbot

Scoutbot is OpenScout's conversational assistant identity. Operators address it as `@scoutbot` when routing or mentioning the assistant; friendly chrome may call it Scout, as in "Ask Scout". It is the human-facing loop for asking about the control plane, moving through the UI, and creating explicit Scout coordination when the operator chooses to send, ask, or follow up.

Platform Scout still works without Scoutbot. The broker, runtime, addresses, messages, invocations, work items, deliveries, bindings, and agent cards remain the platform primitives and the broker remains the canonical writer for Scout-owned coordination records. Scoutbot is one operator-facing identity layered on those primitives, not a rename of the platform.

## Naming

| Name | Meaning |
|---|---|
| `OpenScout` | The product and local-first control plane. |
| `Scout` | The platform, protocol surface, CLI, app, and broker-backed collaboration model. Also acceptable as Scoutbot's friendly display name in UI chrome. |
| `@scoutbot` | The routeable conversational assistant handle for web, HUD slot 5, and future iOS surfaces. Use this in mentions, chips, routing, broker logs, and any copy where the handle matters. |
| Scoutbot | The assistant concept behind `@scoutbot`; use this in architecture prose when disambiguating it from platform Scout. |
| `Mission Control` | The overview surface for humans to inspect state and intervene. |
| `Mission` | A coherent unit of intent that can contain questions, work items, messages, artifacts, and follow-up. |

Do not expose Scoutbot's internal execution substrates in product copy. The operator should not need to choose between action, retrieval, and broker-ops personalities. There is one assistant handle: `@scoutbot`.

## Operating Logic

Scoutbot's default loop is:

1. Read the current Scout state snapshot and current UI route.
2. Decide whether the operator needs a direct answer, UI navigation, refresh, or durable coordination.
3. Answer casual or diagnostic questions directly when no durable Scout record is needed.
4. Emit explicit `scout-ui` actions when the app should move.
5. Route durable asks, sends, work items, checkbacks, or mission changes through Scout broker APIs.
6. Summarize state back to the operator with the next owner and concrete next step when ownership exists.

Scoutbot should ask for clarification only when the missing detail changes execution risk. Otherwise it should make the smallest defensible assumption, state it, and keep moving.

## Internal Substrates

Scoutbot presents a single identity while dispatching internally across three substrates:

| Substrate | Internal Role |
|---|---|
| `do` | Action tools that mutate state, such as opening files, spinning agents, setting dock targets, or running commands. |
| `know` | Retrieval and read-only synthesis across code, docs, broker state, and observed transcripts. |
| `chase` | Broker operations, such as checking whether an agent saw a message, nudging a target, or explaining what is owed back to the operator. |

These names are design language only. They should not appear in user-facing copy, command chips, or routing UI.

## Model Policy

Scoutbot is the settled assistant identity; backend wiring is separate implementation work. The intended backend is Codex-backed because Codex is Arach's dominant LLM harness, but the handle should not churn when model choices evolve.

| Backend | Use For |
|---|---|
| Codex-backed Scoutbot service | Planned default for repo-native tools, code/docs inspection, durable follow-through, and richer execution context. |
| Current web assistant endpoint | Transitional in-app conversation, state reads, UI navigation, and lightweight control-plane interpretation while the Codex-backed service is not yet wired. |
| Scout broker APIs | Durable asks, sends, work items, route resolution, checkbacks, and delivery records. |

The current web implementation still has local assistant sessions, settings, reminders, and credential storage. Those implementation details should move from `ranger` naming to `scoutbot` naming as touched, while preserving the platform Scout boundary.

User-entered OpenAI keys, when used by the transitional web path, are saved in the local OpenScout credential store under the control home and mirrored into Hudson Kit HudVault for the current browser profile. Normal chat and brief requests send intent and route context only; the local server attaches the API key when it calls the model provider.

## Coordination Boundary

The old Ranger framing split responsibilities as "Ranger reads, Scout writes durable coordination." That split is retired. Under the new identity, `@scoutbot` may both read directly and initiate Scout-owned writes when the operator asks for a durable coordination action.

Scoutbot-direct behavior:

- answer "what is going on?"
- inspect current fleet, broker, work, run, session, activity, and mesh state snapshots
- explain local UI state
- navigate the web app
- refresh the app
- run a one-minute brief that walks the operator through relevant views from a TTL-bound snapshot
- set local operator reminders such as "remind me in three minutes to check this status"

Scout-owned durable behavior, still written by the broker:

- send a message
- ask an agent to own work
- create or update a work item
- start or alter a mission
- create a broker-owned checkback
- record delivery, flight, binding, or ownership state

The identity is unified; the write boundary is not. Scoutbot can request durable coordination, but the broker remains the canonical writer for Scout-owned records.

## Adapter Boundary

Future Scoutbot backends should be treated as runtime profiles behind the same assistant handle, not as new product nouns.

The stable contract is:

- Scout owns routing, state, and interoperability.
- Scoutbot owns operator-facing interpretation, assistant conversation, and app navigation.
- Harness adapters own execution details for Codex, Claude, local shells, rented cloud instances, sandboxes, or clusters.

## Web App Contract

The web app should always offer Scoutbot as a global operator surface, independent of the current screen. The right inspector hosts the persistent assistant panel, and top-nav/command-palette actions open that panel or ask for a state readout.

Scoutbot can request UI setup by sending a fenced `scout-ui` JSON action in its reply:

````
```scout-ui
{"type":"navigate","route":{"view":"ops","mode":"tail"}}
```
````

Supported actions:

- `navigate` with a whitelisted OpenScout route, such as `{"view":"fleet"}` or `{"view":"ops","mode":"tail"}`.
- `open-scoutbot` with optional `mode: "ask"` to bring the Scoutbot DM forward.
- `refresh` to reload web-visible broker state.
- `reminder` with `body` plus `delayMs`, `delayMinutes`, or `dueAt` to create an operator-side Scoutbot reminder.

This keeps Scoutbot's UI control explicit and auditable: natural-language replies do not move the app unless they include the structured action block.

## One-Minute Briefs

Scoutbot can prepare a short control-plane brief for voice or text. The web server gathers a fresh Scout snapshot, asks Scoutbot for a structured route-and-narration plan, and returns a TTL-bound brief packet. The first implementation uses a two-minute TTL, with a three-minute hard maximum accepted by the API.

The client owns the guided walk. It moves through the brief's safe routes, shows freshness state, and narrates each segment when voice replies are enabled. While one segment is playing, the client pre-renders the next Vox TTS segment so the tour can feel continuous without generating the whole audio track up front.

Briefs remain read-side by default. The final recommendation can expose follow-up chips, but Scout-owned writes still require an explicit operator action.

## Reminder Primitive

Scoutbot has a small local reminder lane for operator check-backs. The client recognizes direct phrases like "remind me in 3 minutes to check lattices status" or "check back in two mins on this status" before they reach the model, so reminders do not require a model request or a Scout agent message.

The web server stores these reminders under the local OpenScout control home and returns them through `/api/scoutbot/reminders`. Due reminders surface in the assistant panel, can be dismissed, and can be used as a quick prompt to ask Scoutbot for the current control-plane status.

This is intentionally not a broker-owned coordination record yet. Future routines that wake agents, create work items, or own follow-up observations should graduate into Scout broker primitives with explicit targets and ownership.

The broker durable-action substrate has a `checkback` kind for that graduation path. A Scout-owned checkback can use the existing local SQLite ledger, leases, attempts, checkpoints, and signals instead of inventing a separate scheduler or importing a workflow engine. The Scoutbot-local reminder lane should stay lightweight until it needs those ownership and retry semantics.

## Voice Mode

OpenScout voice mode uses Vox:

- browser STT calls Vox Companion's local HTTP bridge at `127.0.0.1:43115`
- web TTS calls the OpenScout server, which talks to Vox's local JSON-RPC runtime and returns playable audio
- if Vox is unavailable, the UI degrades to launch/settings guidance instead of blocking Scoutbot

The voice path is Scoutbot-direct: speech is transcribed into the in-app assistant loop, and optional spoken replies synthesize Scoutbot's direct response through Vox. Durable agent coordination remains a separate Scout broker action.

Scoutbot controls spoken-reply speed from the web client. The client sends a `speed` multiplier to the local `/api/voice/speak` endpoint, which forwards it to Vox synthesis.
