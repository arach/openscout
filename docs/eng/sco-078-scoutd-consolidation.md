# SCO-078 — Consolidating all OS calls under scoutd

**Status:** proposed (2026-07-02)
**Owner:** runtime / scout-web
**Depends on:** [SCO-077](./sco-077-system-probe-discipline.md) (probe registry contract, TTL table, lint fence)

SCO-077 defines the discipline: every recurring OS read is a probe with a declared TTL, served through one registry. This plan is the execution path to the endgame behind it: **long-lived Scout processes make zero direct subprocess calls.** One Rust-owned process executes every OS read (probes) and, eventually, every allowlisted OS action (verbs). TypeScript and Swift are clients of a socket, not spawners of processes.

## What "all" means

From the 2026-07-02 exec census (227 sites under `packages/` + `apps/`; full per-site worklist: [docs/agent/sco-077-exec-census.md](../agent/sco-077-exec-census.md)):

| bucket | sites | disposition |
|---|---|---|
| sync PROBE reads in long-lived servers | ~53 | consolidate — the core of this plan |
| sync IMPERATIVE actions in server request paths | ~30 | async first (SCO-077), then verbs over the socket (M5) |
| async probe-shaped reads (mesh tailscale storm, etc.) | subset of 59 | consolidate — same registry, same socket |
| BOOT-OK one-shots (`apps/macos/bin/*`, `apps/desktop/src/cli/*`, setup, build scripts) | ~85 | **exempt** — direct exec stays, on the lint allowlist |

"All" = the first three buckets. A packaging script exec'ing `codesign` doesn't need a daemon; a web server exec'ing `git status` per request does.

## What exists today

- **`crates/scoutd`** — 2.6k-line, deliberately **zero-dependency** supervisor: launchctl install/start/stop/uninstall, supervise loop spawning the base process with log rotation, doctor report, repo-watch warmer (already speaks UDS/TCP to the broker). No probe surface.
- **`crates/openscout-repo-service`** — one-shot JSON-over-stdin/stdout exec layer (worktree scan + diff), serde-only. TS spawns it per request via `runtime/src/repo-service/process.ts` (bounded buffer, SIGTERM→SIGKILL escalation). It proves the Rust-owns-the-parsing pattern but pays process startup per call.
- **TS probe registry** (SCO-077 Phase 1) — not built yet. It is the client of everything below; its `backend: "local" | "scoutd" | "local-fallback"` field is the seam this plan plugs into.

## Shape decision: which Rust process?

| option | shape | verdict |
|---|---|---|
| A | Probe server as a thread inside the supervisor process | No — deps and crash blast radius land in the one process that must never die; scoutd's zero-dep build is deliberate |
| B | **Same crate, second role: `scoutd probes serve`, run as a supervised child of `scoutd supervise`** | **Recommended** |
| C | Grow `openscout-repo-service` into the resident daemon | No — two installed daemons, and its identity is git-only |

**B: one binary, two processes.** The `scoutd` crate gains a `probes serve` subcommand; the existing supervise loop spawns it alongside the base process, restarts it on crash with the same backoff/telemetry machinery, and `scoutd doctor` reports it. One install artifact, one launchd service, process isolation for free. The crate takes a `serde`/`serde_json` dependency; the supervisor code path stays as lean as it is today.

repo-service is **subsumed, not paralleled** (per SCO-077): its scan/diff parsers move into shared modules in the crate (or a small workspace lib both binaries use). The standalone one-shot binary keeps working through M3 so repo-watch/repo-diff never regress mid-migration, then thins to a wrapper or retires at M4.

## Protocol

Socket: `$OPENSCOUT_HOME/run/scoutd-probes.sock`, mode 0600, foreground-runnable for dev (`scoutd probes serve` with no supervisor works standalone; the TS registry uses the socket if present, local backend otherwise).

Framing rule for M2: start with one JSON request per UDS connection. Do not introduce a shared multiplexed stream unless the envelope grows an explicit `requestId`; otherwise concurrent probe responses cannot be correlated safely.

Pull-over-UDS; the TS registry stays the cache/freshness owner per process, the daemon owns execution, pacing, and cross-process dedup (single-flight per probe key *machine-wide*, which no TS-side registry can give us).

```json
// request
{ "schema": "openscout.probe.request/v1", "probeId": "tailscale.status", "key": null, "maxAgeMs": 30000 }
// response
{ "schema": "openscout.probe.snapshot/v1", "probeId": "tailscale.status", "key": null,
  "generatedAt": 0, "ttlMs": 30000, "value": {}, "error": null, "daemonVersion": "..." }
```

- **Capabilities handshake** (`openscout.probe.capabilities/v1`): daemon lists served probe families + schema versions; the registry falls back per-probe when the installed daemon predates a family. Version skew is a normal state, not an error.
- **Bounded everything**: per-probe timeout and output cap enforced daemon-side too; a hung `tmux` can't wedge the socket (one worker per family, request queue with shed).
- **Fallback is visible**: snapshots carry `backend`/`fallbackSince`/`fallbackReason`; `scout doctor` and web health warn when an installed daemon has been bypassed beyond a short window.
- Later, same socket: `openscout.exec.request/v1` for imperative verbs (below). Not before M5.

## Probe implementation ladder — exec-parity first, native second

v0 is the daemon running the *same commands* the TS sites run today. That alone ends the incident class: subprocess work leaves the bun event loop, gets deduped machine-wide, and is paced by declared TTLs. v1 replaces exec with native reads, adopted family-by-family where it pays.

| family | v0 (exec inside daemon) | v1 (native, no subprocess) |
|---|---|---|
| `tailscale.status` | `tailscale status --json` | LocalAPI over tailscaled's own unix socket |
| `ps.runtime` | `ps -axo …` | `libproc`/`sysctl` (macOS-native process listing) |
| `net.listeners` | `lsof -iTCP:<port>` | `libproc` fd enumeration |
| `git.buildInfo` / `git.repoStatus` | git exec, reusing repo-service parsers | `gitoxide` status — optional; resident-daemon git exec is already off the hot path |
| `tmux.sessions` / `tmux.panes` | `tmux list-sessions` / `display-message` | one persistent control-mode (`tmux -C`) connection per socket — event-driven, near-zero cost |
| `sessions.scan` / `sessions.search` | — (skip exec parity) | native from day one: `std::fs` dir walk replaces `find | xargs stat`; `rusqlite` read-only replaces FTS exec |
| `cert.status` | `openssl x509 …` | x509 crate, or keep exec — low frequency, low value |

`sessions.*` and `cert.status` are new families surfaced by the census; they need TTL-table entries in SCO-077.

## Imperative verbs — what makes "all" true

Probes cover reads. The ~30 sync imperative sites (tmux send-keys/paste/kill/new-session, `tailscale cert`, reveal-in-Finder) go through two steps:

1. **Now (SCO-077 scope):** convert to the bounded TS async exec helper — sync-on-request is the urgent defect, not the spawn itself.
2. **M5:** move behind `openscout.exec.request/v1` with an **enumerated verb allowlist** (`tmux.sendKeys`, `tmux.paste`, `tmux.killSession`, `tmux.newSession`, `tailscale.cert`, `reveal.open`). Each verb has a typed argument schema; the daemon is never a general shell. Verbs share tmux control-mode connections with the probe side — send-keys stops paying a subprocess per keystroke batch.

## Client adoption

- **TypeScript**: the registry's scoutd backend is a thin UDS client with per-probe capability fallback. No call site changes after Phase 1 — consumers already read snapshots; the backend swap is invisible except in `scout doctor`.
- **Swift**: `ScoutMenu/Services/TailscaleService.swift` drops its independent 2.5s `tailscale status --json` exec loop and reads the socket. This is the machine-wide end of the tailscale storm — the TS registry alone can't fix a second process exec'ing on its own clock.

## Lint fence endgame

- **Phase A** (SCO-077, lands with M1–M3): CI script bans `execFileSync|execSync|spawnSync|Bun.spawnSync` everywhere, shrinking allowlist with `{path, symbol, category, reason, owner}`.
- **Phase B** (after M5): ban `node:child_process` / `Bun.spawn` **imports entirely** under `packages/web/server`, `packages/runtime/src` server paths, and both bridge trees. Sanctioned importers only: the probe/exec socket client, `repo-service/process.ts` (until M4), and the BOOT-OK allowlist. At that point "no direct OS calls in servers" is enforced, not aspirational.

## Milestones

| # | deliverable | acceptance |
|---|---|---|
| M0 ✅ | SCO-077 design (codex-reviewed) + 227-site census | done 2026-07-02 |
| M1 | TS registry + sanctioned async, output-capped exec helper + `tailscale.status`, `git.buildInfo` probes on the local backend (the incident killers), `fresh()`/`invalidate()` sites wired | `/api/build` + attention snapshot run **zero** subprocesses per request; ≤1 tailscale exec per 30s per process |
| M2 | `scoutd probes serve` spike: envelope + capabilities + those same two families over UDS; supervisor spawns/restarts it; doctor shows backend | kill the probe child → registry falls back visibly within one TTL, nothing user-facing breaks |
| M3 | Family burn-down: `tmux.*`, `ps.runtime`, `net.listeners`, `sessions.*`, `cert.status` — web **and** the desktop mirror tree; imperatives → async helper; lint fence Phase A green | census highest-risk list fully migrated; allowlist contains only BOOT-OK + imperative entries |
| M4 | repo-service subsumption: repo-watch/repo-diff route over the resident socket; spawn-per-request retired | one Rust artifact owns all git reads; `openscout-repo-service` binary retired or wrapper-only |
| M5 | Imperative verbs over `exec.request/v1`; lint fence Phase B | server trees import no subprocess APIs |
| M6 | Swift adoption (ScoutMenu → socket) | zero `tailscale` execs machine-wide outside the daemon |

Each milestone ships independently; through M3 the daemon is an optimization (fallback keeps everything working without it), from M4 it's a dependency of repo-watch only, and Phase B is the point of no return — deliberately last.

## Risks

- **Version skew** (TS registry newer than installed daemon): capabilities handshake + per-probe fallback; skew is routine, tested, visible in doctor.
- **Probe-child crash loops**: supervisor backoff + exit telemetry (machinery already exists for the base process); registry survives on the local backend meanwhile.
- **Dev without launchd** (`bun dev` workflows): foreground `scoutd probes serve` or no daemon at all — the local backend is a first-class permanent mode, not a shim.
- **Socket hygiene**: 0600 under `$OPENSCOUT_HOME/run`; envelopes carry system facts only, never credentials.

## Non-goals

- A general RPC bus — the surface is exactly the probe registry plus the enumerated verb list.
- Cross-machine probes — mesh presence stays pull-on-demand over existing channels; this socket is single-machine.
- Migrating BOOT-OK one-shots — CLI and build scripts keep direct exec, fenced by allowlist.
- Changing UI render cadence — TTLs decouple OS pressure from polling, per SCO-077.
