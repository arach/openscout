# Synthetic live voice — architecture review

Review of replacing OpenAI Realtime with a Scout-owned STT → reasoning → TTS pipeline
while keeping one long-running hands-free audio connection.

Status: architecture review only. No code changed.
Reviewer: `session-msggmrfz-2tz707` · requested by `openscout-agent-2.codex-delivery-campaign-source`

---

## 1. What exists today

The current "realtime voice" is **not** a media pipeline we own. It is an SDP proxy plus a
concurrency lease. Media never touches our process.

| Concern | Where | Shape |
| --- | --- | --- |
| Browser peer + mic | `packages/web/client/lib/realtime-voice.ts:50` | `RTCPeerConnection`, `getUserMedia` with AEC/NS/AGC (`:538`), device-label matching (`:605`) |
| Control channel | `client/lib/realtime-voice.ts:163` | datachannel `oai-events`, browser ↔ **OpenAI** directly |
| SDP proxy | `server/routes/voice.ts:507` → `server/realtime-voice.ts:294` | one-shot POST to `api.openai.com/v1/realtime/calls`, returns answer SDP |
| Admission | `server/realtime-voice.ts:85` | SQLite leases, 1 concurrent call, 4 starts/min, 90s TTL, heartbeat `routes/voice.ts:555` |
| Turn detection | `shared/realtime-voice.ts:8` | `server_vad` **at OpenAI**: threshold 0.5/0.6, 300ms prefix, 500ms silence, `interrupt_response: true` |
| Reasoning | `client/lib/realtime-voice.ts:315` → `server/routes/scoutbot.ts:951` | browser fulfils the `ask_scoutbot` tool call by POSTing our own API |
| UI actions | `client/scout/scoutbot/ScoutbotRealtimeVoiceContext.tsx:182` | client parses fences, applies navigation, sends agent asks |

Separately, a **complete non-realtime voice stack already exists** and is the reuse surface:

- STT: `server/scout-voice.ts:50` → voxd at `:43115` (Parakeet/Apple), blob-in → text + word timings + RTF metrics.
- TTS: `server/scout-voice.ts:78` → Vox daemon, with a direct OpenAI fallback at `server/openai-speech.ts:40`.
- Reasoning: `server/scoutbot-assistant.ts` — `gpt-4.1-mini` (`:230`), single Responses call over a pre-built
  fleet snapshot, 60s timeout (`:650`), **non-streaming**.
- A session/event rail with partials: `server/scout-voice-session.ts:1` (`session.partial|final|error|cancelled`)
  and an SSE endpoint at `routes/voice.ts:325`.

### The thing that is easy to underestimate

OpenAI Realtime is doing **four** jobs, not one. Only two are obvious:

1. TTS (obvious)
2. ASR (obvious)
3. **Turn management** — VAD, endpointing, barge-in, and truncating its own history to what was
   actually heard.
4. **The cheap conversational shell** — greetings, backchannel, "let me check", disfluency handling.
   Note `server/realtime-voice.ts:25`: *"You may handle a simple greeting directly, but use
   ask_scoutbot whenever the operator asks for work."* That instruction is load-bearing. It keeps
   trivial turns off the expensive Scoutbot path.

A naive replacement (VAD → STT → `/api/scoutbot/chat` → TTS) regresses hard: every "uh, hang on"
pays a fleet-snapshot build plus a 1.5–5s `gpt-4.1-mini` round trip. **The deliverable is a voice
orchestrator, not a codec chain.**

---

## 2. Recommendation: terminate WebRTC in our own process, in a Node media sidecar

**Not a media gateway.** LiveKit/mediasoup/Janus exist to solve SFU fan-out, TURN relaying, and
multi-party mixing. We have exactly one operator, one peer, and a loopback-or-LAN topology. A
gateway would add a fifth daemon to a local-first app that already runs broker + relay + voxd + Vox.

**Not in the Bun server process either.** The mature server WebRTC stacks with a first-class audio
sample API (`@roamhq/wrtc`, giving `RTCAudioSink`/`RTCAudioSource` at 48k/s16 with Opus handled
inside) are Node-ABI native addons. Bun's N-API support is good but not a place to bet the feature.
Additionally, resampling + VAD + Opus is steady CPU work that should not share an event loop with
the control plane.

We already have this exact pattern: `server/terminal-relay-node.ts` is built `--target=node`
(`packages/web/package.json:23`) and spawned as a supervised sidecar with parent-watch and port
reconciliation (`server/managed-terminal-relay.ts:151`). **Copy that lifecycle wholesale.**

```
browser (RTCPeerConnection, getUserMedia AEC)
   │  Opus 48k mono   ─────────────────────────────┐
   │  datachannel "scout-voice" (JSON control)     │
   ▼                                               ▼
 openscout-voice-media  (Node sidecar, loopback only)
   ├─ RTCAudioSink → 48k s16 → resample 16k → VAD/segmenter
   ├─ utterance → STT client ──────────► voxd :43115  (existing)
   ├─ turn orchestrator (shell vs deep) ┐
   └─ TTS chunks → 24k → 48k → RTCAudioSource
                                        │ loopback HTTP/WS
                                        ▼
                          Bun web server :43120 (control plane)
                            ├─ /api/scoutbot/chat  (existing, needs a streaming twin)
                            ├─ /api/voice/speak    (existing, needs streaming + PCM)
                            └─ realtime voice lease (existing, reused verbatim)
```

**One condition that flips this answer:** voice from iOS over the pairing relay rather than the LAN.
That needs TURN or a relayed transport, at which point a gateway earns its keep. Scope this review's
recommendation to the browser/WKWebView host and revisit before any iOS voice commitment.

### Derisk with a transport seam

Define `VoiceTransport { onAudioFrame, sendAudioFrame, onControl, sendControl, close }` and
implement **WebRTC first, WebSocket+Opus second**. On loopback, WebRTC's real value (NAT traversal,
congestion control) is close to zero; its real value here is the browser's echo-cancellation
reference path. If the P0 spike shows AEC holds when TTS plays through WebAudio on a plain
WebSocket, the whole native-addon dependency can be deleted. That measurement is worth three days.

---

## 3. Protocols

### Audio
- Ingress: Opus 48k mono (browser default) → `RTCAudioSink` 10ms s16 frames → linear resample to
  16k mono for VAD and STT.
- Egress: TTS PCM (OpenAI `/v1/audio/speech` supports `response_format: "pcm"` at 24k — currently
  hardcoded to `wav` and fully buffered at `server/openai-speech.ts:66,84`) → resample 48k →
  `RTCAudioSource.onData` paced at exactly 10ms wall-clock.

### Control (datachannel `scout-voice`, JSON, replaces `oai-events`)

Server → client:
`session.ready` · `input.speech_started` · `input.speech_stopped` · `input.transcript.partial`
· `input.transcript.final` · `response.started {responseId}` · `response.text.delta`
· `response.audio.started` · `response.cancelled {responseId, spokenMs}` · `response.done`
· `tool.started` / `tool.done` (feeds the existing trace UI) · `scoutbot.reply {body}` · `error`

Client → server:
`session.update {inputProfile, voiceId, modelId}` · `input.mute` · `response.cancel {responseId}`
· `text.send {body}` · `ping`

**Keep UI actions client-side.** The server will now call Scoutbot itself, so it must forward the
**raw reply body including fences** as `scoutbot.reply`, and the client keeps
`extractScoutbotUiActions` / `applyScoutbotUiAction` / `sendScoutbotAsk` unchanged
(`ScoutbotRealtimeVoiceContext.tsx:182`). TTS speaks `stripScoutbotUiFences(body)`. This preserves
the macOS native-host bridge (`isScoutNativeUiActionHost`) for free and keeps the diff in that
context file near zero — the `onTrace`/`onScoutbotReply`/`onState` callback shapes all survive.

---

## 4. Lifecycle

**Connect.** Client offers → `POST /api/voice/realtime/call` (same path, same lease header) → Bun
forwards the offer to the sidecar over loopback → sidecar answers → lease returned in the existing
`x-openscout-realtime-voice-lease` header. Existing heartbeat/release (`routes/voice.ts:555,569`)
and the client's 25s heartbeat (`client/lib/realtime-voice.ts:282`) work unchanged.

**Turn.** `speech_started` → buffer with 300ms pre-roll → 500ms trailing silence → `speech_stopped`
→ STT → orchestrator classifies shell vs deep → text deltas → sentence-chunked TTS → paced playout.

**Barge-in.** `speech_started` while audio is playing must, in this order: bump the response
generation counter, abort the in-flight TTS fetch, drop the pacer queue, emit `response.cancelled`
with `spokenMs`, and **truncate assistant history to what was actually emitted**. That last step is
the one teams skip; without it the model believes it said a paragraph the operator never heard, and
the next turn is incoherent. OpenAI Realtime does this as `conversation.item.truncate`.

**Reconnect.** Prefer ICE restart over a new PeerConnection so conversation state survives; keep the
lease alive across the restart (its 90s TTL already covers a restart window). Fall back to a fresh
PC with a `resumeSessionId` on the control channel. Today `onconnectionstatechange` just tears down
(`client/lib/realtime-voice.ts:147`) — that becomes a reconnect trigger with backoff.

**Teardown.** Every exit must release: media tracks, `<audio>`, PC, sidecar session, in-flight STT
and TTS aborts, pacer timer, and the lease. The existing `stop()` (`:98`) already sequences most of
this and is a good template; add sidecar-side session GC on datachannel close plus an idle reaper,
mirroring the relay-leak fix pattern.

---

## 5. Reuse map

| Reuse as-is | Extend | Build new |
| --- | --- | --- |
| Lease/admission (`server/realtime-voice.ts:85`) | `/api/voice/speak` → streaming + PCM + abort | Media sidecar + supervision |
| Lease HTTP routes + client heartbeat | `openai-speech.ts` → `response_format: "pcm"`, stream body | VAD/segmenter |
| Voice-settings + device-name resolution (`:605`) | `scoutbot-assistant` → streaming Responses variant | Turn orchestrator (shell/deep split, fillers) |
| `transcribeScoutVoiceAudio` (voxd) | Trace events → datachannel control events | Playout pacer + barge-in/truncate |
| UI-action + ask-agent client path | Near/far-field profile → our VAD params | Cost/latency metering |
| `SCOUT_REALTIME_VOICE_FLAG` gating | Sidecar lifecycle from `managed-terminal-relay.ts` | Reconnect/ICE restart |

**voxd boundary finding:** its `createLiveSession()` (`@voxd/client/dist/client.d.ts`) is
**mic-owning** — it captures on the host and streams partials; it has no audio-in API. It cannot
consume browser-sourced PCM. So server-side STT must use per-utterance `transcribe()` (blob-in),
which is fine: Parakeet on Apple Silicon returns RTF metrics well under 1 for 3–6s utterances.
Streaming partials from browser audio would require a **Vox-side change** (audio-in live session) —
that is a cross-repo dependency, not something to assume.

---

## 6. Risks, ranked

1. **Echo / AEC** — highest. Browser AEC is applied at capture, but its reference path is
   best-tested for WebRTC remote-track playout. Chrome desktop generally cancels WebAudio output
   too; **WKWebView (Scout for macOS) is the unknown**, and the app's own far-field default
   (`shared/realtime-voice.ts:8`) says operators run speakers, not headphones. If AEC fails, a
   continuous hands-free loop hears itself and never stops talking. Must be measured, not assumed.
   Mitigations: keep playout on the WebRTC track; half-duplex gate during playout as a fallback;
   raise VAD threshold while speaking; near/far profile already exists.
2. **Cancellation correctness** — barge-in that doesn't truncate history, or a TTS abort that leaks
   a chunk into the pacer after cancel. Single monotonic `responseId` guarding every async
   continuation is the only reliable discipline; the existing `generationRef` pattern in
   `ScoutbotRealtimeVoiceContext.tsx:97` is the right shape to copy server-side.
3. **Perceived latency** — see budget below. The deep path cannot be made fast; it must be *covered*
   by an immediate spoken acknowledgement.
4. **Native-addon fragility** — `@roamhq/wrtc` prebuilds, macOS arm64, Node version drift. The
   sidecar + `VoiceTransport` seam contains this.
5. **Backpressure** — `RTCAudioSource` needs wall-clock 10ms frames. Unbounded TTS queueing costs
   memory and, worse, makes cancel latency unbounded. Bound the pacer to ~2s and stall the producer.
6. **Reconnect** — currently a hard teardown; a hands-free session that drops on a Wi-Fi blip is
   unusable.
7. **Auth/exposure** — the media sidecar must bind loopback only and require the lease id on
   connect. The call route today is env-gated but unauthenticated (`routes/voice.ts:507`), which is
   defensible for an SDP proxy and *not* defensible for a process that will hold a live mic feed.
8. **Cost/observability** — Realtime billed one line item; we now have STT + LLM + TTS with distinct
   failure and cost profiles. Emit per turn: `vadMs`, `sttMs`, `llmTtftMs`, `ttsTtfbMs`,
   `audioOutMs`, `barged`, `route` (vox vs openai-direct). Without this, regressions are invisible.

---

## 7. Latency budget (target: first audio ≤ 900ms shell, ≤ 2.5s deep)

| Stage | Expected |
| --- | --- |
| Endpoint silence (tunable 400–500ms; currently 500) | 400–500ms |
| STT, local Parakeet, 3–6s utterance | 150–400ms |
| Shell LLM first token (short prompt) | 300–600ms |
| TTS TTFB (streaming PCM) | 300–600ms |
| Transport, loopback | < 50ms |
| **Shell turn total** | **~1.0–1.6s** |
| Deep turn: snapshot build + full non-streamed Scoutbot reply | **+1.5–5s** |

The deep path is why the orchestrator must speak an acknowledgement within ~600ms and stream the
answer behind it. Streaming the Scoutbot Responses call is the single highest-leverage backend
change after that.

---

## 8. Phased plan

| Phase | Scope | Exit criteria | Est. |
| --- | --- | --- | --- |
| **P0 Spike** | `@roamhq/wrtc` under Node sidecar; loopback tone echo; **measure AEC** in Chrome + WKWebView with WebAudio playout; confirm OpenAI PCM streaming TTFB | Go/no-go on WebRTC vs WebSocket transport, recorded AEC numbers | 3 days |
| **P1 Half-duplex loop** | Sidecar + transport + VAD segmentation → existing `transcribe()` → existing `respond()` → existing `speak()` → paced playout. No streaming, no barge-in. | Hands-free multi-turn conversation works end to end behind the flag | 1 wk |
| **P2 Streaming + barge-in** | Streaming Responses variant, sentence-chunked TTS, cancel + history truncation, shell/deep orchestrator, filler acknowledgements | Interrupt mid-sentence and the next turn is coherent; shell turn < 1.6s | 1.5 wk |
| **P3 Robustness** | ICE restart/reconnect, lease integration, teardown on every exit path, idle reaper, per-turn metrics | Wi-Fi blip recovers without losing the conversation; no orphan sidecars | 1 wk |
| **P4 Parity + cutover** | Trace-event parity, UI-action parity, native-host parity, A/B against the OpenAI path, burn-in, then delete | Flag flip with the OpenAI path retained one release behind an env var | 0.5–1 wk |

**Realistic estimate: 5–6.5 weeks, one focused engineer**, assuming P0 goes the easy way. Add 1–2
weeks if the WebRTC stack fights back and the WebSocket transport becomes the primary, or if Vox
needs an audio-in live session for streaming partials.

Cheapest possible first slice, if the goal is to de-risk fast: **P0 + P1 only (~1.5 weeks)** proves
the whole thesis on real hardware with real Scoutbot latency, and everything after that is quality.

---

## 9. Open decisions for the coordinator

1. **Transport** — accept the Node-sidecar-WebRTC default, or wait for the P0 AEC measurement to
   possibly drop WebRTC for WebSocket+Opus? (Recommendation: build P0 to answer this; do not decide
   on priors.)
2. **Shell model** — the shell/deep split needs a fast conversational model with the Scoutbot
   persona and no snapshot. Reuse `gpt-4.1-mini` with a stripped prompt, or a smaller/local model?
3. **Vox dependency** — is a Vox-side audio-in live session in scope? It is the difference between
   utterance-latency STT and true streaming partials. Cross-repo; needs a Vox owner.
4. **iOS** — if voice over the pairing relay is on the roadmap, say so now; it is the one input that
   changes the gateway recommendation.
