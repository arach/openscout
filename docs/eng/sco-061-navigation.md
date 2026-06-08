# SCO-061 — Scout iOS Navigation Blueprint

The full navigation map for the next-gen iOS app, designed to lean on HudsonKit's
current surface area. Status legend: ✅ built · 🟡 partial · ⬜ planned. We map it
all here, then fill it out.

## Principles

Every feature plays exactly one **navigation role**. Getting the role right is
what keeps the app legible as it grows.

- **Places** — you dwell here; reachable from the tab bar. (Home, Tail, later Inbox.)
- **Pushes** — you go in and come back; a `NavigationStack` push off a place. (Conversation, Agent detail.) Never a tab.
- **Chrome** — ambient, always-present, never a tab. (Connection status, app identity.) Lives in `HudPhoneAppShell` **complications**.
- **Actions** — you do, then land somewhere. (Start session.)
- **Takeovers** — full-attention flows that block the shell. (Connect / Pairing.) `HudTakeover`.
- **Settings** — calm, grouped configuration. The `HudSettings*` family. Two tiers: app-wide and per-agent.

Cross-cutting: capability-first (every surface consumes `ScoutBrokerClient`, so real↔mock is a one-line swap); restrained palette (green is the one accent); shared contracts with macOS above/below the transport.

## HudsonKit leverage

What we adopt from the system, and where:

| HudsonKit | Where Scout uses it |
| --- | --- |
| `HudPhoneAppShell` complications (5-zone) | Ambient chrome: top-left identity, top-right connection chip, (center reserved for Inbox badge) |
| `HudLiquidBar(tabs:)` | Primary tab bar: Home · New · Tail |
| `HudTakeover` | Connect + Pairing full-attention flows |
| `HudSettings*` + `HudSettingsQuickNav` | App Settings **and** per-agent Session Settings — the centerpiece |
| `HudListRow` (dense, tinted, chevron) | Fleet rows, Tail rows — interactive lists |
| `HudSettingsRow` (calm, flat icon) | Settings rows — distinct calmer vocabulary |
| `HudCard` / `HudInset` / `HudKVRow` | Detail panels, metadata blocks |
| `HudQRScanner` | Pairing (camera) — with the camera-free link path beside it |

## Screen graph

```
App
├─ [unpaired]  Connect (phase gate)                                  ✅
│     └─ Pairing  — QR scan · paste link · scout:// deep link    ✅  (→ HudTakeover ⬜)
│
└─ [paired]  Shell  (HudPhoneAppShell)                               ✅
      ├─ complications (ambient chrome)
      │     top-left:   Scout identity                 🟡 (title bar today → complication ⬜)
      │     top-right:  ● connection chip → Connection 🟡 (title bar today → complication ⬜)
      │     center:     Inbox badge (approvals count)  ⬜
      │
      ├─ LiquidBar tabs
      │     Home / Fleet  — search · agents · sessions           ✅
      │           └─ tap row ──push──▶ Conversation              ✅
      │           └─ agent detail ──push──▶ Agent Detail         ⬜
      │     New  — compose → Start ──push──▶ Conversation        ✅
      │     Tail — firehose → tap ──push──▶ Conversation         🟡 (mock)
      │
      ├─ push: Conversation  (read + steer)                      ✅
      │     header ⚙ ──push──▶ Session Settings                  ⬜
      │     steer: send · answer question · approve/deny · interrupt  ✅ (interrupt UI ⬜)
      │
      ├─ push: Agent Detail                                      ⬜
      │     identity · status · project · session list
      │     └─ Session Settings (per-agent)                      ⬜
      │
      ├─ entry: App Settings  (gear complication / Connection chip) ⬜
      │     HudSettingsQuickNav + grouped sections (below)
      │
      └─ planned: Inbox / Approvals  (4th tab or center complication) ⬜
            mobile.inbox · approve/deny queue · push (APNS)
```

## Settings architecture (the HudSettings centerpiece)

Two tiers, both built from `HudSettingsSection` + `HudSettingsRow`/`ControlRow`/
`PickerRow`/`SliderRow`, with `HudSettingsQuickNav` anchoring the longer one.

### App Settings ⬜ — global, via the gear complication

`HudSettingsQuickNav` anchors: CONNECTION · ROUTES · IDENTITY · NOTIFICATIONS · APPEARANCE · ADVANCED · ABOUT

- **CONNECTION** — paired Mac, live route, Reconnect, Re-pair, Forget bridge. (Folds in today's `ConnectionView`.)
- **ROUTES** — toggles `scout.tsn.enabled` (on) / `scout.osn.enabled` (off); LAN→TSN→OSN priority legend; connect timeout (slider).
- **IDENTITY** — this device's name (the `primaryName` used at pairing), public-key fingerprint.
- **NOTIFICATIONS** — approvals alerts, push/APNS (when entitlements land).
- **APPEARANCE** — theme (dark for now), type scale.
- **ADVANCED** — connection log, diagnostics, reset/forget all data.
- **ABOUT** — version, build, links.

### Session Settings ⬜ — per-agent, via the conversation header gear or Agent Detail

Anchors: AGENT · EXECUTION · SESSION · ACTIONS

- **AGENT** — name, harness, model (`HudSettingsPickerRow`), persistence (sticky/fresh), project path.
- **EXECUTION** — branch / worktree, profile, approval policy (auto-approve toggle, risk threshold slider).
- **SESSION** — title, status, created, message count (`HudKVRow`).
- **ACTIONS** — interrupt current turn, start fresh session (same agent), close.

This is the literal "session settings" surface — and the place HudsonKit's settings vocabulary earns its keep.

## Build order (burn-down)

1. ✅ Nav spine: Connect gate, 3-tab shell, conversation-as-push, connection chrome.
2. ✅ Fleet landing (Home): search, refresh, status badges, tap-through.
3. ⬜ **App Settings** surface — `HudSettings*` + QuickNav; fold in `ConnectionView`; reach via a gear complication.
4. ⬜ **Session Settings** surface — same family, per-agent; reach from the conversation header.
5. ⬜ Move identity + connection chip into `HudPhoneAppShell` complications (retire the hand-rolled title bar).
6. ⬜ **Agent Detail** push (identity + sessions + settings entry).
7. ⬜ Promote Connect/Pairing to `HudTakeover`.
8. ⬜ **Inbox / Approvals** — 4th tab or center complication w/ badge; APNS push.
9. 🟡 Polish New + Tail to the fleet-landing bar.

## Open decisions

- **Settings entry point** — gear complication (top-left) vs a 4th LiquidBar tab vs folded into the connection chip. Leaning complication: keeps the 3-tab bar clean and uses a recent shell capability.
- **Inbox placement** — 4th tab vs center complication with a count badge. Leaning center complication until approvals volume justifies a tab.
- **Complications vs title bar** — adopt the 5-zone system now (richer, native) or keep the simple title bar until Settings lands. Leaning: adopt when we build App Settings (step 3/5 together).
