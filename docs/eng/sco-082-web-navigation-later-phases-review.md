# Review: SCO-081/082 web navigation consolidation (pre-merge)

Reviewed on 2026-07-20 against branch `codex/hotzone-composer-theme`, commits:

- `99991c9c` — Phase 1: drop TanStack, `lib/router.ts` owns browser location.
- `9fd50be0` — SCO-082 Phase A/B/C: destination catalog, URL selection state,
  legacy alias migration.

Scope note: reviewed only these two commits. The working tree carries unrelated
uncommitted work (CI, macOS, crates, broker/ops screens, CSS, `design/studio`,
and further edits to `create-openscout-web-server.*`); those were excluded.

## Verdict: **merge-ready** (nits only, none blocking)

Both commits faithfully implement the stronger cutover plan from
`sco-081-...-review.md`. The URL/history correctness work — the review's #1
risk — is done well and is genuinely pinned by tests. Focused suites pass:
`router.test.ts` + `router.navigation.test.ts` + `nav-destinations.test.ts` =
**119 pass, 0 fail**.

## What was verified

**URL policy (Phase 1).**
- Route-local params do not leak across navigation; only the named global
  feature-flag whitelist survives (`scope/paths.ts:156-196`,
  test `router.navigation.test.ts:174-197`).
- `machineId` propagates only via `MACHINE_SCOPED_VIEWS` — including the
  hardening case where a stray `machineId` on an unscoped URL never re-enters
  the route model and so cannot reappear later (`router.ts:232-244`,
  test `:221-258`).
- Hash clears by default on `navigate()`, set only on explicit request
  (`router.ts:1159-1170`, test `:199-219`).
- Single reactive location store via `useSyncExternalStore`; push/replace/
  back-forward/dedup/unsubscribe all covered (`router.ts:977-1043`, test
  `:346-416`). One scroll owner (`useRouter`'s `scrollMap`).
- `/scope/*` namespace and legacy `/scout/*` canonicalization retained without
  TanStack (test `:260-279`, `:441-458`).
- Fixture table covers **all 21** `Route` view variants and asserts complete
  coverage (`router.navigation.test.ts:124-136`); 21 is correct after Phase C
  removed `agents`/`fleet`/`conversations` from the union.

**returnTo / nav-return replacement (Phase B).**
- Entry-scoped keys (`returnTo`/`returnUseHistory`/`settingsEntry`) are stripped
  on plain pushes but preserved on `replace` — exactly the hazard the sco-081
  review flagged — and pinned by `router.navigation.test.ts:528-569`.
- Parity check: the OLD `openAgent`/`openContent` also set nav-return only when
  a caller passed `returnTo` explicitly, so routing it through history-entry
  state is behavior-preserving — no back-button regression.

**Settings consolidation (Phase B).** URL-addressable `/settings/:section` for
all sections; drawer (operator/comms/credentials/voice/devices) vs routed
screen (pairing/agents) kept as a shell presentation policy per spec; close
returns via `history.back()` only on app-pushed entries (`settingsEntry`
marker) with an inbox fallback for cold deep links; section switching uses
`replace` so it doesn't stack history (`Provider.tsx` settings block).

**Destination catalog (Phase A).** Projections deep-equal the public exports
(`projectTopNavItems() === TOP_NAV_ITEMS`, `OPS_SECONDARY_NAV ===
projectOpsSecondaryNav()`, etc.), and shared destinations share `active`
identity (`systemMission.active === secondaryMission.active`) — proving the
ops-gate predicate duplication was actually removed, not just re-copied
(`nav-destinations.test.ts:49-102`). The `nav:settings` (drawer) vs
`nav:agent-config` (route) distinction is preserved.

**Phase C.** Migration-then-retention (legacy input still canonicalizes:
`/fleet→/`, `/conversations→/messages`, `/agents.deprecated/*`, `/agents-v2/*`,
`/scout/*`) — the safer path the review recommended over literal parser-alias
deletion. Server producers repointed in-commit (`scoutbot-assistant.ts`
`{view:"fleet"}`→`{view:"inbox"}`). Shims deleted; no stale client refs to
removed views; macOS `/agents/:id` deep links untouched.

## Findings (all low / non-blocking)

1. **Low — latent `returnTo` + `replace` inconsistency.**
   `buildNavigateState` (`router.ts:1130-1140`) sets `returnUseHistory=true`
   whenever `returnTo` is present, regardless of `replace`. With a replaced
   entry the preceding entry is not the origin, so `BackToPicker` would
   `history.back()` to the wrong place. No current caller combines them
   (verified), so it is latent. Suggest gating `returnUseHistory` on
   `!options.replace`, or documenting the constraint on `NavigateOptions`.

2. **Low — broker deep-link renders a stub attempt briefly.** On a cold
   `/dispatch?attempt=X`, `selectedBrokerAttempt` is `{ id } as
   BrokerRouteAttempt` (`Provider.tsx`) until the diagnostics feed loads and
   `BrokerScreen`'s reconciliation effect (`:465-469`) swaps in the full row.
   The risky field reads in `BrokerAttemptInspector` are guarded
   (`brokerMetadataJson` handles undefined, timestamps normalized, `?? "unknown"`
   fallbacks), so it degrades rather than crashes. Worth one manual smoke of a
   cold deep-link; not blocking.

3. **Cosmetic — stale "24" comment.** `router.navigation.test.ts:30` says "all
   24 view variants" while the (correct) assertion is 21. Comment only.

4. **Cosmetic — dead `=== "fleet"` guards** at `server/routes/scoutbot.ts:167`
   after producers were repointed to `inbox`. Harmless (`step.route` typed
   `Record<string,unknown>` → no tsc-overlap error; `step.id === "fleet"`
   fallback still catches the fleet-home step). Removable for tidiness.

5. **Test nit — weak go-shortcut active assertion.**
   `nav-destinations.test.ts:113-117` ORs in `destination.active(destination.route)`
   (always true), so that branch cannot fail. The projection-equality
   assertions elsewhere carry the real weight.

## Recommendation

Merge. Optionally address #1 (a two-line guard) since it hardens a real
history-back invariant, and glance at #2 with a live deep-link. #3–#5 are
polish and can ride a later cleanup.
