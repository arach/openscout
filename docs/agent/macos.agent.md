# macOS App Agent Notes

Verified: 2026-07-14

Source: `apps/macos/**`, `packages/scout-native-core/**`.

Status: native macOS shells after the target restructure (40b5f862..568b6898). Complements `broker.agent.md` (records) and `runtime-sessions.agent.md` (lifecycle).

## Role

One SwiftPM package, two executables. **Scout** is the product: main window (comms/agents/tail/repos) plus the HUD overlay panel it hosts. **OpenScoutMenu** (bundle `ScoutMenu.app`, id `app.openscout.scout.menu`) is a thin supervision helper: menu-bar service lights, broker/pairing/web restart, Tailscale, signed `scout://services` links, and wake/forward into Scout. All product data flows through one shared layer, `ScoutAppCore`.

## Targets

| Target | Kind | Depends on | Owns |
|---|---|---|---|
| `ScoutAppCore` | lib | ScoutNativeCore | endpoints (`ScoutWeb`/`ScoutBroker`), comms/tail/activity models + clients, `ScoutTailStore`, `ScoutAgentsStore`, `ScoutActivityStore`, `ScoutComposeService`, `ScoutRunnerService`, `ScoutHTTP`, `ScoutServiceURLRelay` |
| `ScoutSharedUI` | lib | HudsonVoice, ScoutNativeCore | markup parser, message/code-block atoms, suggestions, `ScoutVoiceService` (wraps `HudDictation`) |
| `ScoutHUD` | lib | ScoutAppCore, ScoutSharedUI | `HUDController`, `TailModeController`, `OverlayPanelShell`, `HotkeyManager`, `ScoutHUDRouter`, `HUDStateFile`, `TailModeStateFile`, HUD tab views + dock, Tail mode surface |
| `Scout` | exe (`app.openscout.scout`) | all above + HudsonShell, HudsonUI | main window (`ScoutRootView`), `ScoutCommsStore`, `ScoutRepoStore`, HUD hosting, scout:// handler |
| `OpenScoutMenu` | exe (`app.openscout.scout.menu`) | ScoutAppCore, ScoutHUD, ScoutSharedUI (declared; HUD used for input ingress + routing) | `BrokerService`, `PairingService`, `TailscaleService`, `CommandRunner`, `OpenScoutToolchain`, `HUDURLRouter`, `ScoutAppBridge`, task hotkey/hot-corner ingress |

External: `packages/scout-native-core` (`ScoutNativeCore` + `ScoutCapabilities`); Hudson resolved via `OPENSCOUT_HUDSON_SOURCE` = `path` (default, `../../../hudson`) or `git`.

## Endpoints (one resolver)

`ScoutAppCore/ScoutEndpoints.swift` is the only reader of `~/.openscout/config.json`.

| Endpoint | Resolution order | Fallback |
|---|---|---|
| `ScoutWeb.baseURL()` | `OPENSCOUT_WEB_URL` / `_WEB_BUN_URL` / `_WEB_PORT` env → host-info local web service → config `ports.web` | `http://127.0.0.1:43120` |
| `ScoutBroker.baseURL()` | `OPENSCOUT_BROKER_URL` / `_BROKER_PORT` env → config `ports.broker` | `http://127.0.0.1:43110` |

Hosts `0.0.0.0`/`::` normalize to `127.0.0.1` client-side. `43110` is the real default broker port, not a sentinel. scoutd never reads the config file — the helper forwards `OPENSCOUT_BROKER_*` env (from `ScoutBroker.configuredEndpoint()`) when invoking it, unless the environment already pins a target.

Clients: comms/activity/compose/runner and rich agent reads hit web `api/*`; the
bounded HUD agent roster subscribes to scoutd's native read projection over the
probe Unix socket and falls back to web summary reads when that service is absent.
Tail hits broker `v1/tail/*`.

## Relations

```plaintext
ScoutNativeCore ← ScoutAppCore ← ScoutHUD ← Scout (+ ScoutSharedUI, HudsonShell/UI)
                  ScoutAppCore ←──────────── OpenScoutMenu (+ ScoutHUD for hotkey/router)
HudsonVoice ← ScoutSharedUI ← {ScoutHUD, Scout}
Scout.app  — embeds + autolaunches → Contents/Library/LoginItems/ScoutMenu.app
helper     — wakes/launches Scout via ScoutAppBridge (NSWorkspace + launch args)
```

## IPC / scout:// scheme

Both bundles register `scout` (Info.plist + ScoutInfo.plist); routing is bidirectional:

| Channel | Direction | Semantics |
|---|---|---|
| `scout://hud/{show,hide,toggle,tail[/size],tab/<name>,size/<name>,task[/corner]}` | OS → either bundle | Scout handles directly (`ScoutHUDRouter`); helper persists commands to the acknowledged inbox, then wakes or launches Scout. `hud/tail` selects HUD tab 3; `hud/task` opens the fresh-task composer and optionally anchors it to a screen corner. |
| `scout://tail/{show,hide,toggle,attach,float,size/<name>,collapse,expand}` | OS → either bundle | Scout handles directly; helper forwards as Tail mode commands. Tail mode is the persistent attach/free overlay. |
| `scout://services/restart/{broker,relay,web,all}` | OS → either bundle | helper executes after HMAC verify; Scout forwards via `app.openscout.scout.service-url` notification |
| `app.openscout.scout.hud` (distributed notif) | helper → Scout | Wake signal for the acknowledged HUD command inbox; direct `command` + `value` remains compatible. Scout also accepts `channel`/`open-channel`. |
| temp `openscout-hud-command-inbox/` | helper → Scout | Atomic per-command files survive the process-visible/observer-ready launch gap; Scout acknowledges after dispatch. |
| launch args `--hud --hud-command drain-inbox` / `--channel <cId>` | helper → cold Scout | Cold HUD launches use accessory policy, then drain the durable inbox. |
| `/tmp/openscout-hud-state.json` | Scout → external | `HUDStateFile` mirror: visible/tab/size/windowId/ts (the query side of the HUD API) |
| `/tmp/openscout-tail-state.json` | Scout → external | `TailModeStateFile` mirror: visible/size/collapsed/placement/windowId/ts |
| `/tmp/openscout-hud-window.txt` | Scout → external | window id for `screencapture -l` |
| `/tmp/openscout-tail-window.txt` | Scout → external | Tail mode window id for `screencapture -l` |

Services-link HMAC: query `expires`+`nonce`+`sig`; SHA256 HMAC over `v1\nservices\n<action>\n<target>\n<expires>\n<nonce>`, key = base64url file `~/Library/Application Support/OpenScout/service-link-signing.key` (`OPENSCOUT_SUPPORT_DIRECTORY` override); expiry must be within +120s; timing-safe compare.

## Lifecycle & keyboard

| Behavior | Detail |
|---|---|
| Activation policy | Scout starts `.regular`; `--hud` launch starts `.accessory` and hides non-panel windows; last window close → `.accessory`, never terminates; reopen → `.regular` |
| Hotkeys (Carbon, sig `OSCT`) | Scout id 1: Hyper+H → HUD toggle. Helper id 2: Hyper+C → `openComms`; id 3: Hyper+T → Tail mode; id 4: Hyper+A → new agent task. |
| Task hot corner | Helper defaults to bottom-left with a 420ms hover dwell; dragging reveals an immediate nonactivating drop receiver. Right-click the menu icon → Task Hot Corner to choose any corner or Off. The chosen physical corner applies on every display, and the triggering display id is preserved for HUD placement. Bounded transient payloads plus the acknowledged command inbox carry cold-start drops to Scout; promised files from apps such as Mail and Photos are materialized in private TTL staging. The helper never hosts the composer. |
| Quick task confirmation | A fresh task opened directly from the menu helper requires an explicit project choice; capture drops may still infer their project from the captured files. After the broker accepts the task, the composer stays open on a durable receipt showing project, runtime/model, effort, and a broker reference, with **Open task** and **Done** actions. |
| HUD panel | `HUDController` singleton; non-activating `OverlayPanel`, mouse-screen centered, fade in/out, outside-click dismiss (220ms), Esc cascade (cheatsheet → dock text → chip → blur → unengage → dismiss) |
| HUD keys | one shared `handleKeyDown` for panel `onKeyDown` + global monitor; global path gated by `shouldHandleGlobalKey` (Esc always; else panel key / app active). Tabs 1-4 = focus/threads/tail/scout; sizes compact/medium/large via `[`/`]`/⌘-arrows |
| Tail mode | `TailModeController` singleton; separate non-activating `OverlayPanel` using the shared `HUDTailView` tail logic with the overlay skin/wrapper. Persistent by default, no outside-click dismiss. Placement can be attached to the nearest edge or free-floating. |
| Main-window keys | `ScoutKeyboardEventMonitor` (local NSEvent monitor) offers Esc + bare keys to `HUDController.handleHostKeyDown` first while HUD visible; only unclaimed events drive window navigation |

## Data flow

| Store | Target | Cadence | Notes |
|---|---|---|---|
| `ScoutTailStore` | ScoutAppCore | 1.4s poll; discovery sub-fetch ≤ 1/30s | merge-by-id, 700-event cap; feeds Tail surface + HUD tail |
| `ScoutAgentsStore` | ScoutAppCore | push stream; 2.0s reconnect/fallback | Summary mode uses scoutd NDJSON over UDS; rich mode remains web-backed |
| `ScoutActivityStore` | ScoutAppCore | 2.0s | HUD focus (RECENT section) |
| `ScoutComposeService` | ScoutAppCore | SSE reply stream | shared compose/route/assistant thread |
| `ScoutCommsStore` | Scout | adaptive: 2.5s working / 10s idle / 30s error backoff | main-window channels/messages/agents; selected live sessions get a default inline rolling activity summary, flight-backed when available and observe-backed for organic harness turns |
| `ScoutRepoStore` | Scout | 30 min (manual refresh primary) | shells out to git per worktree |

Discipline: every store publishes through `setIfChanged`/`scoutSetIfChanged` (no-op writes don't fire `objectWillChange`); pollers run only between `start()`/`stop()`, gated by visibility (`syncScopedStoreLifecycles`: tail only on Tail section sans modal, repos only on Repos; HUD stores start/stop with panel appear/disappear). High-churn tail is held in `ScoutFeeds`, a non-publishing box in `ScoutRootView`, so only leaf observers re-render.

## Build & tooling

| Task | Command |
|---|---|
| dev build | `cd apps/macos && bun bin/scout-app.ts dev-build` (path Hudson, debug; `dev` also relaunches) |
| release-ish build | `bun apps/macos/bin/scout-app.ts build` (git Hudson, release) |
| raw swift | `HUDSONKIT_WITH_TERMINAL=1 swift build` — enables the native Hudson/Termini terminal surface |
| helper bundle | `bun apps/macos/bin/openscout-menu.ts build|launch|restart|status` |
| HUD CLI | `bun apps/macos/bin/openscout-menu.ts hud state|show|hide|toggle|tail [s]|tab <t>|size <s>|task [corner]|capture|matrix` (actions target the helper bundle via `open -g -b app.openscout.scout.menu scout://hud/*`; queries use the state file; `capture` is the screenshot command) |
| Tail CLI | `bun apps/macos/bin/openscout-menu.ts tail state|show|hide|toggle|attach|float|size <s>|collapse|expand|capture` (actions target the helper bundle; queries use the state file) |
| installer | `apps/macos/scripts/build-dmg.sh` → Hudson `hkit` (`HUDSON_DIR`/`HKIT_BIN`), contract `hudson-package.json`, embeds ScoutMenu.app under LoginItems; `SKIP_NOTARIZE=1` for local |

## Invariants

1. One endpoint resolver: all web/broker URLs go through `ScoutWeb`/`ScoutBroker`; nothing else reads `~/.openscout/config.json` or hardcodes ports.
2. `0.0.0.0`/`::` config hosts always normalize to `127.0.0.1` before use as a client target.
3. One data layer: any store/client/model used by more than one target lives in `ScoutAppCore`. The HUD is a presentation of those stores, never a parallel implementation.
4. Stores publish via `setIfChanged` and are visibility-gated — every `start()` has a `stop()` tied to a surface being on screen.
5. Scout hosts the HUD and Tail mode panels. Scout owns Hyper+H; the helper owns Hyper+A/C/T plus the task hot-corner ingress. Helper commands first enter the durable, acknowledged inbox; notifications wake warm Scout and launch args wake cold Scout. The helper may receive a drop but never hosts the task UI.
6. Main-window keyboard yields to a visible HUD before handling bare-key navigation.
7. `scout://services/*` executes only in the helper and only with a valid, unexpired HMAC signature; Scout forwards, never executes.
8. Scout never terminates on last-window close — it flips `.regular` ↔ `.accessory`.
9. The helper stays supervision-only: service lights, restarts, pairing, Tailscale, wake-Scout.
10. The bounded HUD agent roster must not require the web process or request a full broker snapshot; native failure may use the bounded web summary as a compatibility fallback.

## Forbidden

- Read `~/.openscout/config.json` (or invent a default port) anywhere outside `ScoutEndpoints.swift`.
- Add product surfaces (comms/chat/tail UI) to `OpenScoutMenu` — it was just stripped of them (924a88d4).
- Duplicate a ScoutAppCore store per target, or give the HUD its own fetch path when a shared store exists.
- Assign `@Published` values directly in poll loops, bypassing `setIfChanged`.
- Window-lifetime pollers: `start()` without a visibility-gated `stop()`.
- Handle `scout://services` terminally in Scout, or `scout://hud` terminally in the helper.
- Grow helper dependencies toward HudsonShell/HudsonUI or anything heavier than the hotkey/router slice of ScoutHUD it actually uses.

## Code map

| Concern | Path (under `apps/macos/`) |
|---|---|
| Targets/products | `Package.swift` |
| Endpoint resolution | `Sources/ScoutAppCore/ScoutEndpoints.swift` |
| Shared stores/clients | `Sources/ScoutAppCore/Scout{Tail,Agents,Activity}Store.swift`, `ScoutComposeService.swift`, `ScoutRunnerService.swift` |
| Native agent read stream | `Sources/ScoutAppCore/ScoutNativeReadClient.swift`, `ScoutdProbeClient.swift` |
| App entry, scheme + lifecycle | `Sources/Scout/ScoutApp.swift` |
| Window shell + feeds box + key yield | `Sources/Scout/ScoutRootView.swift`, `ScoutCommands.swift` |
| HUD panel + keys | `Sources/ScoutHUD/HUDController.swift`, `OverlayPanelShell.swift`, `HotkeyManager.swift` |
| Quick task + hot corner | `Sources/ScoutHUD/HUDRunner{State,View}.swift`, `HUDCaptureHotZone.swift`, `Sources/ScoutAppCore/ScoutCapturePayload.swift` |
| Tail mode panel | `Sources/ScoutHUD/TailModeController.swift`, `HUDTailView.swift` |
| HUD/Tail external API | `Sources/ScoutHUD/ScoutHUDRouter.swift`, `HUDStateFile.swift`, `TailModeStateFile.swift` |
| Helper ingress + HMAC | `Sources/ScoutMenu/Services/HUDURLRouter.swift`, `ScoutAppBridge.swift` |
| Helper supervision | `Sources/ScoutMenu/OpenScoutAppController.swift`, `Services/{Broker,Pairing,Tailscale}Service.swift`, `OpenScoutToolchain.swift` |
| Tooling | `bin/scout-app.ts`, `bin/openscout-menu.ts`, `scripts/build-dmg.sh`, `hudson-package.json` |

## Verification

```bash
cd apps/macos && bun bin/scout-app.ts dev-build      # debug build (path Hudson, voice on)
bun apps/macos/bin/openscout-menu.ts hud state        # reads /tmp/openscout-hud-state.json
bun apps/macos/bin/openscout-menu.ts hud show
bun apps/macos/bin/openscout-menu.ts hud task             # direct task composer
bun apps/macos/bin/openscout-menu.ts hud task bottom-left # corner-anchored
bun apps/macos/bin/openscout-menu.ts hud tail         # selects embedded HUD Tail
bun apps/macos/bin/openscout-menu.ts tail show
bun apps/macos/bin/openscout-menu.ts tail float
bun apps/macos/bin/openscout-menu.ts hud capture /tmp/hud.png
open -g 'scout://hud/toggle'                          # scheme ingress, either bundle
open -g 'scout://tail/toggle'                         # Tail mode ingress, either bundle
```

Expect: build succeeds without plain `swift build` voice failures; `hud state` reflects each action within ~1s.
