# SCO-071: iOS Terminal over the OpenScout Relay (SSH-in-bridge tunnel)

## Status

Proposed — green-lit for build. Bridge-transport seam gates the rest.

## Proposal ID

`sco-071`

## Date

2026-06-21

## Intent

Let the iOS terminal work when the phone has **only** the OpenScout relay path to
the Mac (cellular, no shared LAN or tailnet) — without weakening the existing
SSH key-auth + pinned-host-key model. Carry the SSH byte stream **inside** the
already-paired, Noise-encrypted bridge instead of opening a direct TCP socket to
the Mac.

## Problem

The terminal SSHes directly to a network-reachable Mac address:

- `terminalSSHHost` (`apps/ios/Scout/AppModel.swift:1183`) returns the reached
  host for `.lan` / `.tailnet` / `.loopback`, and **nil** for `.oscout` /
  `.remote`.
- Provisioning hands back `<short>.local:22` (`mobile-terminal-provision.ts:88`),
  reachable only on LAN/tailnet.
- The grant authorizes the device key + pins the Mac host key
  (`ssh-terminal-access.ts`) but returns **no tunnel** — SSH is a plain TCP
  connection, not carried over the relay.

So on the relay route the app/bridge work, but the terminal has nowhere
reachable to land. The bridge, however, already gives us what we need: a
**Noise-encrypted bidirectional WebSocket** that runs locally and over the relay
(`relay-client.ts` → `mesh.oscout.net`), with an event-stream subscription and a
"secure proxy handoff" concept (`fileserver.ts`). Missing piece: a duplex
byte-stream channel.

## Design — SSH-in-bridge tunnel (ProxyCommand pattern)

Keep SSH end-to-end; the bridge is pure transport. **Noise on the outside, SSH on
the inside** (defense in depth). The tunnel only ever targets the Mac's *own*
`127.0.0.1:22` — it is NOT a general TCP/SOCKS proxy.

```
Termini (iOS)  ──TCP──▶  127.0.0.1:<ephem> (iOS listener)
                              │  tunnel.* frames
                              ▼
                     bridge Noise WS  ──relay/local──▶  Mac bridge
                                                            │  net.connect
                                                            ▼
                                                      127.0.0.1:22 (sshd)
```

### Channel protocol (`tunnel.*`, multiplexed by `streamId`)

Rides the existing bridge envelope on the Noise WS; same path local and relay.

- `tunnel.open  { streamId, target: "ssh" }` — phone asks the Mac to open a
  stream to its loopback sshd. `target` is an enum fixed to `"ssh"` (→ 127.0.0.1:22),
  not an arbitrary host/port — this is the security scope.
- `tunnel.data  { streamId, seq, chunk }` — bidirectional payload.
- `tunnel.ack   { streamId, ackedBytes }` — credit-based flow control.
- `tunnel.close { streamId, reason? }` — teardown (either direction).
- `tunnel.error { streamId, code, message }`.

**Framing — DECIDED: base64 chunks inside the existing JSON envelope** (chosen
for resilience, 2026-06-21). Rationale: the dominant resilience factor on flaky
cellular is reusing the already-proven Noise/relay/reconnect message path, not
raw throughput. base64-in-JSON adds **zero new transport framing** — it rides the
same envelope every other bridge message uses, so there is no new binary
frame/deframe path to corrupt across reconnects. Throughput (the only loss) is
bounded by the credit window and tiny interactive payloads; the ~33% expansion is
mitigated by a conservative raw chunk cap (~16 KB → ~22 KB encoded, well under
WS/relay frame limits). `tunnel.data` carries an `encoding` field (`"base64"`
now) so a binary fast-path can drop in later **without changing channel
semantics** — resilient now, optimizable later.

**Backpressure.** Credit window (start ~256 KB). Receiver emits `tunnel.ack` as it
drains (to sshd on the Mac, to Termini on the phone); sender pauses when the
window is exhausted. Required — scrollback bursts over a high-RTT relay will
otherwise unbounded-buffer.

**Lifecycle.** listener accepts → `tunnel.open` → Mac `net.connect(22,"127.0.0.1")`
→ splice both ways with credits → either side closes → tear down socket + stream
+ listener connection. Clean up on app background, network flap, and bridge
reconnect (no leaked localhost:22 sockets on the Mac).

## Seams (the actual work)

1. **Bridge transport + Mac proxy** — `packages/web/server/core/pairing/runtime/bridge/`
   - New `terminal-tunnel.ts`: per-socket `streamId → net.Socket` registry + the
     byte pump + credit accounting.
   - `server-trpc.ts`: dispatch `tunnel.*` in the WS handler (alongside
     `subscription.stop`, ~line 257); push `tunnel.data`/`tunnel.ack` via
     `createSender` (~line 218). On `tunnel.open` → `net.connect(22,"127.0.0.1")`.
   - `relay-client.ts`: confirm tunnel frames traverse the relay WS like events
     (same envelope) — check frame-size limits / fragmentation on the relay.
2. **iOS loopback listener + bridge stream client** — `apps/ios/Scout/`
   - `NWListener` on `127.0.0.1:<ephemeral>`; per inbound connection open a bridge
     tunnel stream and pump bytes ↔ the bridge WS client. Wire the `tunnel.*`
     methods through the bridge RPC plumbing (protocol + `BridgeBrokerClient` +
     `RPCWire` route map — the 3-edit pattern), or a dedicated binary path.
3. **Termini repoint** — `apps/ios/Scout/TerminalSurface.swift:361-392`
   - On a relay route, set `TerminiConnectionConfig.host = "127.0.0.1"`,
     `port = listener.port` instead of `access.host:22`. `hostKeyFingerprint`
     stays the Mac's — the pin is on the key blob, validated end-to-end through
     the tunnel.
4. **Route wiring** — `apps/ios/Scout/AppModel.swift:1183`
   - `terminalSSHHost`: for `.oscout` / `.remote`, return the loopback proxy
     endpoint instead of nil. Keep `.lan` / `.tailnet` / `.loopback` as **direct
     SSH** — only tunnel when there is no direct path; direct stays the fast path.

## Security posture

- Tunnel target is hardcoded to the Mac's own `127.0.0.1:22`, gated by the same
  paired-device authorization as every other bridge method. Not a general proxy.
- SSH still does key-auth + ed25519 host-key pin **inside** the tunnel;
  `authorized_keys` + host-key provisioning are unchanged
  (`mobile-terminal-provision.ts`).
- Bridge Noise wraps the whole thing; the relay sees only ciphertext.

## Risks — verify before committing

1. **Host-key pin vs loopback host.** Confirm NIOSSH/Termini validate the pinned
   fingerprint regardless of hostname (127.0.0.1). Pin is on the key blob, so
   almost certainly yes — verify in Termini's host-key callback.
2. **Binary framing over the relay envelope.** Max frame size / base64 need;
   size the credit window to the relay's MTU + latency.
3. **Interactive latency.** Relay RTT for keystroke echo is the UX risk; tmux
   create-or-attach smooths reconnects but not echo. Measure on real cellular.
4. **Teardown.** No leaked sockets/listeners on background / flap / reconnect.

## Phasing

- **P1 — bridge tunnel channel + Mac localhost:22 proxy** (server-side, testable
  with a loopback/CLI harness; unit the pump + credit logic via the existing
  `router.test.ts` / `fileserver.test.ts` patterns). This is the gate.
- **P2 — iOS listener + bridge stream client.**
- **P3 — Termini repoint + route wiring; end-to-end on cellular** (no LAN/tailnet).

## Next owner

P1 (the bridge tunnel channel + Mac proxy) is self-contained and testable — it
gates P2/P3. Owner: whoever owns the pairing bridge; this agent can take P1 and
hand the iOS seams (P2/P3) to the iOS owner. Decide the framing question (binary
vs base64) first — everything else follows from it.
