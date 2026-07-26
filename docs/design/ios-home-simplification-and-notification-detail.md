# iOS — Home simplification + notification detail

**Status:** draft (design only — nothing in `apps/ios` or `packages/*` changed)
**Studio lab:** `/studies/scout-ios-notification-detail` → `design/studio/views/scout-ios-notification-detail.tsx`
**Kit:** `design/studio/components/scout-ios/notification-surfaces.tsx`
**Sibling sketch:** `/studies/scout-ios-notifications` (concept page, same direction, authored separately)

---

## 1. The problem, stated in code

**Home has no hierarchy.** `HomeSurface.swift:103-134` composes seven optional
sections — vitals sparkline, needs-you, working, activity, not-connected,
terminals, ask, tail — five of them gated by `@AppStorage` switches declared at
`HomeSurface.swift:18-24`. The result is a "choose your own adventure" surface:
no two operators see the same Home, and none of them see a ranking. Attention
(`needsYouSection`, `:304-320`) is rendered as a **horizontal card scroller**,
which is the wrong shape for a triage queue — it hides its own tail.

**A push has no destination.** Today:

- `RootView.openNotification` (`:407-417`) — if the payload carries a
  `conversationId`, it **force-switches the tab to Comms**. Opening the alert
  navigates you somewhere you did not ask to go.
- Everything else opens `NotificationLandingSheet` (`:806-1045`), a medium/large
  detent sheet.
- That sheet is declared **twice on the same binding** — `RootView.swift:314`
  and `:342` — two `.sheet(item: $notificationLandingRoute)` modifiers on one
  view. Only one can present; the duplicate is dead weight at best.
- There is **no read state and no dismiss** anywhere. `mobile.inbox`
  (`apps/desktop/src/core/pairing/runtime/bridge/router.ts:671-675`) is derived
  live from `projectSessionAttention(snapshot)` — an item exists exactly as long
  as the agent is blocked. You cannot acknowledge an alert; you can only answer
  it or ignore it.

So: **acknowledging an alert currently requires being taken somewhere.** That is
the thing to fix.

## 2. Home — three zones, zero toggles

Home answers two questions: *what needs me* and *is the fleet moving*.

```
┌ Scout                        +   ⚙ ┐   masthead (unchanged)
│ NEEDS YOU  ⟨3⟩ ─────────────────── │   only when non-empty
│  ▍broker-smith  openscout APPROVAL 1m ›│  ← vertical rows, 44pt, tap → detail
│  ▍session initiation openscout QUESTION 2m ›│
│   tail-tuner    hudson   APPROVAL 4m ›│
│   1 more                            │
│ ACTIVITY ──────────────── 3 LIVE    │
│ ▏Ran swift build — 0 errors  claude now │  ← one flat log, accent edge = live
│  Wired HudCodeHighlighter…  codex  2m│
│  …                                  │
│ ╭─ Ask the fleet…              ↑ ╮  │   the one thing Home does besides report
└─────────────────────────────────────┘
```

**Kept.** Needs you · Activity · Ask.
**Folded in.** The Working lane becomes the accent-edged `now` rows of the
Activity log; its only surviving glance-value is the `3 LIVE` count in the lane
header.
**Moved off Home.** The vitals sparkline (already lives in `CrownVitalsPanel`),
the Terminals shelf and the Tail module (both belong to Ops).
**Removed.** All five `@AppStorage` section switches.

Rules that carry over from the existing system:

- Kind is a **mono text tag**, never a colored chip. A single amber marks
  *blocking* (approval · question — an agent is literally paused). No categorical
  color-coding, no status-dot pepper.
- Read rows **recede but stay**. Disappearing is what Dismiss is for.
- The count in the zone head is **unread**, because that is the number the tab
  badge and the app badge carry.
- The all-clear emblem keeps the shipped guard (`HomeSurface.swift:200-207`):
  bridge online **and** every lane empty **and** the activity read genuinely
  succeeded. A failed read must never render as calm.

## 3. Notification detail — a page, and three verbs

The destination of a push is a **pushed page** on the current tab's navigation
stack. Not a sheet, not a tab switch. Back returns you exactly where you were.

Content order — WHO → WHAT → EVIDENCE → ACT → notice → provenance — so a
banner-launched page tells you what is being asked *before* it offers a control.

| Verb | Meaning | Effect on the agent | Navigates? |
|---|---|---|---|
| **Act** (Approve / Deny / Answer / Retry) | resolve the demand | unblocks it | no — the page becomes a receipt |
| **Mark read** | I've seen it | none | no |
| **Dismiss** | not now / not mine | **none — the agent stays blocked** | back only |
| **Open ↗** | I want the transcript | none | yes, and only on request |

Two non-negotiables:

1. **Dismiss must never read like Deny.** On a blocking kind it always carries
   the line *"broker-smith is still waiting — this hid the alert, it didn't
   answer it"*, with an Undo.
2. **Triage works offline; Act does not.** Mark read and Dismiss queue locally
   and sync on reconnect. Approve/Deny dim with a stated reason. Acknowledging an
   alert must never require a Mac to be awake.

### States

| State | What it shows |
|---|---|
| `resolving` | Shaped skeleton + the `itemId` named in the provenance line. Triage already live. |
| `resolved` | The full item + Act block. |
| `acted` | Receipt ("Approved 2s ago — broker-smith resumed. Nothing else opened."). Page stays; Mark read flips on. |
| `handled` | Resolved elsewhere: *what* happened, *where*, *when*. Act withdrawn, triage stays. Replaces today's vague "no longer active" (`RootView.swift:835`). |
| `offline` | No readable bridge. Act disabled with a reason; provenance degrades to "last read 4m ago". |
| `failed` | The decision call failed. Choice kept, buttons live, nothing cleared and nothing claimed. |
| `dismissed` | Hidden from Needs you + the honesty line + Undo. |

### Accessibility

- Dynamic Type throughout; the title wraps rather than truncates.
- 44pt minimum on every row and every triage target.
- VoiceOver order: kind → agent/project → age → title → summary → evidence →
  Act → triage. Row label: *"Approval from broker-smith in openscout, 1 minute
  ago. Delete resolved SwiftPM checkouts. Unread."*
- Nothing is encoded by color alone — kind is text, risk is contrast, read is
  weight.
- Reduce Motion respected (the study's only motion is the existing entrance).
- Dismiss's spoken label states its real effect: *"Dismiss — hides this from
  Needs you; the agent keeps waiting."*

## 4. Contracts

### 4.1 Push payload — unchanged discipline, two additions

The payload stays **opaque**: correlation ids only, never a prompt, command,
path, or failure string. That discipline already exists in three places and must
be preserved — `OPAQUE_MOBILE_PUSH_PAYLOAD_KEYS`
(`packages/runtime/src/mobile-push.ts:337-350`), `sanitizeCustomPayload`
(`apps/mesh-front-door/src/push-relay.ts:796-820`), and the generic bodies in
`genericMobileInboxAlertBody` (`server-trpc.ts:212-220`) /
`bodyForInput` (`push-relay.ts:778-794`).

```jsonc
{
  "aps": {
    "alert": { "title": "Scout", "body": "A local agent needs your approval." },
    "sound": "default",
    "thread-id": "scout.inbox",
    "category": "SCOUT_ATTENTION",   // NEW — enables banner actions (slice 4)
    "badge": 3                        // NEW — unread + undismissed + blocking
  },
  "scout": {
    "destination": "inbox",
    "itemId": "att_9f31", "kind": "approval",
    "sessionId": "s_7742", "turnId": "t_31", "blockId": "b_04",
    "conversationId": "c_7742"        // present ≠ "open Comms" (see §5)
  }
}
```

`destination: "inbox"` is retained as-is — `ScoutApp.swift:81` and
`AppModel.swift:390` both guard on it, and re-using the value avoids a
compatibility break. Its *meaning* changes: it now routes to the notification
detail page rather than to a sheet-or-Comms fork.

Deep-link parity with `scout://pair`: `scout://notification?item=<itemId>`,
handled in `AppModel.handleDeepLink` (`:2100`).

### 4.2 Read / dismiss — new bridge state

`MobileNotificationItem` gains two fields:

```swift
public var readAt: Int64?       // epoch ms, nil = unread
public var dismissedAt: Int64?  // epoch ms, nil = live in Needs you
```

New capability (mirrors `MobileNotificationCapability`):

```swift
public protocol MobileNotificationTriageCapability: Sendable {
    func markMobileNotificationsRead(itemIds: [String], readAt: Int64) async throws
    func dismissMobileNotifications(itemIds: [String], dismissedAt: Int64) async throws
}
```

Bridge router additions (`router.ts`, next to `mobile.inbox`):

- `mobile.notificationRead({ itemIds: string[], readAt: number })`
- `mobile.notificationDismiss({ itemIds: string[], dismissedAt: number })`

**The Mac is the canonical writer.** State lives bridge-side so the iPhone, the
iPad and the Mac's own attention center agree; the client writes optimistically
and reconciles on the next `mobile.inbox` read. Device-only storage is the
fallback for slice 1 only (see §7), never the end state.

Because `mobile.inbox` is currently *derived* from
`projectSessionAttention(snapshot)` and holds no state of its own, triage state
must be a **side table keyed by the immutable `itemId`**, joined at read time.
Items that vanish (the agent got unblocked elsewhere) leave orphan rows; expire
them on the same retention clock the attention projection already uses.

**Badge math.** `badge = count(items where dismissedAt == nil && readAt == nil &&
blocking)`. Mark read decrements; Dismiss decrements; acting decrements.

### 4.3 Banner actions (slice 4)

`UNNotificationCategory("SCOUT_ATTENTION")` registered in
`ScoutAppDelegate.didFinishLaunchingWithOptions` (`ScoutApp.swift:23-29`) with:

| Action id | Title | Options |
|---|---|---|
| `SCOUT_MARK_READ` | Mark read | none (background) |
| `SCOUT_DISMISS` | Dismiss | none (background) |
| `SCOUT_OPEN` | Open | `.foreground` |

`userNotificationCenter(_:didReceive:)` (`ScoutApp.swift:60-78`) branches on
`response.actionIdentifier` before building a route. The relay must forward
`category` — `push-relay.ts:737-746` builds the `aps` dict and carries only what
it is told to.

## 5. Code touchpoints

**iOS**

| File | Change |
|---|---|
| `apps/ios/Scout/RootView.swift:314-325`, `:342-353` | Remove the duplicate `.sheet(item:)`; replace the sheet with a navigation destination. |
| `apps/ios/Scout/RootView.swift:407-417` | `openNotification` — delete the `conversationId → surface = .comms` branch. Every kind routes to the detail page. |
| `apps/ios/Scout/RootView.swift:806-1045` | Extract `NotificationLandingSheet` → `apps/ios/Scout/NotificationDetailView.swift`; add the triage bar and the seven states. |
| `apps/ios/Scout/HomeSurface.swift:18-24` | Retire the five `ScoutHomeSection` keys (and the Settings HOME panel that drives them). |
| `apps/ios/Scout/HomeSurface.swift:103-134` | Recompose to three zones. |
| `apps/ios/Scout/HomeSurface.swift:298-320` | `needsYouSection` — horizontal `NeedCard` scroller → vertical rows; tap routes to the detail page, not to the conversation. |
| `apps/ios/Scout/HomeSurface.swift:386-399`, `:465-499`, `:913-957` | Terminals / Tail / FleetVitals leave Home. |
| `apps/ios/Scout/AppModel.swift:87-90`, `:403-435` | Add the triage store + offline queue beside `pendingNotificationRoute`. |
| `apps/ios/Scout/AppModel.swift:2100` | `scout://notification?item=` deep link. |
| `apps/ios/Scout/ScoutApp.swift:23-29`, `:60-78` | Category registration + `actionIdentifier` branch. |

**Shared / Mac**

| File | Change |
|---|---|
| `packages/scout-native-core/Sources/ScoutCapabilities/MobilePush.swift:87-141` | `readAt` / `dismissedAt` + the triage capability. |
| `packages/scout-ios-core/Sources/ScoutIOSCore/BridgeBrokerClient.swift:467` | Client methods for the two mutations. |
| `apps/desktop/.../bridge/router.ts:439-461`, `:671-675` | Join triage state into `mobileInboxItemFromSessionAttention`; add the mutations. |
| `apps/desktop/.../bridge/server-trpc.ts:151-220` | `sendMobileInboxPushNotification` — add `category` + `badge`; consider a per-session `threadId` so iOS groups by agent. |
| `packages/runtime/src/mobile-push.ts:54-61`, `:253-277` | `MobilePushAlert` carries `category` / `badge` through to the relay. |
| `apps/mesh-front-door/src/push-relay.ts:737-746` | Forward `category` + `badge` into the `aps` dict. |
| `apps/macos/Sources/Scout/ScoutAttentionCenter.swift` | Honor `dismissedAt` when deciding whether to deliver/retract, so triage on the phone quiets the Mac. |

## 6. Acceptance criteria

1. Tapping any Scout push lands on the notification detail page. No tab switch,
   no conversation opened, and Back returns to the surface that was showing.
2. Approving, denying, or answering from the detail page resolves the agent
   without opening the transcript, and the page stays as a receipt.
3. Mark read clears unread, decrements the badge, and leaves the item in Needs
   you. It never mutates the agent.
4. Dismiss removes the item from Needs you with an Undo, never mutates the
   agent, and on a blocking kind states that the agent is still waiting.
5. Read and dismissed state survives an app relaunch and agrees across devices
   once slice 3 lands.
6. With no reachable Mac: Mark read and Dismiss succeed and sync later; Act is
   disabled with a stated reason; no action result is ever fabricated.
7. An item resolved elsewhere renders as a resolution (what/where/when), not as
   an error.
8. A failed decision keeps the choice, says it did not land, and offers a retry.
9. Home shows at most one attention zone and one activity feed; no section
   toggles remain.
10. Every control is reachable with VoiceOver at the largest Dynamic Type size;
    no state is conveyed by color alone.
11. The APNs payload still carries no human-readable content.

## 7. Incremental delivery

**Slice 1 — the page (no backend change).** Extract the sheet into
`NotificationDetailView`, delete the force-open branch and the duplicate
`.sheet`, add the triage bar with device-local read/dismiss. Ships alone and
already fixes the "acknowledging means navigating" problem.

**Slice 2 — Home.** Three zones, vertical Needs-you rows routing to slice 1's
page, Working folded into the log, toggles retired, Terminals/Tail/vitals moved
to Ops.

**Slice 3 — durable triage.** `readAt` / `dismissedAt` on the item, the two
bridge mutations, badge math, offline queue reconciliation, and macOS parity in
`ScoutAttentionCenter`.

**Slice 4 — banner actions.** `category` through the relay, the
`UNNotificationCategory` registration, background action handling. Triage from
the lock screen without launching the app.

Each slice is independently shippable and independently reversible; slice 1 is
the one that pays for itself immediately.
