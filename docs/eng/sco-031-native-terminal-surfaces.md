# SCO-031: Native Terminal Surfaces

## Status

Proposed.

## Proposal ID

`sco-031`

## Intent

Add terminal power to Scout without turning terminal scrollback into Scout's
product model.

This proposal defines two related but separate terminal surfaces:

1. **OpenScout Vantage for macOS**: a native multi-terminal operator canvas
   launched from Scout with local machine context.
2. **Scout iOS Terminal**: a lightweight native SSH terminal for taking over a
   paired machine from iPhone or iPad.

The two surfaces should share Scout's machine, pairing, and runtime context,
but they should not share a UI dependency or force iOS to carry Hudson Vantage.

## Motivation

Scout already has broker-owned coordination records, runtime endpoints, tmux
sessions, mobile pairing, and observed tail data. Operators can ask, approve,
watch, and route through Scout, but when they need a real terminal they still
fall out to separate tools.

That creates two gaps:

- On macOS, Scout can know which agents, tails, and work items matter, but it
  cannot open a dense native operating surface that shows those live local
  terminals together.
- On iOS, Scout can pair with a machine and send messages, but it cannot provide
  direct SSH takeover for system-level work.

These are different product needs. The macOS surface is an operating canvas.
The iOS surface is focused remote shell access.

## Decision

OpenScout should implement native terminal support through two tracks.

### Track A: OpenScout Vantage On macOS

Scout should own the launch context. Hudson Vantage should own the native
canvas and terminal rendering.

Scout should add a `vantage` descriptor/launcher layer that reads broker
snapshot state, local agent config, debug attach metadata, and tail discovery,
then writes a `hudson.vantage.setup` manifest under an OpenScout-owned support
directory such as:

```text
~/Library/Application Support/OpenScout/vantage/
```

The first version should launch a separate native app, `OpenScoutVantage.app`,
rather than embedding Vantage into the existing menu bar app. The menu app can
be the jump-off point, but it should stay lightweight.

Recommended commands:

```sh
scout vantage plan --json
scout vantage open
```

`scout vantage plan --json` should be pure TypeScript and produce the manifest
plus diagnostics: selected agents, attachable tmux targets, tail sessions that
would be created, missing tmux sessions, and static artifact nodes.

`scout vantage open` should ensure runtime health, write the manifest, launch
`OpenScoutVantage.app`, and queue a setup command against Vantage's control API.

Vantage nodes should be modeled as:

| Scout material | Vantage node |
| --- | --- |
| tmux-backed agent endpoint | `runtimeKind: "tmux"` with `target` set to the tmux session or pane |
| log or tail stream | Scout-owned tmux session running `tail -F`, attached as a tmux node |
| plan/work item/note | `runtimeKind: "plan"` or `"note"` |
| diff or running patch | `runtimeKind: "diff"` |
| source artifact | `runtimeKind: "file"` |

Vantage must consume Scout context. It should not independently discover Scout
broker state, parse harness transcripts, or scan tail files.

### Track B: Scout iOS Terminal

Scout iOS should add a focused SSH terminal surface using `Termini` and
`TerminiSSH`.

This is not Hudson Vantage on iOS. It is a small terminal product surface:

- saved machines
- one active terminal at a time
- native terminal rendering
- SSH transport
- Keychain-backed credentials
- startup profiles for shell, Scout, tmux, logs, and custom commands

Talkie's mobile terminal should be the UX and storage donor, but Scout should
rebuild the implementation on Termini rather than carrying the older
TermBridgeKit surface.

Suggested iOS model:

```swift
ScoutTerminalSavedHost
ScoutTerminalStartupProfile
ScoutTerminalStore
ScoutTerminalKeychainStore
```

Suggested startup profiles:

| Profile | Startup command |
| --- | --- |
| Login shell | empty |
| Scout tmux | `tmux new -A -s scout` |
| Scout status | `scout ps` |
| Logs | configured `tail -F ...` |
| Custom | user-provided command |

The iOS route model should add terminal routes to `ScoutRouter`, with entry
points from Fleet, Node detail, and a Terminal tab or overflow action.

### Track C: Pairing-Managed SSH Credentials

Scout pairing should provision and manage SSH credentials, but the pairing
Noise key must not become the SSH key.

There are three separate trust domains:

| Domain | Purpose | Storage |
| --- | --- | --- |
| Scout Noise key | Authenticate the paired bridge/control channel | existing Scout Keychain/filesystem identity stores |
| iOS SSH key | Authenticate shell access to a machine | new iOS Keychain terminal credential store |
| SSH host key pin | Verify the machine being reached by SSH | new iOS host-key pin store |

Provisioning flow:

1. iOS pairs with Scout using the existing Noise bridge.
2. iOS generates a fresh SSH Ed25519 keypair locally.
3. iOS sends only the OpenSSH public key over the authenticated bridge.
4. Desktop asks the operator to approve terminal access for this device.
5. Desktop appends a Scout-managed public key line to
   `~/.ssh/authorized_keys`.
6. Desktop returns connection candidates and SSH host public key fingerprints.
7. iOS stores the private key and host key pins in Keychain.

Managed `authorized_keys` lines should be machine-readable so revoke and rotate
do not touch unrelated keys:

```text
ssh-ed25519 AAAA... scout-ios-terminal credential=<id> device=<deviceId> bridge=<bridgePublicKey> created=<iso>
```

Recommended bridge routes:

```text
ssh.status
ssh.provision.request
ssh.provision.confirm
ssh.credentials.list
ssh.credentials.revoke
ssh.credentials.rotate
ssh.credentials.repair
ssh.hostKeys.get
ssh.hostKeys.updatePin
vantage.handoff
```

Sensitive SSH routes should require the authenticated Noise WebSocket context.
They should not be exposed through an unauthenticated or header-trusted HTTP
adapter.

## Boundaries

Terminal output is external runtime material. It must not be imported as Scout
messages, turns, or first-party conversation records.

Scout-owned records remain broker-owned: messages, invocations, flights,
deliveries, bindings, questions, work items, and operator approvals.

Vantage state is UI/layout state. SSH credentials are device/machine access
state. Neither replaces the broker's session model.

This proposal does not claim enterprise security, compliance readiness, or
multi-tenant hardening. It fits Scout's current high-trust local pilot posture.

## Implementation Plan

### Phase 1: Vantage Descriptor

- Add `scout vantage plan --json`.
- Build Vantage manifests from broker snapshot, local-agent config, tmux debug
  attach metadata, and tail metadata.
- Include diagnostics for missing tmux, missing sessions, and non-attachable
  endpoints.
- Keep this phase UI-free.

### Phase 2: OpenScout Vantage App

- Add a small native Swift app that hosts `HudVantageSurface`.
- Build it with Hudson terminal support enabled.
- Use OpenScout-owned command, response, state, and manifest paths.
- Launch it from `scout vantage open`.
- Add a menu-bar jump-off action after CLI launch works.

### Phase 3: iOS Terminal Skeleton

- Add Termini and TerminiSSH to the iOS project.
- Add terminal route, host picker, and focused terminal screen.
- Add terminal saved-host and Keychain stores.
- Support manual host entry first if bridge provisioning is not ready.

### Phase 4: Pairing Credential Provisioning

- Add bridge SSH routes.
- Generate SSH keys on iOS.
- Install/revoke/rotate public keys on desktop with operator approval.
- Add host-key pinning and mismatch handling.
- Add machine candidates from paired bridge, Fleet, Tailscale/LAN hints, and
  later mesh node metadata.

### Phase 5: Product Hardening

- Add startup profiles for Scout/tmux/log workflows.
- Add security events for provision, revoke, rotate, host key mismatch, Remote
  Login disabled, and Vantage handoff.
- Add focused tests for manifest planning, authorized key editing, and iOS
  terminal storage.
- Decide whether `OpenScoutVantage.app` stays separately shipped or becomes an
  optional companion app inside the macOS distribution.

## References

- `packages/protocol/src/debug-attach.ts`
- `docs/eng/sco-025-observer-grade-local-runtime-visibility.md`
- `docs/eng/sco-030-claude-code-tmux-personal-dev-transport.md`
- `apps/desktop/src/app/host/agent-session.ts`
- `apps/desktop/src/core/pairing/runtime/bridge/router.ts`
- `apps/ios/Scout/Security/Identity.swift`
- Sibling Hudson: `examples/termini-canvas/README.md`
- Sibling Hudson: `packages/native/apple/HudsonKit/Sources/HudsonVantage/HudVantageSurface.swift`
- Sibling Termini: `README.md`
- Sibling Talkie: `apps/ios/Talkie iOS/SSH/`

## Open Questions

- Should `OpenScoutVantage.app` live under `apps/macos`, `apps/vantage`, or a
  sibling package until packaging is settled?
- Should Termini expose public host-key store APIs before Scout iOS terminal
  ships, or should Scout start with TerminiSSH's current trust behavior?
- Should SSH credential records live only on iOS and the Mac filesystem, or
  should the broker also expose redacted credential status for Fleet views?
- Should the first iOS terminal profile attach to a generic `scout` tmux
  session or route through agent-specific debug attach descriptors?
