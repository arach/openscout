# SCO-077 — System probes: one disciplined layer for OS-level calls

**Status:** proposed
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
type ProbeSpec<T> = {
  id: string;                 // "tailscale.status", "git.buildInfo", "tmux.sessions"
  ttlMs: number;              // declared freshness budget — the ONLY knob
  run: () => Promise<T>;      // async exec only; sync exec is banned in probes
  timeoutMs: number;          // hard cap; a hung binary can't wedge the loop
};

const probe = defineProbe(spec);
probe.read()      // → last snapshot immediately; kicks a background refresh if stale
probe.fresh()     // → awaits a refresh if stale (rare; UIs should use read())
probe.snapshot()  // → { value, at, stale } without any side effects
```

Semantics:
- **Single-flight**: concurrent readers share one in-flight run.
- **Stale-while-revalidate**: `read()` never blocks a request on a subprocess; it serves the last value and refreshes in the background.
- **Declared cadence**: the TTL lives on the probe, not the caller. Ten tabs polling every 15s still produce at most one subprocess per TTL window.
- **Demand-driven**: no timers when nobody asks. A probe with no readers spawns nothing.

Initial probe set + TTLs:

| probe | ttl | replaces |
|---|---|---|
| `tailscale.status` | 30s | per-call spawns in mesh service, mobile bridge, relay runtime |
| `git.buildInfo` | process lifetime (refresh on demand ≤1/60s) | 3 sync git calls per `/api/build` |
| `tmux.sessions` | 5s | discovery scans in terminal relay/session discovery |
| `ps.runtime` | 5s | runtime/atop telemetry ps/lsof sweeps |
| `mesh.peers` | 30s (pull-on-demand stays the model) | ad-hoc peer probes |

Lint fence: an ESLint rule (or grep check in CI) banning `execFileSync|execSync|spawnSync` outside `system-probes/` and explicitly-annotated boot/CLI paths. The 96 sites burn down file by file; new ones can't land.

Out of scope for probes: genuinely imperative ops (spawn a relay, open a PR, create a tmux pane). Those stay where they are but must be async.

### Phase 2 — scoutd (Rust) behind the same interface

Once the registry is the single choke point, move execution out of the bun process entirely:

- `scoutd`: a small Rust daemon owning the OS interface — tailscale/tmux/git/ps/lsof reads, publishing snapshots over a local unix socket (JSON now; room for a typed protocol later).
- The TS registry's `run()` implementations become scoutd socket reads — consumers and TTL semantics don't change. If scoutd isn't running, probes fall back to local async exec (same code as Phase 1), so scoutd is an optimization, not a dependency.
- scoutd can be smarter than exec-per-probe: native libgit2 for status, tailscale LocalAPI socket instead of the CLI, kqueue-driven tmux/process watching — push, not poll, where the OS offers it.
- One scoutd serves every local Scout process (web server, broker, menu app, CLI) — today each of them runs its own copies of these same probes.

### Rollout

1. Land the registry + `tailscale.status` and `git.buildInfo` probes (these two caused the incident).
2. Migrate tmux/ps/lsof telemetry probes; add the lint fence.
3. Burn down remaining sync sites (mechanical, file-by-file).
4. scoutd spike: tailscale LocalAPI + git status via socket, registry fallback intact.

## Non-goals

- Changing what the UIs display or how often they *render* — this is about how often we hit the OS, which the TTLs decouple from UI polling.
- A general RPC bus. scoutd's surface is exactly the probe registry, nothing else.
