# Realtime Scoutbot voice — design pass

**Branch:** `codex/realtime-voice-flagged`
**Flag:** `surface.realtime-voice`
**Date:** 2026-07-22
**Scope:** Product design + UI refinement only (no backend architecture)

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

### Right-sidebar relationship

- Text chat remains in the right sidebar
- Removed the voice popover, in-panel live strip, and detached floating HUD from that sidebar
- Connecting/live status and control remain available globally, even if the sidebar is collapsed

### Speech-mode relationships (`ScoutbotPanel` + `ChatInput`)

- While live: composer mic soft-held (`voiceHeld`), label “Live call”, no busy spinner
- Placeholder becomes “Type while live voice is on…”
- Voice-replies tooltip notes that TTS is for typed chat; the call has its own audio
- Dictation still blocks starting a live call (unchanged)

## Files touched

- `packages/web/client/scout/scoutbot/ScoutbotRealtimeVoice.tsx`
- `packages/web/client/scout/scoutbot/ScoutbotRealtimeVoiceContext.tsx`
- `packages/web/client/scout/scoutbot/ScoutbotPanel.tsx`
- `packages/web/client/scout/scoutbot/ScoutbotChat.tsx` (`voiceHeld` prop)
- `packages/web/client/OpenScoutAppShell.tsx`

## Checks run

```bash
bun test client/lib/realtime-voice.test.ts \
  client/lib/scout-flags-realtime-voice.test.ts \
  client/scout/scoutbot/ScoutbotChat.test.tsx \
  server/realtime-voice.test.ts
# 10 pass

./node_modules/.bin/tsc --noEmit
# no new scoutbot-related errors (pre-existing package errors remain elsewhere)
```

## Preserved

- Feature flag gate unchanged
- WebRTC start/end + Scoutbot function-call bridge unchanged
- Non-realtime Scoutbot chat, dictation, and voice replies unchanged when flag off or call idle

## Remaining concerns

- No visual regression screenshots in this pass; operator should reload `?ff.surface.realtime-voice=on` and walk Ready → Connecting → Live → End from the bottom status bar
- Activity trail still depends on client/server trace events; empty trail while connecting is possible for a beat
- Soft-holding the composer mic during live is intentional UX; if dual-mic ever becomes a product goal, revisit `voiceHeld`
- Not pushed / not merged (per ask)
