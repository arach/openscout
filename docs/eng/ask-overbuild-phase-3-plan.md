# Ask-overbuild Phase 3: merge flights into invocations

Phase 3 of the ask-overbuild reduction (see `ask-overbuild-simplification-plan.md`)
unifies the two storage representations of the same fact — an ask's request
(`invocations`) and its execution status (`flights`) — into one record. A flight
is not a distinct domain concept; it is the status of an invocation. The merge
follows expand → dual-write → write-collapse → read-switch → contract, one PR
per step, each shippable and green on its own.

Principle banked from review: **unify representations of the same fact; resist
merging distinct concerns just because they're adjacent** (deliveries, work
items, and thread events stay separate — they are distinct facts).

## PR sequence

| PR | Scope | Status |
|----|-------|--------|
| A | Protocol: merged `Invocation` type (`InvocationRequest & InvocationStatus`), `FlightRecord` alias, `projectAgentRunFromInvocation` shim. Purely additive. | ✅ #290, merged 2026-07-01 |
| B | Storage expand: 7 shadow status columns on `invocations` (drizzle 0001 + raw schema + imperative repair w/ backfill), transactional freshness-guarded `recordFlight` dual-write. Reads stay on `flights`. Schema v11→12. | ✅ #295, merged + live 2026-07-02 |
| C | Write collapse (Step 6): `transitionInvocation(invocationId, patch)` replaces the ~12 callsites that hand-build whole `FlightRecord`s. Funnels through the existing durable write so `normalizeRecordedFlight`, `promoteInvocationFlightToWork`, and `maybeForwardFlightToAuthority` keep firing on terminal states. Highest-risk behavioral commit, isolated. | ✅ #296, merged 2026-07-02 |
| D | Read switch (Steps 7–8): web `db/runs.ts` drops the latest-flight `LEFT JOIN` and reads `inv.*` directly (project through `projectAgentRunFromInvocation`; the `FlightRecord` alias keeps `WebFlight`/`WebAgentRun` shapes unchanged). Adds `flight_metadata_json` (8th shadow column, drizzle 0002, v12→13), a boot-time self-healing shadow reconcile, and a serialized (BEGIN IMMEDIATE) migration pipeline. Remaining runtime consumers (`issue-runner-service`, `broker-core/message/mesh-http`, MCP `invocations_get`/`_wait`) are alias-covered — the MCP snapshot keeps returning the `flight` key byte-stable. | #297, in review |
| E | Contract (Step 10): drop the `flights` table + remove the alias, after a release soak. Sweep MCP/broker snapshot consumers that still read `snapshot.flights`. Candidate: retire `flight_id` itself — with 1:1 invocation:flight (verified on the live DB) the invocation id can become the one run id; decide before E lands. | pending |

Step 9 (Swift mirrors) needs no PR in Phase 3: the Swift side treats `flightId`
as a plain optional `String` on wire responses; `flight_id` stays durable on the
invocation row, so follow-links and `deriveProjectedAgentRunId` keep working.

## Constraints

1. Land in order; each PR either only adds (A, B) or changes one axis in
   isolation (C writes, D reads, E schema).
2. `flight_id` remains a durable column through D so `queryFlightRecordById`,
   follow links, and run-id derivation survive the merge (see the PR E
   candidate above for its endgame).
3. A DB migration or write-path change earns an adversarial (Codex) review
   before merge — the gate that caught real bugs on #289, #295, #296, and #297.

## Semantics decided in PR D (clean break, no backwards compat)

- **An invocation carries exactly one current status.** A flight id addresses
  an invocation's latest flight only; a superseded sibling id deliberately
  resolves nowhere (no flights-table fallback). Listings show one status per
  invocation — the old per-sibling rows (including stale "running" zombies for
  invocations that had already completed) are gone. Verified harmless on the
  live DB: 216/216 flights are 1:1 with invocations, zero sibling ids exist.
- **Equal-timestamp siblings resolve by write order** (most recent write wins),
  not by flight-id ordering. The dual-write guard (`>=`) and the reconcile's
  rowid tiebreak implement the same rule.
- **The invocation is the identity authority**: `recordFlight` normalizes a
  flight's `requesterId`/`targetAgentId` to the invocation's values, so raw
  `/v1/flights` posts cannot store identity that disagrees with what readers
  project.
- **Shadow trust is self-healing**: the imperative repair layer reconciles
  every shadow column against the computed latest flight on every boot, and
  the whole migration pipeline runs under one `BEGIN IMMEDIATE` transaction
  (concurrent boots serialize; a mid-migration crash rolls back cleanly).
