# Pairing relay 30s flap — diagnosis (2026-08-03)

**Verdict:** Mac runtime/lifecycle bug. Not an iOS app regression. The iPhone is
behaving correctly; it just has a ~5-second window every ~30 seconds in which
anything is listening.

## Symptom

- iOS Connection screen: `0/1 paired Macs`, `NSURLErrorDomain -1004` against both
  `ws://192.168.18.22:43131` and `arts-mac-mini.tail1e8e67.ts.net`.
- `~/.scout/pairing/bridge.log`: managed relay starts, then stops ~5s later, then
  restarts ~25s after that. Period ~30s, duty cycle ~1/6.

## Root cause

`ScoutMenu` (pid 21605, the LoginItem menu-bar helper) carries a **stale
`OPENSCOUT_PARENT_PID=21482` in its own environment**, inherited from the
`Scout.app` instance that launched it on 2026-08-02 18:47. **Pid 21482 is dead.**

`CommandRunner.mergedEnvironment` (`apps/macos/Sources/ScoutMenu/Services/CommandRunner.swift:115`)
builds the child environment from `ProcessInfo.processInfo.environment` merged with
descriptor overrides. `pairingRuntimeEnvironment()`
(`apps/macos/Sources/ScoutMenu/Services/OpenScoutToolchain.swift:276`) set mesh and
relay vars but **did not set `OPENSCOUT_PARENT_PID`** at the time of this incident,
so the stale `21482` passed straight through to the pairing runtime controller.

The controller then watches that dead pid:

- `pairing-runtime-controller.ts:339` `startParentProcessWatch` polls every
  `SCOUT_PAIR_PARENT_WATCH_INTERVAL_MS = 5_000` (`:33`).
- First tick at T+5s finds 21482 gone → `shutdown()` (`:85`) → stops bonjour,
  runtime, relay → writes `status: "stopped" / "Scout pair mode is stopped."`
  (`:94-102`) → `process.exit(0)`.
- ScoutMenu's supervisor respawns it ~25s later. Loop repeats forever.

### Evidence

| Observation | Value |
|---|---|
| Child process | `bun packages/cli/dist/pairing-runtime-controller.mjs` |
| Actual PPID | 21605 — `ScoutMenu`, **alive** since Aug 2 18:47 |
| `OPENSCOUT_PARENT_PID` in child env | **21482** |
| Pid 21482 | **dead** |
| `ScoutMenu` own env | also `OPENSCOUT_PARENT_PID=21482` (inherited) |
| `runtime.json` at T+0 | `status=connected`, `lanDiscoveryAdvertised=true`, full pairing payload |
| `runtime.json` at T+5s | `status=stopped`, `pairing=null`, `relay=null` |
| `startedAt` → `updatedAt` | 1785769421111 → 1785769426124 = **5013 ms** |

The 5013 ms delta and the verbatim `"Scout pair mode is stopped."` string match the
`shutdown()` path exactly — this is a clean intentional shutdown, not a crash.

**The phone works.** At 14:55:45 — 4s into a live window — the iPhone connected and
successfully served `mobile.endpoints`, `mobile.inbox`, `mobile.agents`,
`mobile.activity`, `mobile.commsConversations`, `mobile.runtimeCapabilities`. It was
cut off mid-`mobile.serviceBudgets` when the relay stopped at 14:55:46. `-1004` is
`NSURLErrorCannotConnectToHost` (nothing listening), not a DNS/resolve failure —
consistent with the phone dialing during one of the 25s dead windows.

## Secondary, independent issue: Tailscale TLS

```
tailscale cert failed; using insecure websocket tailnet relay
500 Internal Server Error: your Tailscale account does not support getting TLS certs
```

HTTPS certs are not enabled for this tailnet. The code handles this correctly:
`resolveRelayEndpoint` falls back to plain `ws://` and still advertises
`ws://arts-mac-mini.tail1e8e67.ts.net:43131` as a fallback relay. This is a tailnet
account/ACL setting (enable HTTPS in the Tailscale admin console), **not** a code
defect, and **not** the cause of the flap. Note it re-shells `tailscale cert` on
every restart — 567 times in the recent log — purely as a side effect of the flap.

## Fix

**Shipped (Swift, correctness at the source):** `pairingRuntimeEnvironment()` now
sets `env["OPENSCOUT_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)`
so the child watches the native process that actually owns it, regardless of what
pid the app itself inherited. Applied to both
`Sources/ScoutMenu/Services/OpenScoutToolchain.swift` and the `ScoutAppCore` copy.

**Proposed follow-up (TS — not implemented):** in
`readParentProcessId()` (`pairing-runtime-controller.ts:355`), ignore a parent pid
that is **already dead at startup**. If the parent is gone before the watch even
begins, the value is a stale inherited env var, not a parent that died — so the
watchdog should not arm.

```ts
return Number.isInteger(parentPid) && parentPid > 0 && parentPid !== process.pid
  && isProcessRunning(parentPid)   // <- add: don't arm on an already-dead pid
  ? parentPid
  : null;
```

The controller today has no such guard; it arms the watch on whatever pid the env
supplies. If picked up, note this file exists in three copies that must stay in
sync: `apps/desktop/src/core/pairing/`, `packages/web/server/core/pairing/`, and
the built `packages/cli/dist/pairing-runtime-controller.mjs` (what actually runs).

The Swift change makes the watchdog correct at the source; the TS guard would
additionally make it safe against any future stale-env spawner.

## Immediate operator unblock (no code change)

Quit and relaunch `ScoutMenu` so it starts with a clean environment. A fresh launch
has no `OPENSCOUT_PARENT_PID`, `readParentProcessId()` returns `null`, the parent
watch never arms, and the relay stays up.

## Also worth noting

`console.log`/`console.error` from the pairing controller go nowhere — it is spawned
with `stdio: "ignore"` / `FileHandle.nullDevice`. The
`[pairing-runtime-controller] parent N is gone; exiting` line that would have made
this a 10-second diagnosis is discarded. Routing controller stderr into
`bridge.log` would pay for itself.
