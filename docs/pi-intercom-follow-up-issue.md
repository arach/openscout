# Issue Draft: Borrow Local Coordination Ideas From Pi Intercom + Pi Messenger

## Summary

OpenScout should borrow a small set of operational ideas from Pi Intercom and
Pi Messenger without replacing the current broker-first durable model.

The useful ideas are mostly about lifecycle, liveness, and local coordination:

- on-demand broker startup
- PID/lock-based duplicate-start protection
- stronger stale-session cleanup
- clearer same-machine delivery and wakeup behavior

The part we should not copy is the file-only transport and registry model.
OpenScout already has a stronger runtime contract built around durable
conversations, invocations, flights, deliveries, activity projections, and
mesh-aware broker routing.

## Problem

OpenScout's local broker is still heavier to start and reason about than it
needs to be for same-machine collaboration.

Today:

- broker startup is service-oriented and `launchd`-driven
- local liveness and stale endpoint cleanup are spread across runtime behavior
- there is no single lightweight "ensure broker is running" entry point
- same-machine callers still mostly reach the broker through the TCP HTTP URL
- local collaboration ergonomics are solving a richer problem than a simple
  same-machine chat room, but we still want the same low-friction feel

The root issue is not transport capability. The root issue is operator and
runtime ergonomics around local coordination.

## What We Learned

Pi Messenger contributes useful local-first ideas:

- simple on-disk presence and inbox semantics
- PID + session-based stale cleanup
- lock-file protection for shared claims
- immediate local wakeup when a message arrives

Pi Intercom contributes useful broker-lifecycle ideas:

- auto-start when first needed
- duplicate-spawn protection with a lock
- explicit local runtime artifacts like PID / config / socket files

## Decision

OpenScout should keep the current broker-first architecture and selectively
adopt the local-runtime operational ideas.

### Keep

- broker-owned durable conversations
- broker-owned invocations and flights
- delivery attempt and delivery status tracking
- SSE / HTTP-facing control plane
- mesh and multi-node routing support

### Add or Improve

- `ensureBrokerRunning()` as the default local startup path
- PID + lock files in broker runtime state
- Unix domain socket support as the preferred same-machine broker transport,
  with the existing HTTP URL kept for compatibility and mesh reachability
- stronger stale endpoint and stale claim cleanup using PID and session identity
- a clearer local fast path for waking local agents
- versioned snapshot / event cursor support for race-free refresh

### Do Not Copy

- per-agent inbox files as the primary transport
- file-only registry as the source of truth
- client-owned ask semantics that bypass broker-owned flight state
- same-machine assumptions that break mesh behavior

### Unix Socket Transport

`local_socket` means the same broker-owned HTTP-shaped API over a Unix domain
socket, not a separate file inbox protocol. Local callers should prefer the
socket path when it is available and fall back to `http://127.0.0.1:65535`.
The broker remains the single durable writer for messages, invocations,
flights, deliveries, and activity projections.

## Proposed Scope

### 1. Broker Auto-Start

Add a single runtime entry point that:

- checks broker health
- acquires a spawn lock
- starts the broker only if it is actually absent
- waits for healthy readiness before returning

This should become the local default instead of assuming the broker was already
bootstrapped out-of-band.

### 2. Broker Runtime Artifacts

Standardize broker-local runtime files under one broker-owned directory.

Initial artifacts:

- `broker.pid`
- `broker.lock`
- `broker-health.json` or equivalent lightweight status cache
- optional future local socket path if we add a same-machine fast path

This is about operational clarity, not a transport rewrite.

### 3. Stale Local Registration Cleanup

Tighten local endpoint cleanup rules so that stale registrations are removed
based on:

- process liveness
- session identity
- endpoint transport availability

This should apply consistently to:

- local endpoints
- project-scoped local agents
- future broker-managed reservations or claims

### 4. Race-Free Local Refresh

Add broker-owned sequencing for local refresh flows:

- snapshot version or event cursor on read APIs
- explicit ordering between snapshot reads and event streams
- clear client behavior when a newer read supersedes an older one

This solves the actual stale-refresh problem without inventing a separate local
protocol just for request correlation.

### 5. Optional Local Fast Path

Only after the lifecycle cleanup lands, evaluate whether OpenScout should expose
an optional same-machine Unix socket listener behind the same broker semantics.

This is explicitly an optimization layer, not a replacement for the existing
HTTP/SSE broker contract.

## Non-Goals

- replacing the broker with a file-backed mailbox system
- removing HTTP/SSE from the runtime surface
- removing broker-owned invocation or flight state
- dropping mesh support in favor of same-machine-only semantics
- reintroducing transport-specific collaboration contracts

## Acceptance Criteria

1. A local caller can invoke a single `ensureBrokerRunning()` path and get a
   healthy broker without manual setup steps.
2. Concurrent broker startup attempts do not create duplicate broker processes.
3. Stale local endpoint registrations are cleaned up deterministically using
   PID/session/transport checks.
4. Snapshot and event consumers have a race-safe way to ignore stale reads.
5. The existing durable broker model remains the source of truth for
   conversations, invocations, flights, and delivery state.

## Suggested Breakdown

1. Broker startup and lock-file implementation
2. Broker runtime-directory cleanup and artifact normalization
3. Endpoint/session stale-cleanup pass
4. Snapshot version / event cursor addition
5. Optional local-socket evaluation after the above lands

## Notes

This is intentionally a "steal the ideas, not the ontology" issue.

Pi Messenger solves a simpler local coordination problem well. OpenScout should
copy the parts that improve ergonomics and operability while preserving the
stronger durable broker core that already exists.
