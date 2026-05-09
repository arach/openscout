# Ranger

Ranger is OpenScout's in-app control-plane assistant. It is the direct loop for the human operator inside the web view: a sidecar that can read Scout state, explain what is happening, and move the UI without turning every casual question into an agent message.

Scout works without Ranger. The broker, runtime, addresses, messages, invocations, work items, and agent cards remain the platform primitives. Ranger sits on top of those primitives as an operator surface; Scout remains the canonical writer for durable coordination records.

## Naming

| Name | Meaning |
|---|---|
| `OpenScout` | The product and control plane. |
| `Scout` | The platform, protocol surface, CLI, app, and broker-backed collaboration model. |
| `Ranger` | The in-app assistant/control loop for reading and navigating the Scout control plane. |
| `Mission Control` | The overview surface for humans to inspect state and intervene. |
| `Mission` | A coherent unit of intent that can contain questions, work items, messages, artifacts, and follow-up. |

Avoid treating Ranger as a visible peer in the agent population. Other agents should not need to speak to Ranger for ordinary coordination. They should use Scout broker records and explicit targets.

## Operating Logic

Ranger's default loop is:

1. Read the current Scout state snapshot and current UI route.
2. Decide whether the operator needs a direct answer, UI navigation, refresh, or durable coordination.
3. Answer casual or diagnostic questions directly without creating broker messages.
4. Emit explicit `scout-ui` actions when the app should move.
5. Route durable asks, sends, work items, or mission changes through Scout broker APIs.
6. Summarize state back to the operator with the next owner and concrete next step when ownership exists.

Ranger should ask for clarification only when the missing detail changes execution risk. Otherwise it should make the smallest defensible assumption, state it, and keep moving.

## Model Policy

Ranger is currently OpenAI-backed through the web server's direct assistant endpoint. This keeps the app loop fast and sessionful without requiring Ranger to appear as an agent card.

| Backend | Use For |
|---|---|
| OpenAI Responses API | Default in-app conversation, state reads, UI navigation, and lightweight control-plane interpretation. |
| RPCable Codex profile | Future option when Ranger needs repo-native tools, code edits, long-running inspection, or richer execution context. |
| Scout broker APIs | Durable asks, sends, work items, route resolution, and delivery records. |

The current web implementation uses an in-memory Ranger session store. Operators can start a fresh session when they want a new context. Model selection is configurable through the Ranger settings panel and environment variables.

Ranger can use `OPENAI_API_KEY`, the local Scout relay config, or a user-entered key from Settings > Credentials. Browser-entered keys are stored in Hudson Kit HudVault for the local browser profile and are sent to the local OpenScout server only with Ranger chat requests.

## Coordination Boundary

Ranger may read directly and converse directly. Scout writes the durable coordination truth.

Direct Ranger loop:

- answer "what is going on?"
- inspect current fleet, broker, work, run, session, activity, and mesh state snapshots
- explain local UI state
- navigate the web app
- refresh the app
- run a one-minute brief that walks the operator through relevant views from a TTL-bound snapshot

Scout broker lane:

- send a message
- ask an agent to own work
- create or update a work item
- start or alter a mission
- record delivery, flight, binding, or ownership state

## Adapter Boundary

Future Ranger backends should be treated as runtime profiles behind the same app assistant surface, not as new product nouns.

The stable contract is:

- Scout owns routing, state, and interoperability.
- Ranger owns operator-facing interpretation and app navigation.
- Harness adapters own execution details for Codex, Claude, local shells, rented cloud instances, sandboxes, or clusters.

## Web App Contract

The web app should always offer Ranger as a global operator surface, independent of the current screen. The right inspector hosts the persistent Ranger panel, and top-nav/command-palette actions open that panel or ask for a state readout.

Ranger can also request UI setup by sending a fenced `scout-ui` JSON action in its reply:

````
```scout-ui
{"type":"navigate","route":{"view":"ops","mode":"tail"}}
```
````

Supported actions:

- `navigate` with a whitelisted OpenScout route, such as `{"view":"fleet"}` or `{"view":"ops","mode":"tail"}`.
- `open-ranger` with optional `mode: "ask"` to bring the Ranger DM forward.
- `refresh` to reload web-visible broker state.

This keeps Ranger's UI control explicit and auditable: natural-language replies do not move the app unless they include the structured action block.

## One-Minute Briefs

Ranger can prepare a short control-plane brief for voice or text. The web server gathers a fresh Scout snapshot, asks Ranger for a structured route-and-narration plan, and returns a TTL-bound brief packet. The first implementation uses a two-minute TTL, with a three-minute hard maximum accepted by the API.

The client owns the guided walk. It moves through the brief's safe routes, shows freshness state, and narrates each segment when voice replies are enabled. While one segment is playing, the client pre-renders the next Vox TTS segment so the tour can feel continuous without generating the whole audio track up front.

Briefs remain read-side by default. The final recommendation can expose follow-up chips, but Scout-owned writes still require an explicit operator action.

## Voice Mode

OpenScout voice mode uses Vox:

- browser STT calls Vox Companion's local HTTP bridge at `127.0.0.1:43115`
- web TTS calls the OpenScout server, which talks to Vox's local JSON-RPC runtime and returns playable audio
- if Vox is unavailable, the UI degrades to launch/settings guidance instead of blocking Ranger

The voice path is Ranger-direct: speech is transcribed into the in-app Ranger loop, and optional spoken replies synthesize Ranger's direct response through Vox. Durable agent coordination remains a separate Scout broker action.

Ranger controls spoken-reply speed from the web client. The client sends a `speed` multiplier to the local `/api/voice/speak` endpoint, which forwards it to Vox synthesis.
