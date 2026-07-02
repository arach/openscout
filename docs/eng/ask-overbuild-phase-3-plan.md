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
| C | Write collapse (Step 6): `transitionInvocation(invocationId, patch)` replaces the ~12 callsites that hand-build whole `FlightRecord`s. Funnels through the existing durable write so `normalizeRecordedFlight`, `promoteInvocationFlightToWork`, and `maybeForwardFlightToAuthority` keep firing on terminal states. Highest-risk behavioral commit, isolated. | in progress |
| D | Read switch (Steps 7–8): web `db/runs.ts` drops the latest-flight `LEFT JOIN` and reads `inv.*` directly (project through `projectAgentRunFromInvocation`; the `FlightRecord` alias keeps `WebFlight`/`WebAgentRun` shapes unchanged). Remaining runtime consumers (`issue-runner-service`, `broker-core/message/mesh-http`, MCP `invocations_get`/`_wait`) are alias-covered — the MCP snapshot keeps returning the `flight` key byte-stable. | pending |
| E | Contract (Step 10): drop the `flights` table + remove the alias, after a release soak. | pending |

Step 9 (Swift mirrors) needs no PR in Phase 3: the Swift side treats `flightId`
as a plain optional `String` on wire responses; `flight_id` stays durable on the
invocation row, so follow-links and `deriveProjectedAgentRunId` keep working.

## Constraints

1. Land in order; each PR either only adds (A, B) or changes one axis in
   isolation (C writes, D reads, E schema).
2. `flight_id` remains a durable column so `queryFlightRecordById`, follow
   links, and run-id derivation survive the merge.
3. A DB migration or write-path change earns an adversarial (Codex) review
   before merge — the gate that caught real bugs on #289 and #295.

## Review notes attached to the sequence

- #295's Codex review: before PR D flips reads, ensure shadows can be trusted —
  the dual-write is transactional + freshness-guarded since `36885947`; the
  boot-time backfill only fills `state IS NULL` rows. PR D should include a
  one-time reconciliation that overwrites stale shadows from `flights`
  wholesale, so any divergence from the pre-hardening window (or unknown
  sources) is erased before the switch.
- Deferred (pre-existing, drizzle-effort scope): concurrent virgin first-boot
  race in the migrator; ancient pre-v10 shapes stamped without full repair.
