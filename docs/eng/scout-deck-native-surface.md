# Scout Deck — distinct bundled surface

**Status:** implemented design foundation and Codex-native controller slice

**Entry:** `packages/web/client/native-surfaces/lanes/index.html`

**iOS bundle:** `apps/ios/Scout/Resources/WebSurfaces/lanes/index.html`

## Product boundary

Scout Deck is a dedicated tablet control surface, not an alternate theme for
the desktop Ops/Lanes route. Native owns pairing, trust, and the privileged
bridge. The bundled React page owns lane selection, live coordination
hierarchy, attention, and the hands-on thread controller.

The surface consumes the existing typed Scout iOS bridge:

- `bootstrap` for device, host, and capability state;
- `agents.list` for the host-scoped lane bank;
- `tail.recent` for the shared five-minute activity signal;
- `native.setLaneSelection` for one explicit selected host and agent route;
- `native.voice.snapshot` and `native.voice.toggleInput` for the app's shared
  on-device dictation controller;
- `native.voice.speak` and `native.voice.stopOutput` for response playback;
- `codex.thread.snapshot` and `codex.thread.connect` for a selected native
  Codex session;
- `codex.turn.start`, `codex.turn.steer`, and `codex.turn.interrupt` for direct
  app-server control.

It does not create a second fleet model or write Scout records directly.

## Design structure

1. A persistent numbered channel bank makes agents addressable by touch.
2. One focused stage gives the selected lane room for identity, route,
   real event cadence, and recent activity.
3. A separate attention rail answers “what needs me?” without competing with
   the active-lane view.
4. A central thread timeline and command strip show operator prompts, model
   reasoning, tool actions, and the active Codex turn.
5. The right controller rail exposes the concrete adapter, thread and turn
   identifiers, connection state, and the actions that adapter actually has.

The visual system follows the SpeakEasy product HUD rather than its marketing
site: three white-alpha text levels, shallow glass elevation, hairline borders,
and chroma reserved for state. The audio waveform was deliberately not copied.
Scout renders a real five-minute event histogram on a wall-clock axis instead.

## SpeakEasy consultation

The SpeakEasy project agent reviewed its HUD, theme, history rows, and Pad work
through Scout ask `ref:b-w07s1k`. The resulting consultation is stored in the
SpeakEasy checkout at `docs/design/openscout-scout-deck-consult.md`.

Material recommendations incorporated here:

- persistent left rail instead of capsule navigation;
- alpha hierarchy and elevation instead of shadow-heavy cards;
- motion and signal shapes must encode real data;
- working state and operator attention use separate visual channels;
- color is reserved for live, attention, failure, and connection state;
- all primary lane information is legible without hover or drill-in.

Visible handoff edges and attention acknowledgement remain follow-up work. The
current bridge contract exposes neither a canonical handoff projection nor an
acknowledgement mutation, so the design does not invent them locally.

## Controller semantics

The first control adapter intentionally goes straight to the Codex app-server
runtime. It does not reuse `BridgeBrokerClient.send`, because that is Scout's
broker message plane rather than Codex `turn/start`. Starting is detached from
the mobile RPC while the app-server event log remains authoritative; the Deck
polls snapshots while visible, so iPad backgrounding cannot strand a long-held
request.

Steer is only enabled for the displayed active `turnId`, and interrupt is only
enabled while the thread is running. Codex exposes one active turn per thread,
so queue is reported as unsupported. The managed runtime currently uses
host-side `approvalPolicy=never`, so approvals are also reported as unsupported
instead of being simulated in the web surface. Non-Codex lanes show their
signal and history but identify the controller as unavailable until an
equivalent native adapter exists.

## Voice loop

Voice is a primary Deck control, not a keyboard accessory. The command strip
has a persistent, high-contrast microphone: tap once to listen, tap again to
finalize, then review or edit the transcript before Start/Steer. Listening,
model preparation, transcription, denial, and idle are distinct visible states.
The live partial transcript comes from Apple Speech; the final prefers the
existing on-device Parakeet/Vox engine when it is warm.

Voice out is armed independently. A newly completed assistant text block can be
read with native system speech, while existing history is marked as already
seen so opening a lane never replays old output. Starting dictation stops current
speech to prevent the iPad from transcribing itself. The pulsing microphone ring
only represents capture state; it is intentionally not presented as a real
amplitude meter.

## Preview and offline states

During native-surface development:

```text
/lanes/index.html?preview=1  populated design fixture
/lanes/index.html?preview=1&voice=listening  active dictation fixture
/lanes/index.html?offline=1  bundled page without a native bridge
```

Production builds never synthesize fixture lanes. Without the iOS bridge they
render the complete standing-by shell and wait for a paired host.

## Artifacts

- `docs/eng/artifacts/scout-deck-control-surface/deck-native-ipad-landscape.png`
- `docs/eng/artifacts/scout-deck-control-surface/deck-native-ipad-offline.png`
- `docs/eng/artifacts/scout-deck-control-surface/deck-codex-controller-ipad-landscape.png`
- `docs/eng/artifacts/scout-deck-control-surface/deck-voice-idle-ipad-landscape.png`
- `docs/eng/artifacts/scout-deck-control-surface/deck-voice-listening-ipad-landscape.png`

## Verification

```text
bun run --cwd packages/web build:native-surfaces
bun run --cwd packages/web check:native-surfaces
```

The generated seven-file iOS bundle validates against its manifest and hashes.
The surface was reviewed at 1194×834 and 834×1112 with no horizontal overflow
or browser console errors.
