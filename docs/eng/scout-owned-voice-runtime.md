# Scout-owned voice runtime

Status: direction note, not a plan of record. Written 2026-08-04 after a
"Could not connect to Vox on port 42137" error surfaced in the web composer.

## The trigger

Vox's daemon has been down on this machine since 2026-07-23 (`~/.vox/logs/voxd.stderr.log`
ends with `Listener cancelled`). Every web voice feature fails at connect, and the raw
daemon error reaches the UI. The port was never wrong — the process simply wasn't there.

That is the actual complaint: web voice depends on a separate app being launched and
configured by the operator, and Scout has no say in whether it is.

## Where we are today

Two processes, both Vox's, both discovered rather than owned:

| Path | Transport | Port | Our caller |
| --- | --- | --- | --- |
| TTS + model/voice catalog | WebSocket | 42137 | `packages/web/server/vox.ts` (raw `WebSocket`) |
| ASR / transcription | HTTP | 43115 | `packages/web/server/scout-voice.ts:44` via `@voxd/client` |

Both are Vox's own port definitions, not ours — `swift/Sources/VoxCore/RuntimePaths.swift`
in `arach/vox` declares `VoxPorts.daemon` (`companion-ws`, `VOX_PORT`, 42137, written to
`runtime.json`) and `VoxPorts.bridge` (`companion-http`, `VOX_BRIDGE_PORT`, 43115).

We resolve the port by reading Vox's handshake file: `resolveVoxRpcPort()` at
`packages/web/server/vox.ts:252` checks `$VOX_RUNTIME_PATH` / `~/.vox/runtime.json`,
then `$VOX_PORT`, then the 42137 default. We also register ourselves as a guest in Vox's
config via `ensureOpenScoutVoxOrigins()` (`vox.ts:227`), which writes into
`~/.vox/origins.d/openscout.json`.

Hudson does the same thing, one layer further out: `apps/web/app/lib/hudsonVoiceRuntime.ts`
reads `~/Library/Application Support/Hudson/Vox/hudson-voice-runtime.json` for host, port,
`webSocketUrl`, `authToken`, and `pid`, and its TTS wrapper
(`apps/web/app/lib/tts/voxBridge.ts`) is hard-typed to a single provider,
`HUDSON_VOX_DEFAULT_PROVIDER = 'vox'`. There is nothing to adopt there — it is a thinner
version of what we already have.

## What Vox actually exposes

Checked against a read-only clone at `~/dev/ext/vox`. `Package.swift` declares:

```
.library(name: "VoxCore",             targets: ["VoxCore"])
.library(name: "VoxEngine",           targets: ["VoxEngine"])
.library(name: "HudsonSpeechEngine",  targets: ["HudsonSpeechEngine"])
.library(name: "VoxService",          targets: ["VoxService"])
.library(name: "VoxBridge",           targets: ["VoxBridge"])
.executable(name: "voxbridge" | "voxttsd" | "voxd")
```

This is the fork in the road, and it resolves in our favour: **the engine is already a
SwiftPM library, no upstream extraction needed.** `voxd` is not a monolith — it is
`VoxCore + HudsonSpeechEngine + VoxService` wired together in ~an executable target.

The socket gateway itself is library code: `swift/Sources/VoxService/ServiceBridge.swift`
is what logs `ServiceBridge listening on ws://127.0.0.1:42137`, alongside
`LiveSessionCoordinator`, `SynthesisSessionCoordinator`, `VoxRuntimeService`, and
`WarmupCoordinator`. `VoxBridge` carries `HTTPBridgeServer`, `OriginAllowlist`, and
`DaemonProxy`.

Note also that `HudsonSpeechEngine` lives in the Vox repo, not the Hudson one — so
Hudson's speech engine and Vox's are the same code.

## We have done this before — three times

This would not be a new direction. It would be finishing one:

1. **`09f35d74` (2026-07-01) — "Add voice session controls and broker diagnostics."**
   Native Scout voice host: the macOS menu app registers as a dictation host and Scout
   drives the session. Survives today as the `hudson-dictation` adapter in
   `packages/web/server/scout-voice-session.ts:499`.
2. **`44a1a423` (#469) — "Ship resilient realtime voice navigation and audit controls."**
   Added `packages/web/server/openai-speech.ts`, a direct-to-OpenAI path with no local
   process at all, and added the comment in `apps/macos/Package.swift:72`: *"Speech
   synthesis runs in-process through HudsonVoice, so spoken replies don't depend on a
   separate daemon."*
3. **`8b1c07cf` (2026-07-25) — "Align Scout speech with Hudson TTS API."**
   Linked `HudsonUIAudio` alongside `HudsonVoice` into `ScoutAppCore`.

The macOS app therefore already runs the intended architecture: Vox/Hudson speech code
linked in-process, Scout-owned, no daemon. Only the web server still reaches out to a
process it does not control. Each prior move took one surface at a time and left the
previous integration in place, which is why the code carries layered vestiges
(`ensureOpenScoutVoxOrigins`, the `hudson-dictation` adapter, the `@voxd/client` HTTP
path, and the raw WS in `vox.ts` all coexist).

## The constraint that decides this

Operator direction, 2026-08-04: **exactly one user-visible non-web dependency — the Scout
menu/helper.** Anything else local is either inside that app or does not exist. A Vox
daemon is a violation by definition, whoever launches it. Independent API calls (OpenAI
TTS and friends) are fine, because they add no local process.

That principle is already half-built, and predates this conversation:

- `apps/macos/Sources/ScoutAppCore/ScoutSpeechCredentials.swift` keeps Scout's own speech
  keys in the login Keychain under `app.openscout.scout.speech`, for providers
  `system` / `openai` / `elevenlabs`. Its comment states the architecture outright:
  *"The synthesis engine is in-process, so the key has to be here rather than on a
  server."*
- Web has the mirror: `openai-speech.ts` plus `resolveOpenAIApiKey` threaded from Scoutbot
  (`routes/scoutbot.ts:736` → `create-openscout-web-server.ts:8078` →
  `routes/voice.ts:477`).

So the direct-API path exists on both sides. What is wrong is the *precedence*: today
direct-to-OpenAI is the fallback that fires only after the Vox daemon fails. Under this
principle it is the default, and any local engine is an accelerant.

Sorting the paths by what genuinely needs local compute:

| Path | Needs a local process? | Where it belongs |
| --- | --- | --- |
| Cloud TTS (OpenAI, ElevenLabs) | No | Direct HTTPS from whoever needs it |
| On-device TTS (AVSpeech) | Yes, in-process | Already in-process in the macOS app |
| On-device ASR (Parakeet TDT) | Yes — model weights + compute | Inside the Scout menu app, linked like Lattices links `VoxService` |
| Cloud ASR / transcription | No | Direct API — **not built today**; web ASR only knows `:43115` |

Only one row argues for a local runtime at all, and under the principle it lives inside
the menu app rather than beside it.

This is also where we should not simply copy Lattices. Lattices self-hosts the runtime,
which satisfies "not someone else's daemon" but still makes a socket the prerequisite for
voice working. The stricter reading for Scout: direct API is the default path, the
in-menu engine is optional, and **the web server must never hard-depend on the menu being
up**. Today's error is exactly what hard-dependence looks like.

Cleanup that follows directly from the principle: `ensureOpenScoutVoxOrigins()`
(`vox.ts:227`) writes `~/.vox/origins.d/openscout.json` — Scout registering itself as a
guest in another app's config. That should be deleted outright, not ported.

## Prior art: Lattices already did this

`~/dev/lattices` shipped exactly the proposed architecture in late July 2026. It is not a
sketch — it builds, and the reasoning is written into the source.

`apps/mac/Package.swift:16-34` takes Vox as a real SwiftPM dependency and links the
service library:

```swift
// Vox is already a HudsonVoice transitive dep; Lattices also links VoxService
let voxSource = Context.environment["LATTICES_VOX_SOURCE"] ?? Context.environment["HUDSON_VOX_PATH"]
… .package(url: "https://github.com/arach/vox.git", branch: "main")
latticesDependencies.append(.product(name: "VoxService", package: "vox"))
```

…gated behind a `LATTICES_VOICE` compile flag, with a local-path override for
development.

`apps/mac/Sources/Core/Voice/LatticesVoiceRuntime.swift` then runs the gateway itself —
its own doc comment describes "an in-process Vox live-session server on a **deterministic**
loopback port", which writes a private capability file and is torn down on quit. It sets
`VOX_PORT` / `LATTICES_VOICE_PORT` in its own environment and points HudsonVoice's
capability reader at the Lattices file "not Hudson Menu's".

`apps/mac/Sources/Core/Voice/VoxEndpointResolver.swift` carries the punchline for us:

> Prefer Lattices' deterministic port over the old external voxd default so we do not
> silently talk to a dead/unrelated process.

> Last resort: Lattices' well-known port (self-hosted), not external 42137.

That is the failure we hit today, already named and already fixed — in a sibling app.
Whatever we do here should start by reading that implementation rather than
re-deriving it.

Relevant session context: `codex/lattices` 2026-07-29..31 (rollout
`019fb0d7-4e78-7982-9b20-79a77fccdc1d`), reachable via
`scout search query "VoxEndpointResolver Hudson boundary" --hours 720`.

## Proposed shape

Keep the socket gateway. Change who owns the process on the far end.

- A Scout-owned voice service executable that links `VoxService` (and
  `HudsonSpeechEngine`) rather than shelling out to `voxd`.
- Scout lifecycle: started and supervised by Scout, not by the operator opening an app.
- Scout handshake: our own runtime/capability file under Scout's control plane, not
  `~/.vox/runtime.json`, and no writing into `~/.vox/origins.d/`.
- `packages/web/server/vox.ts` collapses into a thin client of our own service, and Vox
  provenance stops leaking into our types, config paths, and error strings.

`openai-speech.ts` stays as the no-local-process fallback. It is the only web path today
that depends on nothing running locally.

Concretely, the Lattices shape ports across almost verbatim: a `SCOUT_VOICE`-gated
`.package(url: "https://github.com/arach/vox.git")` + `.product(name: "VoxService")` in
`apps/macos/Package.swift`, a `ScoutVoiceRuntime` host owning the port and capability
file, and a resolver that prefers Scout's own runtime over external 42137.

## Open questions

- The web server is Bun, not Swift. Does it talk to the Scout-hosted runtime over the
  same loopback socket (Lattices' model, and the smallest change), or does the macOS app
  proxy for it? On a machine with no Scout.app running, what serves web voice —
  `openai-speech.ts` only?
- Does linking `VoxService` pull in model assets (Parakeet TDT) that need their own
  download/warm lifecycle, and who owns that in Scout?
- One service for both transports, or keep the WS/HTTP split Vox already draws between
  `VoxService` and `VoxBridge`?
- Version/vendoring policy: pin `arach/vox` by revision like we do `hudson`, or vendor?
- What happens to the `hudson-dictation` host adapter — folded in, or retired?

## Do regardless

`packages/web/server/routes/voice.ts:496` returns the raw Vox error with a 503 when no
OpenAI key resolves. That is the only uncovered exit — the speech catalog
(`scout-voice.ts:110`) and `/api/voice/speak` (`routes/voice.ts:461`) already treat Vox
as optional. It should degrade to a clean "voice host offline" state instead of leaking a
daemon connect string into the composer.
