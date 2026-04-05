# Scout iOS — Navigation & State Concept

## Design Language

iOS 26 Liquid Glass. Dark-first with the existing ScoutColors palette.
Safari-inspired single-surface navigation — not a tab bar app.

---

## Navigation Model: Safari-Style

One primary surface at a time with a contextual bottom toolbar,
a session/address bar, and a card grid for jumping between anything.

```
┌─────────────────────────────────────────────┐
│                                             │
│            Current Surface                  │
│     (Home, Session Detail, New, etc.)       │
│                                             │
├─────────────────────────────────────────────┤
│  [ session name · status ]          ⋯       │  ← address bar
│  ◀  ▶  [context actions]      ▦  + │       │  ← bottom toolbar
└─────────────────────────────────────────────┘
```

### Bottom Toolbar (contextual, Liquid Glass)

Changes based on what you're looking at:

| Surface | Left | Center/Address Bar | Right |
|---------|------|-------------------|-------|
| Home | — | `● Connected · Mac Mini` | `⋯` `▦` |
| Session Detail | `◀` `▶` | `openscout · main · ● Working` | `⋯` `▦` `+` |
| New Session | `◀` | `New Session` | `▦` |
| All Sessions | `Done` | `N Sessions` | `⋯` `+` |

- `▦` = All Sessions grid (always available)
- `+` = New Session
- `⋯` = overflow (settings, pair/unpair, disconnect, help)
- `◀` `▶` = back/forward through session history

### Address Bar

Tappable pill showing current context. Tap to:
- Search sessions
- See session state detail
- Quick-switch to recent sessions (dropdown, like Safari URL suggestions)

---

## Surface: Home

Landing surface. Answers: what's connected, what's happening, what's next.

```
┌─────────────────────────────┐
│                             │
│         (Scout logo)        │
│                             │
│  ┌───────────────────────┐  │
│  │  🖥  Arach's Mac Mini │  │  ← glass device card
│  │  ● Connected          │  │
│  │  macOS · 14 agents    │  │
│  │  Paired 3 days ago    │  │
│  └───────────────────────┘  │
│                             │
│  ACTIVE SESSIONS       2    │
│  ┌───────────────────────┐  │
│  │ openscout · ● Working │  │  ← tap → Session Detail
│  │ 12 turns · "Fix iOS…" │  │
│  ├───────────────────────┤  │
│  │ dewey · ● Idle 14m    │  │
│  │ 8 turns · "Read feed…"│  │
│  └───────────────────────┘  │
│                             │
│  RECENT                     │
│  amplink · 34 turns · yday  │
│  hudson · 12 turns · 2d ago │
│                             │
├─────────────────────────────┤
│ ● Connected · Mac Mini  ▦ + │  ← toolbar
└─────────────────────────────┘
```

**Connection states** (shown in device card + address bar):

| State | Device Card | Address Bar |
|-------|------------|-------------|
| `connected` | Green dot, machine info | `● Connected · Mac Mini` |
| `connecting` | Amber pulse | `◐ Connecting...` |
| `reconnecting(N)` | Amber, attempt count | `◐ Reconnecting...` |
| `disconnected` (trusted) | Gray, "Tap to reconnect" | `○ Disconnected` |
| `disconnected` (no trust) | Pair CTA fills the card | `○ Not Paired` |
| `failed(error)` | Red, error + retry | `✕ Connection Failed` |

No state replaces the whole screen. You always have the toolbar,
can always reach All Sessions or start something new.

---

## Surface: Session Detail

The conversation view. Pushes from Home, All Sessions, or New.

```
┌─────────────────────────────┐
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
│  │ ◉ Working...           │ │  ← live indicator
│  └────────────────────────┘ │
│                             │
│  [  Message agent...    🎤] │  ← composer (glass)
├─────────────────────────────┤
│ openscout · main · ● Working│
│ ◀  ▶             ⋯  ▦  +  │  ← toolbar
└─────────────────────────────┘
```

**Session state** in the address bar pill:
- `● Working` — amber, agent executing
- `● Idle` — green, waiting for input
- `✓ Completed` — green checkmark
- `✕ Error` — red, tap for detail + retry
- `◐ Queued` — gray, agent waking

**`⋯` overflow menu** from Session Detail:
- Copy session link
- View agent profile
- Stop agent
- Close session
- Settings

**`◀` `▶`** — navigate between turns or between sessions
(back goes to previous session you were viewing, like browser history).

---

## Surface: All Sessions (▦)

Card grid, like Safari's "All Tabs." Grouped, searchable.

```
┌─────────────────────────────┐
│  Sessions              ⋯   │
│  🔍 Search...               │
│                             │
│  ACTIVE                  2  │
│  ┌──────────┐ ┌──────────┐ │
│  │openscout │ │ dewey    │ │
│  │● Working │ │● Idle    │ │
│  │"Fix iOS  │ │"Read     │ │
│  │ build.." │ │ feedba.."│ │
│  └──────────┘ └──────────┘ │
│                             │
│  TODAY                      │
│  ┌──────────┐ ┌──────────┐ │
│  │amplink   │ │ hudson   │ │
│  │✓ Done    │ │✓ Done    │ │
│  │34 turns  │ │12 turns  │ │
│  └──────────┘ └──────────┘ │
│                             │
│  YESTERDAY                  │
│  ┌──────────┐               │
│  │lattices  │               │
│  │✓ Done    │               │
│  └──────────┘               │
│                             │
│  ┌──────────────────────┐   │
│  │       + New Session   │   │
│  └──────────────────────┘   │
│                             │
├─────────────────────────────┤
│  Done    3 Sessions    ⋯  + │
└─────────────────────────────┘
```

**Grouped by:**
- Active (live flights or recent turns) — always on top
- Today / Yesterday / This Week / Older

**Card interactions:**
- Tap → animate into Session Detail
- Swipe left → close/archive session
- Long press → context menu (copy, share, stop agent)
- `+ New Session` card at the bottom

**`⋯` overflow** from All Sessions:
- Close all completed
- Sort by (recent, project, agent)
- Settings

---

## Surface: New Session

Reached via `+` button. Workspace → config → launch.

```
┌─────────────────────────────┐
│  New Session                │
│  🔍 Filter...               │
│                             │
│  ┌───────────────────────┐  │
│  │ 📁 openscout          │  │
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
├─────────────────────────────┤
│ ◀  New Session         ▦   │
└─────────────────────────────┘

     │ tap workspace
     ▼

┌─────────────────────────────┐
│  ◀ openscout                │
│                             │
│  HARNESS                    │
│  ( Claude )  ( Codex )      │
│                             │
│  BRANCH                     │
│  main                    ▼  │
│                             │
│  EFFORT                     │
│  ( Quick ) (● Normal) (Deep)│
│                             │
│  ┌───────────────────────┐  │
│  │    Launch Session   → │  │
│  └───────────────────────┘  │
├─────────────────────────────┤
│ ◀  openscout           ▦   │
└─────────────────────────────┘
```

Launch → pushes to Session Detail with the new session.

---

## Navigation Flow

```
         Home
          │
     ┌────┼────────────────┐
     │    │                │
     ▼    ▼                ▼
  Session  Session    New Session
  Detail   Detail     (workspace → config)
     │                     │
     │◀────── ▦ ──────────▶│
     │   All Sessions      │
     │   (card grid)       │
     │                     │
     └─────────┬───────────┘
               │
          Any session card
          tapped → Session Detail
```

All surfaces share the same bottom toolbar. `▦` is always reachable.
`+` is always reachable. Back button returns to previous surface.

This is a **stack**, not tabs. You push and pop. The card grid
is the "escape hatch" to jump anywhere without popping the whole stack.

---

## State Model

```
ConnectionState (global, always visible in toolbar address bar)
├── disconnected (no trust) → Home shows Pair flow in device card
├── disconnected (trusted)  → Home shows "Tap to reconnect"
├── connecting / handshaking → address bar pulses amber
├── connected               → green dot, machine name
├── reconnecting(N)         → amber, attempt count
└── failed(error)           → red dot, tap for detail

SessionState (per session, in address bar when viewing that session)
├── idle        → ● green, waiting for input
├── working     → ● amber, agent executing
├── queued      → ◐ gray, agent waking
├── completed   → ✓ green, done
└── error       → ✕ red, tap for retry
```

---

## Liquid Glass Usage

| Element | Treatment |
|---------|-----------|
| Bottom toolbar | Liquid Glass bar, system translucent |
| Address bar | Glass capsule pill in toolbar |
| Device card (Home) | `.glassEffect()` container |
| Session cards (grid) | `.glassEffect()` with state-tinted border |
| Status pills | Tinted glass (green/amber/red/gray) |
| Composer | Glass material, inset above toolbar |
| Overflow menu | Glass popover |
| New session config | Glass-backed form sections |

---

## Migration Path

Current → Safari model:

| Current | Becomes |
|---------|---------|
| `ContentView` (state-switch) | Home surface + toolbar (no more full-screen takeover) |
| `SessionListView` | All Sessions card grid (▦) |
| `PairingView` | Inline in Home device card |
| `TimelineView` | Session Detail surface |
| `WorkspaceBrowserView` | New Session surface |
| `HarnessPickerView` | Config step in New Session flow |

Steps:
1. Build the toolbar + address bar shell (NavigationStack + custom toolbar)
2. Home surface with device card and active sessions
3. Session Detail with composer and state pill
4. All Sessions card grid with grouping
5. New Session flow (workspace → config → launch)
6. Wire `◀` `▶` navigation history
7. Polish: glass effects, animations, search
