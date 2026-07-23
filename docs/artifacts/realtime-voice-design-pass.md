# Realtime Scoutbot voice — design pass

**Branch:** `codex/realtime-voice-flagged`
**Flag:** `surface.realtime-voice`
**Date:** 2026-07-22
**Scope:** Flagged high-trust pilot, including the browser/server safety boundary

## Problem

The first realtime surface mixed onboarding copy with live session control:

- Status repeated three times (toolbar active, badge, “voice session” card)
- Idle popover was a brochure (“what happens next”) rather than a compact HUD
- Lime gradient header + solid CTA competed with Scoutbot chrome
- Live/connecting feedback was loud (glow, pulse, bright borders)
- Three speech modes (composer mic, voice replies, live voice) sat side by side without a clear relationship
- Floating mini-HUD could stack with panel chrome when the panel stayed open
- The right-sidebar popover opened downward, so its primary action could fall below the viewport

## Design idea

Treat live voice as a **session mode layered on Scoutbot**, not a mini product page.

| Mode | Job |
| --- | --- |
| Composer mic | One-shot dictation → chat |
| Voice replies | TTS for typed chat answers |
| Live voice | Continuous WebRTC call with Scoutbot |

Hierarchy when live:

1. One calm state line (Connecting / Live / Ended / Error)
2. Optional short activity trail (last 2 events only)
3. Single end/cancel control
4. Text composer stays available; one-shot mic is soft-held by the live call

## Changes

### Global status-bar control (`ScoutbotRealtimeVoice.tsx`)

- Moved live-voice engagement out of the right sidebar and into the permanent bottom status bar
- Portaled the menu above the status bar so sidebar overflow and viewport height cannot hide its CTA
- Dropped marketing gradient, long explainer, and the three-mode legend
- State-first header with one status chip and one detail line
- Active: last 2 activity events only
- Quieter start/end buttons (ghost lime / soft red, not solid lime / hard red)
- Status trigger becomes `VOICE LIVE` only while live
- Requires explicit consent before every attempt: microphone audio is sent to OpenAI Realtime and billed to the configured OpenAI API account
- Agent-request actions are shown as unsent proposals with explicit **Send request** / **Do not send** controls

### Right-sidebar relationship

- Text chat remains in the right sidebar
- Removed the voice popover, in-panel live strip, and detached floating HUD from that sidebar
- Connecting/live status and control remain available globally, even if the sidebar is collapsed

### Speech-mode relationships (`ScoutbotPanel` + `ChatInput`)

- While live: composer mic soft-held (`voiceHeld`), label “Live call”, no busy spinner
- Placeholder becomes “Type while live voice is on…”
- Voice-replies tooltip notes that TTS is for typed chat; the call has its own audio
- Dictation still blocks starting a live call (unchanged)

### Server boundary and resilience

- The browser feature flag controls discoverability only. The billable route is independently disabled unless the host sets `OPENSCOUT_REALTIME_VOICE_ENABLED=1` and restarts the web server.
- The standard OpenAI API key stays on the server. The browser posts SDP to OpenScout; OpenScout uses the unified `/v1/realtime/calls` flow and returns only the SDP answer.
- Existing Scout API host/origin middleware rejects cross-origin browser calls before credentials are resolved.
- A host-local SQLite admission database keeps the limit coherent across overlapping local web processes. The installed Caddy edge normally points at one Bun application process; the database also covers restart overlap. Defaults allow one active call and four starts per minute.
- The browser heartbeats its short lease and releases it on stop. Failed handshakes release immediately; abandoned leases expire after 90 seconds.
- Cancel aborts microphone acquisition and the SDP request, closes WebRTC, stops late-arriving media tracks, and prevents a late result from reviving the call.

Optional admission tuning:

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `OPENSCOUT_REALTIME_VOICE_MAX_CONCURRENT` | `1` | Active calls on this Scout host |
| `OPENSCOUT_REALTIME_VOICE_STARTS_PER_MINUTE` | `4` | Start-attempt limit across local web processes |
| `OPENSCOUT_REALTIME_VOICE_LEASE_TTL_MS` | `90000` | Lease expiry; the browser renews every 25 seconds |

This is local pilot admission and abuse containment, not distributed billing infrastructure, account-wide quota enforcement, or an enterprise authorization boundary.

Transport and model defaults were checked against OpenAI's current [Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc) guide on 2026-07-23.

## Files touched

- `packages/web/client/scout/scoutbot/ScoutbotRealtimeVoice.tsx`
- `packages/web/client/scout/scoutbot/ScoutbotRealtimeVoiceContext.tsx`
- `packages/web/client/scout/scoutbot/ScoutbotPanel.tsx`
- `packages/web/client/scout/scoutbot/ScoutbotChat.tsx` (`voiceHeld` prop)
- `packages/web/client/OpenScoutAppShell.tsx`
- `packages/web/client/lib/realtime-voice.ts`
- `packages/web/server/realtime-voice.ts`
- `packages/web/server/routes/voice.ts`
- `packages/web/shared/realtime-voice.ts`

## Checks run

```bash
bun test packages/web/client/lib/realtime-voice.test.ts \
  packages/web/client/lib/scout-flags-realtime-voice.test.ts \
  packages/web/client/scout/scoutbot/ScoutbotChat.test.tsx \
  packages/web/server/realtime-voice.test.ts \
  packages/web/server/server-core.test.ts
# 27 pass

bun run protocol:build
bun run --cwd packages/runtime build
bun run --cwd packages/web build:client
bun run --cwd packages/web build:server
```

The targeted tests cover cancellation, server enablement, origin rejection, admission, heartbeat/release, rate limiting, and upstream-failure cleanup. A browser pass on the worktree build verified that Start is disabled before consent, enabled after consent, Cancel returns promptly while microphone acquisition is pending, and consent resets before the next attempt.

## Preserved

- Feature flag remains the UI rollout/discoverability gate
- WebRTC start/end + Scoutbot function-call bridge unchanged
- Non-realtime Scoutbot chat, dictation, and voice replies unchanged when flag off or call idle

## Remaining concerns

- A real billed OpenAI call was intentionally not placed during visual verification; the unit/server suites cover SDP handoff and lease behavior without spending from the configured account
- Activity trail still depends on client/server trace events; empty trail while connecting is possible for a beat
- Soft-holding the composer mic during live is intentional UX; if dual-mic ever becomes a product goal, revisit `voiceHeld`
- Admission is host-local. Multiple OpenScout hosts do not share a global call limit.
