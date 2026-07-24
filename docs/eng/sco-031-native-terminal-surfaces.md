# SCO-031: Native iOS Terminal Surface

## Status

Proposed.

## Proposal ID

`sco-031`

## Intent

Add terminal power to Scout without turning terminal scrollback into Scout's
product model.

This proposal defines **Scout iOS Terminal**: a lightweight native SSH terminal
for taking over a paired machine from iPhone or iPad.

## Motivation

Scout already has broker-owned coordination records, runtime endpoints, tmux
sessions, mobile pairing, and observed tail data. Operators can ask, approve,
watch, and route through Scout, but when they need a real terminal they still
fall out to separate tools.

On iOS, Scout can pair with a machine and send messages, but it cannot provide
direct SSH takeover for system-level work.

## Decision

OpenScout should add a focused iOS SSH terminal surface.

### Scout iOS Terminal

Scout iOS should add a focused SSH terminal surface using `Termini` and
`TerminiSSH`.

It is a small terminal product surface:

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

### Pairing-Managed SSH Credentials

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

```plaintext
ssh-ed25519 AAAA... scout-ios-terminal credential=<id> device=<deviceId> bridge=<bridgePublicKey> created=<iso>
```

Recommended bridge routes:

```plaintext
ssh.status
ssh.provision.request
ssh.provision.confirm
ssh.credentials.list
ssh.credentials.revoke
ssh.credentials.rotate
ssh.credentials.repair
ssh.hostKeys.get
ssh.hostKeys.updatePin
```

Sensitive SSH routes should require the authenticated Noise WebSocket context.
They should not be exposed through an unauthenticated or header-trusted HTTP
adapter.

## Boundaries

Terminal output is external runtime material. It must not be imported as Scout
messages, turns, or first-party conversation records.

Scout-owned records remain broker-owned: messages, invocations, flights,
deliveries, bindings, questions, work items, and operator approvals.

SSH credentials are device/machine access state. They do not replace the
broker's session model.

This proposal does not claim enterprise security, compliance readiness, or
multi-tenant hardening. It fits Scout's current high-trust local pilot posture.

## Implementation Plan

### Phase 1: iOS Terminal Skeleton

- Add Termini and TerminiSSH to the iOS project.
- Add terminal route, host picker, and focused terminal screen.
- Add terminal saved-host and Keychain stores.
- Support manual host entry first if bridge provisioning is not ready.

### Phase 2: Pairing Credential Provisioning

- Add bridge SSH routes.
- Generate SSH keys on iOS.
- Install/revoke/rotate public keys on desktop with operator approval.
- Add host-key pinning and mismatch handling.
- Add machine candidates from paired bridge, Fleet, Tailscale/LAN hints, and
  later mesh node metadata.

### Phase 3: Product Hardening

- Add startup profiles for Scout/tmux/log workflows.
- Add security events for provision, revoke, rotate, host key mismatch, and
  Remote Login disabled.
- Add focused tests for authorized key editing and iOS terminal storage.

## References

- `packages/protocol/src/debug-attach.ts`
- `docs/eng/sco-025-observer-grade-local-runtime-visibility.md`
- `docs/eng/sco-030-claude-code-tmux-personal-dev-transport.md`
- `apps/desktop/src/app/host/agent-session.ts`
- `apps/desktop/src/core/pairing/runtime/bridge/router.ts`
- `apps/ios/Scout/Security/Identity.swift`
- Sibling Termini: `README.md`
- Sibling Talkie: `apps/ios/Talkie iOS/SSH/`

## Open Questions

- Should Termini expose public host-key store APIs before Scout iOS terminal
  ships, or should Scout start with TerminiSSH's current trust behavior?
- Should SSH credential records live only on iOS and the Mac filesystem, or
  should the broker also expose redacted credential status for Fleet views?
- Should the first iOS terminal profile attach to a generic `scout` tmux
  session or route through agent-specific debug attach descriptors?
