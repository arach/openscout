# SCO-077 — System probes: one disciplined layer for OS-level calls

**Status:** proposed (revised after codex design review, 2026-07-02)
**Owner:** scout-web / runtime
**Motivation:** 2026-07-02 performance incident — the control-plane web server degraded to 7–40s responses (static files included) after 17h of uptime, driven by unbounded, uncoordinated subprocess traffic.

## The incident, in numbers

- `tailscale status --json` was spawning **multiple times per second, continuously** (every mesh-status consumer — each web tab's 15s poll, the iOS bridge RPC, the macOS app — runs its own subprocess; no cache, no single-flight).
- `/api/build` ran **three synchronous git commands per request**, including `git status --porcelain` (full working-tree scan), for data that changes on redeploy, not per request.
- While the broker answered in 2–50ms, the web server took 7–40s for *everything* — five parallel requests to a trivial endpoint all timed out together at 40s.
- Restarting the process cleared it (0.2–0.8ms after), which is the tell: this degrades with uptime and load, and will come back.

## The structural problem

A census of the tree (2026-07-02) found **96 blocking exec sites** (`execFileSync`/`spawnSync`) across 18 files, plus ~25 async ones:

| binary | call sites | typical purpose |
|---|---|---|
| tmux | 21 | terminal surface discovery, pane ops |
| git | 21 | build info, repo status, worktrees, diffs |
| ps | 5 | runtime/process telemetry |
| sh | 4 | misc glue |
| lsof / tailscale / openssl / dns-sd / gh / open | ~12 | mesh status, certs, pairing, PRs |

Hot files: `create-openscout-web-server.ts` (18), `runtime/src/local-agents.ts` (15), `terminal-relay-session.ts` (8), bridge server/router (12), `relay-runtime.ts` (5, incl. a 5s-timeout sync tailscale probe).

Three compounding defects:

1. **No cadence discipline.** Callers probe whenever *they* want. N consumers × M surfaces = unbounded probe frequency, though the underlying facts (tailnet peers, branch name, tmux session list) change on the order of seconds to hours.
2. **Blocking execution.** Sync exec on the bun event loop freezes the whole process — every one of the 96 sites is a stop-the-world button, and under machine load (agents, builds) each takes seconds instead of milliseconds.
3. **No shared results.** Two callers asking the same question a second apart pay two subprocesses. Nothing dedupes concurrent identical probes.

## Design: probe registry now, scoutd later

### Phase 1 — TS probe registry (`@openscout/runtime/system-probes`)

One module owns *all* recurring OS-level reads. Consumers never exec; they read snapshots.

```ts
type ProbeSnapshot<T> = {
  id: string;
  key?: string;                 // set for keyed-family probes
  value: T | null;
  at: number | null;            // last successful run
  ageMs: number | null;
  stale: boolean;
  refreshing: boolean;
  status: "empty" | "fresh" | "stale" | "failed";
  error: ProbeError | null;
  consecutiveFailures: number;
  backend: "local" | "scoutd" | "local-fallback";
};

type ProbeSpec<T> = {
  id: string;                   // "tailscale.status", "tmux.sessions"
  ttlMs: number;                // declared freshness budget — the ONLY knob
  run: (ctx: ProbeCtx) => Promise<T>;  // async exec only, AbortSignal-aware
  timeoutMs: number;            // hard cap; kill-on-timeout, output caps
  maxStaleMs?: number;          // default max(2min, 10×ttl); after that → failed
};

const probe = defineProbe(spec);
probe.read()       // → ProbeSnapshot<T> immediately; kicks background refresh if stale. NEVER blocks.
probe.fresh(opts?) // → Promise<ProbeSnapshot<T>>; the only block-once path. opts.maxAgeMs overrides ttl.
probe.snapshot()   // → ProbeSnapshot<T> with no side effects
probe.invalidate(reason?)  // → force next read to refresh (call after side effects)
```

**Keyed probe families** — git facts are per-repo, tmux facts are per-socket. Families make keys first-class *without* reintroducing unbounded traffic per key:

```ts
const gitBuildInfo = defineProbeFamily<string, BuildInfo>({
  id: "git.buildInfo",
  ttlMs: 60_000,
  timeoutMs: 1_500,
  normalizeKey: canonicalRepoRoot,  // required — no accidental key explosion
  maxKeys: 64,                      // LRU eviction
  idleKeyTtlMs: 10 * 60_000,        // drop keys nobody reads
  maxConcurrentKeys: 2,             // per-family concurrency cap
  run: async (repoRoot, ctx) => { /* ... */ },
});

gitBuildInfo.for(repoRoot).read();
```

Semantics:
- **Single-flight**: concurrent readers share one in-flight run (per key for families).
- **Stale-while-revalidate**: `read()` never blocks a request on a subprocess; it serves the last value and refreshes in the background.
- **Cold start never blocks**: first `read()` returns `{status: "empty", refreshing: true}`; callers that must have a value use `fresh()`.
- **Bounded staleness**: last-good is served as `stale` up to `maxStaleMs`, then the snapshot degrades to `status: "failed", value: null` with `lastGoodAt`/`error` exposed. Stale "tailscale running" can be actively wrong — never serve last-good forever.
- **Failure backoff**: consecutive failures back off retries; a broken binary is not re-exec'd on every request. "CLI absent" is a *successful* domain result (`{available: false}`), not a probe error — only timeouts/crashes count as failures.
- **Declared cadence**: the TTL lives on the probe, not the caller. Ten tabs polling every 15s still produce at most one subprocess per TTL window.
- **Demand-driven**: no timers when nobody asks. A probe with no readers spawns nothing.
- **Metrics built in from day one**: per-probe duration, timeout count, cache age, stale-served count, in-flight count, key count, backend. This incident would have been visible in one glance at such a panel.

Initial probe set + TTLs:

| probe | ttl | replaces |
|---|---|---|
| `tailscale.status` | 30s | per-call spawns in mesh service, mobile bridge, relay runtime |
| `git.buildInfo` (family, per repo) | build metadata: process lifetime · branch/dirty: 60s | 3 sync git calls per `/api/build` |
| `tmux.sessions` (family, per socket) | 5s | discovery scans in terminal relay/session discovery |
| `ps.runtime` | 5s (10–15s for overview surfaces) | runtime/atop telemetry ps sweeps |
| `net.listeners` (family, per port) | 5s | lsof sweeps in managed-terminal-relay |
| `mesh.peers` | 30s (pull-on-demand stays the model; delivery still does live health checks) | ad-hoc peer probes |

**Consumers that need `fresh()` or `invalidate()`** (stale is *wrong* here, not just old):

- Mesh announce host selection (`core/mesh/service.ts` → `announceMeshVisibility`): `fresh({maxAgeMs: 5_000})`.
- Pairing relay endpoint resolution (`core/pairing/runtime/relay-runtime.ts` → `resolveRelayEndpoint`): fresh self/status on first relay start.
- Post-action loops: after "Start Tailscale" the UI polls every 1s expecting change — the server must `invalidate("tailscale.start")` after the control action or the button looks broken for 30s.
- iOS manual refresh (`mobile.meshStatus`): fresh-ish on explicit pull; passive display reads snapshots.

Everything else — the mesh screen's 10s poll, the status bar's 15s poll, home cards — reads snapshots and tolerates a TTL of staleness.

Lint fence: a CI scan (script, not ESLint — the repo doesn't run ESLint) banning `execFileSync|execSync|spawnSync|Bun.spawnSync` **everywhere**, including inside probes (probes are async-only), with a shrinking allowlist of `{path, symbol, category: boot|cli|build-script|test|imperative, reason, owner}`. The 96 sites burn down file by file; new ones can't land.

Out of scope for probes: genuinely imperative ops (spawn a relay, open a PR, create/kill a tmux pane, send prompt keys). Those stay where they are but must be async with timeouts — commands are not cached reads. Repo diff keeps its existing bounded job/cache machinery; it's a job, not a probe.

### Phase 2 — scoutd (Rust) behind the same interface

> Execution plan for full consolidation (shape decision, protocol, milestones M0–M6): [SCO-078](./sco-078-scoutd-consolidation.md).

`crates/scoutd` **already exists** (supervisor / status / repo-watch warmer). Phase 2 extends it rather than inventing a new daemon:

- scoutd grows a **probe socket** (separate listener/thread — probe serving must not block the supervise loop) answering bounded snapshot requests over a local unix socket.
- Protocol: **pull-over-UDS first** (the TS registry stays the cache/freshness owner; scoutd just executes), with a versioned envelope:

```json
{
  "schema": "openscout.probe.snapshot/v1",
  "probeId": "tailscale.status",
  "key": null,
  "generatedAt": 0,
  "ttlMs": 30000,
  "value": {},
  "error": null,
  "daemonVersion": "..."
}
```

- A capabilities handshake lets the TS registry fall back **per probe** when scoutd is older than the registry.
- Fallback to local async exec keeps scoutd an optimization, not a dependency — but the fallback must be *visible*: snapshots carry `backend`/`fallbackSince`/`fallbackReason`, and `scout doctor` + web health warn when an installed scoutd has been in fallback beyond a short window.
- scoutd can be smarter than exec-per-probe: tailscale LocalAPI socket instead of the CLI, libgit2 instead of `git status`, kqueue-driven tmux/process watching — push/subscribe comes later, where the OS offers it.
- scoutd should **wrap or subsume the existing native repo-service subprocess contract** (`runtime/src/repo-service`, used by repo-watch/repo-diff), not stand up a parallel git backend.
- One scoutd serves every local Scout process — which is also the answer to the biggest Phase 1 gap: **the macOS menu app independently runs `tailscale status --json` on a 2.5s refresh path** (`ScoutMenu/Services/TailscaleService.swift`). The TS registry fixes the web server; the machine-wide storm only ends when Swift reads scoutd (or broker-shared) snapshots too.

### Rollout

1. Land the registry (snapshot contract, families, metrics) + `tailscale.status` and `git.buildInfo` probes (these two caused the incident), including the `fresh()`/`invalidate()` call sites listed above.
2. Migrate tmux/ps/lsof telemetry probes; add the CI fence + allowlist.
3. Burn down remaining sync sites (mechanical, file-by-file; census worklist tracked separately).
4. scoutd probe socket spike: tailscale LocalAPI + git status over UDS, registry fallback intact, fallback visibility in `scout doctor`.
5. Swift adoption: ScoutMenu drops its own tailscale exec for scoutd/broker snapshots.

## Non-goals

- Changing what the UIs display or how often they *render* — this is about how often we hit the OS, which the TTLs decouple from UI polling.
- A general RPC bus. scoutd's probe surface is exactly the probe registry, nothing else.
- Migrating imperative operations into probes. Commands stay commands.
