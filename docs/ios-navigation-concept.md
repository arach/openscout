# Scout iOS — Navigation & State Concept

## Design Language

iOS 26 Liquid Glass. Translucent tab bar, glass-material navigation bars,
system blur for overlays. Dark-first with the existing ScoutColors palette.

---

## Information Architecture

Three top-level branches, one overlay layer:

```
TabView (Liquid Glass tab bar, 3 tabs)
├── Home          — connection state, device info, quick actions
├── Sessions      — recent work, search, history
└── New           — project picker → harness config → launch

Session Detail (full-screen push from Sessions or New)
└── Multi-session switcher (overlay, like Safari tab cards)
```

---

## Tab 1: Home

The "status dashboard." Always answers: what's connected, what's happening.

```
┌─────────────────────────────┐
│  ● Connected                │  ← glass pill, green/yellow/red
│                             │
│  ┌───────────────────────┐  │
│  │  🖥  Arach's Mac Mini │  │  ← device card (glass surface)
│  │  macOS · 14 agents    │  │
│  │  Uptime: 3d 12h       │  │
│  │                       │  │
│  │  [Disconnect]  [Pair] │  │
│  └───────────────────────┘  │
│                             │
│  QUICK ACTIONS              │
│  ┌──────┐ ┌──────┐         │
│  │ New  │ │ Ask  │         │  ← glass cards
│  │ Sess.│ │ Scout│         │
│  └──────┘ └──────┘         │
│                             │
│  ACTIVE NOW          2     │
│  ┌───────────────────────┐  │
│  │ ● dewey — working     │  │  ← live agent status
│  │ ● arc — idle 5m ago   │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

**Connection states surfaced here:**
- `connected` — green dot, device card shows machine info
- `connecting` / `handshaking` — amber pulse, "Connecting..."
- `reconnecting(N)` — amber, "Reconnecting (attempt N)..."
- `disconnected` (trusted) — gray, "Tap to reconnect"
- `disconnected` (no trust) — shows Pair CTA
- `failed` — red, error detail, retry button

**This replaces** the current ContentView's state-switch routing.
All states are visible _within_ the Home tab instead of replacing the whole screen.

---

## Tab 2: Sessions

Recent-first, searchable. Two sub-sections via a segmented control.

```
┌─────────────────────────────┐
│  Sessions                   │
│  [Active ▼] [History]       │  ← segmented / Liquid Glass toggle
│                             │
│  🔍 Search sessions...      │
│                             │
│  TODAY                      │
│  ┌───────────────────────┐  │
│  │ openscout · main      │  │
│  │ 12 turns · 3m ago     │  │
│  │ "Fix iOS build warn…" │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ dewey · main          │  │
│  │ 8 turns · 14m ago     │  │
│  │ "Read feedback, veri…"│  │
│  └───────────────────────┘  │
│                             │
│  YESTERDAY                  │
│  ┌───────────────────────┐  │
│  │ amplink · master      │  │
│  │ 34 turns · completed  │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

**Active** = sessions with a live flight or recent turns (last hour).
**History** = everything, grouped by day, searchable.

Tap a session → push to Session Detail (full screen).

---

## Tab 3: New Session

Pick a project → pick a harness → configure → launch.

```
┌─────────────────────────────┐
│  New Session                │
│                             │
│  WORKSPACES                 │
│  ┌───────────────────────┐  │
│  │ 📁 openscout          │  │  ← from mobile/workspaces RPC
│  │    ~/dev/openscout     │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ 📁 dewey              │  │
│  │    ~/dev/dewey         │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ 📁 amplink            │  │
│  │    ~/dev/amplink       │  │
│  └───────────────────────┘  │
│                             │
│  🔍 Filter workspaces...    │
└─────────────────────────────┘

        │ tap a workspace
        ▼

┌─────────────────────────────┐
│  ◀ openscout                │
│                             │
│  HARNESS                    │
│  ( Claude )  ( Codex )      │  ← toggle / picker
│                             │
│  BRANCH                     │
│  main                    ▼  │  ← dropdown if multiple
│                             │
│  EFFORT                     │
│  ( Quick )  (● Normal ) ( Deep )
│                             │
│  ┌───────────────────────┐  │
│  │    Launch Session   → │  │  ← accent-colored CTA
│  └───────────────────────┘  │
└─────────────────────────────┘
```

Launch → creates session via `mobile/session/create` → pushes to Session Detail.

---

## Session Detail (Full Screen)

The conversation/turn view. Pushed from Sessions or New.

```
┌─────────────────────────────┐
│  ◀  openscout · main    ⋯  │  ← nav bar: back + overflow menu
│  ● Claude · Working         │  ← agent status pill (glass)
├─────────────────────────────┤
│                             │
│  ┌─ You ──────────────────┐ │
│  │ Fix the iOS build      │ │
│  │ warnings for iOS 26    │ │
│  └────────────────────────┘ │
│                             │
│  ┌─ openscout ────────────┐ │
│  │ Found 5 warnings...    │ │
│  │ [▸ View code changes]  │ │
│  │ ✓ Completed            │ │
│  └────────────────────────┘ │
│                             │
│  ┌─ You ──────────────────┐ │
│  │ Now add a splash scr…  │ │
│  └────────────────────────┘ │
│                             │
│  ┌─ openscout ────────────┐ │
│  │ ◉ Working...           │ │  ← live streaming indicator
│  └────────────────────────┘ │
│                             │
├─────────────────────────────┤
│  [  Message agent...     ] 🎤│  ← composer (glass material)
└─────────────────────────────┘
```

**Session state indicators** (shown in the sub-header pill):
- `Working` — amber pulse, agent is executing
- `Idle` — green, waiting for input
- `Completed` — green checkmark
- `Error` — red, with retry action
- `Queued` — gray, waiting for agent wake

---

## Multi-Session Switcher

When you have 2+ active sessions, accessible via:
- Long-press the Sessions tab
- Swipe up from the composer
- `⋯` menu → "Switch Session"

Visual: Safari-style card stack with session previews.

```
┌─────────────────────────────┐
│  Active Sessions         ✕  │
│                             │
│  ┌───────────────────────┐  │
│  │ openscout · main      │  │  ← glass card, slightly tilted
│  │ ● Working · 12 turns  │  │
│  │ "Fix the iOS build…"  │  │
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │ dewey · main          │  │
│  │ ● Idle · 8 turns      │  │
│  │ "Read feedback, ver…" │  │
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │         + New          │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

Tap a card → animates back into the Session Detail for that session.

---

## State Model Summary

```
ConnectionState (global, shown on Home tab)
├── disconnected (no trust) → show Pair flow
├── disconnected (trusted)  → show Reconnect
├── connecting / handshaking → show progress
├── connected               → show device card
├── reconnecting(N)         → show retry count
└── failed(error)           → show error + retry

SessionState (per session, shown in Session Detail header)
├── idle        → waiting for user input
├── working     → agent executing (flight in progress)
├── queued      → invocation sent, agent waking
├── completed   → flight finished successfully
└── error       → flight failed, show retry
```

---

## Liquid Glass Usage

| Element | Treatment |
|---------|-----------|
| Tab bar | `.tabViewStyle(.liquidGlass)` — system translucent |
| Nav bar | Glass material with blur |
| Device card (Home) | `.glassEffect()` container |
| Session cards | `.glassEffect()` with subtle border |
| Status pills | Tinted glass capsules (green/amber/red) |
| Composer | Glass material, floats above content |
| Session switcher | Glass cards with depth via shadow |
| Segmented control | Glass-backed segments |

---

## Migration Path

The current app has:
- `ContentView` → state-switch router (replace with TabView)
- `SessionListView` → becomes the Sessions tab content
- `PairingView` → embedded in Home tab when no trust
- `TimelineView` → becomes Session Detail
- `WorkspaceBrowserView` → becomes New tab content
- `HarnessPickerView` → sheet from New tab after workspace pick

Incremental steps:
1. Add TabView shell with Home / Sessions / New
2. Move SessionListView into Sessions tab
3. Build Home tab from connection state + device info
4. Move workspace/harness flow into New tab
5. Add session state pills to Session Detail header
6. Add multi-session switcher overlay
