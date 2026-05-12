# Voice FX Handoff

Brief for a fresh Codex session that's extracting this work into Vox, or installing it in Talkie. Self-contained — you don't need to read the conversation that produced it.

## What this is

A small, dependency-free Web Audio FX layer that turns plain TTS output into a "dispatcher / walkie-talkie / radio" voice. Prototyped inside OpenScout (Ranger), tuned with a live lab page, now ready to move into voice infrastructure.

## Goal

- **Extract** the FX engine into the Vox ecosystem (the JS SDK, not the runtime — the work is strictly client-side Web Audio).
- **Reuse** the engine across Ranger, Talkie, and any future voice consumer.
- **Keep** configuration UI separate from the engine. Engine lives in Vox; the operator-facing "voice mood" picker lives in OpenScout (and Talkie ships its own).

## Repo split after this work

| Repo / package | Owns |
|---|---|
| `@voxd/fx` (new — in Vox repo) | Audio graph, preset library, param types, defaults. Headless, framework-agnostic. Zero npm dependencies. |
| OpenScout | The operator-facing config panel (Settings > Voice). Persists chosen preset. Ranger reads the saved preset at speak-time. The `/dev/ranger-fx` lab page stays as the dev/tuning surface. |
| Talkie | Its own voice-mood picker (walkie-flavored), built on top of `@voxd/fx`. |

## Source to extract

Single file. No transitive imports from anywhere Ranger-specific.

- **Source:** `packages/web/client/lib/ranger-fx.ts` in the OpenScout repo.
- **Target:** new package in the Vox repo — suggested `packages/fx/` published as `@voxd/fx`, or as a module of `@voxd/client` exposed at `@voxd/client/fx`. Either is fine; the SDK author can pick.

The file has zero runtime dependencies (uses only `window.AudioContext` and `fetch`). It exports a small audio-graph API plus a preset library.

## Rename pass

This is the only intentional change during the move. The public API is currently named `Ranger*`; rename to `Voice*` so it belongs to Vox semantically:

| Before | After |
|---|---|
| `RangerFxParams` | `VoiceFxParams` |
| `RangerFxPreset` | `VoiceFxPreset` |
| `RangerFxHandle` | `VoiceFxHandle` |
| `RangerFxPlayOptions` | `VoiceFxPlayOptions` |
| `DEFAULT_RANGER_FX` | `DEFAULT_VOICE_FX` |
| `RANGER_FX_PRESETS` | `VOICE_FX_PRESETS` |
| `playWithRangerFx(...)` | `playWithVoiceFx(...)` |
| `playDry(...)` | `playDry(...)` (unchanged) |
| `decodeAudioFromBase64/Url/ArrayBuffer(...)` | unchanged |

**Do not rename the preset labels or descriptions** — they're meant to feel like personalities, not gear specs, and the names are part of the product feel. ("Chill Dispatcher", "Tower Control", "Carrier Wave", "Pocket Walkie", "Trail Buddy", "AM Broadcast", "Clean Mic".)

## Public API after rename

```ts
// Types
export type VoiceFxParams = { /* see source for fields */ };
export type VoiceFxPreset = {
  id: string;
  label: string;
  family: "dispatch" | "walkie" | "other";
  description: string;
  params: VoiceFxParams;
};
export type VoiceFxHandle = { promise: Promise<void>; stop: () => void };
export type VoiceFxPlayOptions = {
  params?: Partial<VoiceFxParams>;
  signal?: AbortSignal;
  onEnded?: () => void;
};

// Constants
export const DEFAULT_VOICE_FX: VoiceFxParams;
export const VOICE_FX_PRESETS: VoiceFxPreset[]; // 7 entries, see below

// Decode helpers (browser-only)
export function decodeAudioFromBase64(base64: string, contentType?: string): Promise<AudioBuffer>;
export function decodeAudioFromArrayBuffer(buffer: ArrayBuffer, contentType?: string): Promise<AudioBuffer>;
export function decodeAudioFromUrl(url: string): Promise<AudioBuffer>;

// Playback
export function playWithVoiceFx(buffer: AudioBuffer, options?: VoiceFxPlayOptions): VoiceFxHandle;
export function playDry(buffer: AudioBuffer, options?: { signal?: AbortSignal; onEnded?: () => void }): VoiceFxHandle;
```

## The audio graph (what `playWithVoiceFx` does)

```
voice source (AudioBufferSourceNode, playbackRate applied)
   ├─→ highpass (low cut) → lowpass (high cut)
   │       → tanh waveshaper (saturation)
   │       → stepped waveshaper (bit-crush)
   │       → DynamicsCompressor
   │       → wetGain ─┐
   │                  │
   └─→ dryGain ───────┤
                      ↓
                  outputGain → destination

(parallel) hiss source (looped pink-ish noise)
            → highpass (hiss brightness)
            → hissLevel gain (with start/end ramps)
            → wetGain (joins wet bus)

(scheduled) "kerchunk" PTT click buffers (synthesized noise envelope)
            → outputGain at transmission start + end
```

All buffers are synthesized at runtime — no asset files. Curves for saturation/bit-crush are recomputed per playback from the current params (cheap; ~6 KB of Float32 each).

## Preset library (verbatim from current source)

Seven presets across three families. All preset bodies are complete `VoiceFxParams`. Switching a preset is a clean replace, never a partial merge.

### Dispatch family (big-room mission-control energy)

- **Chill Dispatcher** — Warm, friendly, takes its time. The calmest voice on the channel.
- **Tower Control** — Crisp, clipped, all-business. Pushes you out the door a little faster.
- **Carrier Wave** — Always-on hiss like someone's holding the mic just to keep you company.

### Walkie family (pocket-size, close-range, snappy) — **this is what Talkie will ship**

- **Pocket Walkie** — That nostalgic kid-radio crunch. Narrow, snappy, just-this-side-of-toy.
- **Trail Buddy** — Breezy handheld vibe — wider, hissier, like your hiking partner two ridges over.

### Other (character / reference)

- **AM Broadcast** — Vintage lo-fi, no PTT click. The voice on a radio left on in the next room.
- **Clean Mic** — Almost no FX — just a tiny click. A/B reference for everything else.

For exact numeric values, copy `RANGER_FX_PRESETS` from the source file verbatim and rename. **Do not retune these values from scratch** — they're the result of a deliberate session of A/B listening; re-deriving them costs time and will drift.

## Tuning rationale (the "why" behind the knobs)

So you can intelligently adjust if a consumer asks for tweaks:

- **Band-pass (low cut + high cut + Q)** — the "speaker" tone. Dispatchers sit ~350–2800 Hz; walkies are narrower (~600–2300 Hz). Higher Q makes the band feel peakier / more "comm-radio".
- **Saturation (tanh waveshaper)** — adds grit and makes the compressor sound "pushed". 0.0–0.2 is gentle; 0.5+ is overt.
- **Bit-crush (stepped waveshaper)** — amplitude quantization. Adds AM-radio crunch. 0.15+ starts to sound digitally lo-fi; 0.5 is "vintage walkie".
- **Hiss (looped pink-ish noise + highpass + ramped gain)** — the open-mic carrier sound. Low values (0.03–0.07) suggest a quiet channel; 0.1+ feels like an always-on carrier. The hiss high-pass tunes brightness: lower = breathier, higher = thinner/whisper-y.
- **Compressor** — tightens dynamics so the voice has the "pushed through a comm" feel. Aggressive ratios (6:1+) with low threshold (-26 dB+) read as comm-grade.
- **Kerchunk click** — synthesized PTT relay sound at transmission start + end. The click sells the "this is a radio transmission" frame more than any single tonal choice.
- **Playback rate** — pacing. <1.0 = drawl/chill; >1.0 = urgent. Naive implementation: also shifts pitch. The band-pass masks small shifts (~±10%) reasonably well. For dramatic speed changes without pitch shift, re-synthesize via Vox with the same value passed as `speed` instead.

## Integration recipe (for Talkie or any consumer)

The engine is post-decode. A consumer just needs to:

1. Get an `AudioBuffer` from somewhere (Vox synthesis returns base64 WAV — decode it).
2. Pick a preset (or build custom params).
3. Call `playWithVoiceFx(buffer, { params })`.

Concrete replacement for a typical "play TTS through the speakers" path:

```ts
// Before (dry playback):
const audio = new Audio(`data:${contentType};base64,${base64}`);
await audio.play();

// After (FX playback):
import { decodeAudioFromBase64, playWithVoiceFx, VOICE_FX_PRESETS } from "@voxd/fx";

const buffer = await decodeAudioFromBase64(base64, contentType);
const preset = VOICE_FX_PRESETS.find((p) => p.id === "pocket-walkie")!;
const handle = playWithVoiceFx(buffer, { params: preset.params });
await handle.promise;
```

For a consumer with a saved user preference (e.g. OpenScout's Settings > Voice picker), the preset id is the only thing you persist.

## Smoke test after extraction

The OpenScout repo has a working dev lab that's currently the canonical consumer:

- Lab page: `packages/web/client/dev/RangerFxLab.tsx` (served at `/dev/ranger-fx`)
- Fixture generator: `packages/web/scripts/generate-ranger-fx-fixtures.mjs`

To verify the extraction:

1. In OpenScout, swap the import from `../lib/ranger-fx.ts` to `@voxd/fx`.
2. Update the imported names to the renamed exports.
3. Re-run the fixture generator (Vox must be running locally), reload `/dev/ranger-fx`, and confirm Play with FX still works for all 7 presets and the loop + vary-speed toggles still behave.

If the lab page works end-to-end, the extraction is correct.

## What's NOT in this handoff

- **Hudson Kit migration** for Talkie — separate concern, not audio-related.
- **Talkie's ASR migration** (fluid audio → Vox live sessions) — parallel work, independent of FX.
- **Server-side FX rendering in Vox runtime** — currently strictly browser/Web-Audio. If a non-browser consumer ever needs FX baked into the WAV (native apps, recording-to-file), that's a future Vox runtime feature (DSP in Rust/Swift, or shell out to ffmpeg/sox). Not blocking anything today.
- **Pitch-preserving time-stretch** — current Speed knob also shifts pitch. Acceptable for now (band-pass masks small shifts). A real fix would be an AudioWorklet phase-vocoder or pulling in `soundtouchjs`. v2 concern.

## Suggested sequencing

Three roughly-parallel tracks; only the FX-install step in Talkie has a hard ordering constraint.

1. **Fresh Codex session in the Vox repo**: extract `@voxd/fx`. ← run first
2. **In OpenScout (this repo)**: swap Ranger's import path; promote the lab's preset picker into `SettingsDrawer > Voice` for end users. Can start after (1) lands.
3. **Fresh Codex session in the Talkie repo**: install `@voxd/fx`, migrate TTS path from fluid audio to Vox, splice FX into the new playback path, build walkie-flavored voice-mood picker. Hudson Kit and ASR migration are separate tracks within Talkie.

## Open questions for whoever picks this up

- **Package name**: `@voxd/fx` (new package) vs. `@voxd/client/fx` (module of existing SDK)? Either works; SDK author's call.
- **Native Talkie**: if Talkie has a native client (macOS/iOS), does it need FX too? If yes, that's the prompt to plan server-side rendering in Vox. If web-only, the JS package is enough.
- **Preset persistence shape**: OpenScout's Settings > Voice should store the preset id under user prefs. Schema TBD with whoever wires that.
