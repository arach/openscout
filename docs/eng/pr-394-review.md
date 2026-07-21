# PR #394 review — Hotzone batch

**Reviewer:** session-mrtserm2-leurld · **Branch:** `codex/hotzone-composer-theme` @ 1bf4c96c → `main` · mergeState CLEAN
**Verdict: merge-ready** (2 low-severity nits, no blockers)

Reproduced verification locally: `bun run --cwd packages/web test` → exit 0, all shards green (broker-display 8 pass / 0 fail); `npm --prefix packages/runtime run check` → exit 0, clean.

## Mandate items

### 1. `apps/ios/Scout/RootView.swift` conflict — CLEAN
- `surfaceLayer(...)` keep-alive `ZStack` structure preserved (RootView.swift:96+, helper at :279).
- main's APNs #398 `notificationRoute: model.pendingNotificationRoute` retained on the comms layer (call site RootView.swift:~115); `CommsSurface` init carries **both** `isActive` (CommsSurface.swift:16) and `notificationRoute` (CommsSurface.swift:18) — merge is coherent.
- `selectSurface()` (RootView.swift:298) consistently replaces the old inline `withAnimation(.spring…)` calls, incl. tab bar (:447).
- All new referenced symbols resolve: `ScoutHomeFX`, `EtchedScoutWordmark`, `activeAgentCount`, `isFleetLive`, `ScoutCanvas` (Theme.swift:192). HomeSurface signature (`motionEnabled`/`identityEnabled`/`isActive`/`onConnect`) matches def (HomeSurface.swift:16-25).
- Not compiled here (xcodebuild needs sim + hudson branch); signature-level consistency holds across all seven surfaces.

### 2. `packages/web/client/screens/broker/BrokerScreen.tsx` conflict — CLEAN
- No dead imports — all 30+ imports (incl. new `Paperclip`, `uploadMediaFiles`, `isRoutableMediaFile`, `brokerAttemptContextText`) are used.
- All handlers wired: `redispatch` (:916), `forwardDispatch` (:945), `invokeCodex`→`/api/broker/dispatch-review` (:1014), `prepareScoutMessage`/`scoutPrompts` (:911/:999). `DispatchActionStatus` guards valid (:819).
- Composer posts to `/api/ask` with `execution.reasoningEffort` (:963) + top-level `attachments` from `uploadMediaFiles` (:952,959). No dangling refs, no conflict markers, no debug artifacts.
- **NIT (low):** `brokerScoutbotTriageRequest` (broker-display.ts:279) is exported + unit-tested (broker-display.test.ts:196) but has **no production consumer** — the redesign dropped #393's one-click triage affordance. PR desc acknowledges "remains exported for re-wiring." Latent dead-in-UI code; re-wire or remove to prevent drift.

### 3. In-process daemon change — NOT IN THIS PR (moot)
- Already merged to `main` via #395 (5dff7d93, "Flatten scoutd→bun supervision tree"). The rebase absorbed it; `git diff origin/main...HEAD` touches **zero** `packages/runtime`/`crates/scoutd`/bin-wrapper files. No supervision/lifecycle regression risk originates from this PR.
- PR description's "Runtime daemons run in-process" bullet is **stale/misleading** — that work landed separately.

### 4. Send endpoint attachments validation — SOUND
- New guard at create-openscout-web-server.ts:6991-6994 mirrors the pre-existing operator-chat pattern (6779-6782): shallow `Array.isArray` check at the HTTP boundary, cast to `OutgoingAttachmentInput[]`.
- Element-level validation is downstream in `normalizeOutgoingAttachments` (service.ts:1952) — drops elements lacking `mediaType` or `url`/`blobKey`, mints ids. `reasoningEffort` trimmed (6990) and threaded via `askScoutQuestion` (service.ts:2763,2828). Consistent + idiomatic; no over-trust of caller shape.

## Additional finding (note, not block)

- **CI trigger** (.github/workflows/ci.yml): `pull_request` → `push: branches:[main]`. Removes **pre-merge PR gating**; CI now runs post-merge on push to main. `paths:` still covers `packages/web/**` + `packages/runtime/**` so those get post-merge CI; `apps/ios`/`apps/macos`/`design/studio` never trigger CI (no Swift CI exists anyway). Deliberate infra decision by the repo owner. Consequence: **this PR ran no CI** — local verification (reproduced above) is the only automated signal.
