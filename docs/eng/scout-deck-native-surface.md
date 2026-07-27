# Scout Deck — distinct bundled surface

**Status:** implemented design foundation

**Entry:** `packages/web/client/native-surfaces/lanes/index.html`

**iOS bundle:** `apps/ios/Scout/Resources/WebSurfaces/lanes/index.html`

## Product boundary

Scout Deck is a dedicated tablet control surface, not an alternate theme for
the desktop Ops/Lanes route. Native owns fleet selection, trust, and the future
composer. The bundled React page owns lane selection, live coordination
hierarchy, attention, and the dense ambient view.

The surface consumes the existing typed Scout iOS bridge:

- `bootstrap` for device, host, and capability state;
- `agents.list` for the host-scoped lane bank;
- `tail.recent` for the shared five-minute activity signal;
- `native.setLaneSelection` for one explicit selected host and agent route.

It does not create a second fleet model or write Scout records directly.

## Design structure

1. A persistent numbered channel bank makes agents addressable by touch.
2. One focused stage gives the selected lane room for identity, route,
   real event cadence, and recent activity.
3. A separate attention rail answers “what needs me?” without competing with
   the active-lane view.
4. A selected-target footer hands one explicit route to the future native
   composer.

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

## Preview and offline states

During native-surface development:

```text
/lanes/index.html?preview=1  populated design fixture
/lanes/index.html?offline=1  bundled page without a native bridge
```

Production builds never synthesize fixture lanes. Without the iOS bridge they
render the complete standing-by shell and wait for a paired host.

## Artifacts

- `docs/eng/artifacts/scout-deck-control-surface/deck-native-ipad-landscape.png`
- `docs/eng/artifacts/scout-deck-control-surface/deck-native-ipad-offline.png`

## Verification

```text
bun run --cwd packages/web build:native-surfaces
bun run --cwd packages/web check:native-surfaces
```

The generated seven-file iOS bundle validates against its manifest and hashes.
The surface was reviewed at 1194×834 and 834×1112 with no horizontal overflow
or browser console errors.
