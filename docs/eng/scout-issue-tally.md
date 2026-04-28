# Scout / harness issue tally

Running log of rough edges hit while delegating real work via Scout. Capture once, surface to whoever owns the CLI / broker / harness layer.

> **Context:** captured during an in-flight scout refactor (separate agent currently working on scout itself). Some entries — especially #4 (broker restarts), #5 (codex harness instability), #8–#9 (registration / resolution churn) — are likely transient artifacts of that work, not steady-state bugs. Re-validate after the refactor lands before filing.

## Open issues

1. **`scout up <name>` resolves to a different agent identity than the literal name, silently.** From the openscout repo, `scout up openscout` actually spawns `smoke.main.mini` (project-tagged codex agent), not `openscout.main.mini` (claude-harness, registered separately). The mapping is invisible to the caller. Fix: when the resolved name differs from the requested one, print "→ resolved to `<name>`".

2. **`scout up` buffers stdout for ~4s before printing `Started <agent>`.** No early signal that anything is happening. Eager-flush the lifecycle line so callers don't think it's hung.

3. **`scout ask --to <name>` silently queues at an offline identity when `<name>` matches a registered-but-offline agent.** Same root cause as (1): no resolution feedback. The flight stays queued forever if the offline agent never comes back. Caller has no way to learn this without polling. Fix: at queue time, log the resolved agent + its current state ("queued at `openscout.main.mini` (offline) — flight will deliver on reconnect"), so the caller can decide whether to redirect.

4. **Broker daemon restarted mid-session, twice, killing in-flight asks with `error: broker is not reachable` and `error: Unable to connect`.** No graceful retry. `scout ask` should retry once on broker disconnect — the daemon comes back fast (single-digit seconds). Flight IDs from this session: `flt-moexsouu-516y1p`, `flt-moexsou7-fegq75`.

5. **Codex app-server sessions exit mid-flight before sending the reply.** Two consecutive asks to `smoke.main.mini` (codex harness for the Openscout project) returned "Codex app-server session for smoke.main.mini was shut down" instead of an actual reply. Fresh codex app-server PIDs spawn per ask but the harness exits before completing the work. Net result of multiple delegation attempts: zero replies. Need to investigate the codex-harness lifecycle in scout — likely an aggressive shutdown when no immediate response is detected.

6. **Discrepancy between `scout who` and `scout ps` for the same agent.** Smoke shows `idle` in `scout who` (broker registration heartbeat) but `down 13s` in `scout ps` (actual session state). The two views disagree on whether an agent is "available" — confused operator decisions about whether to ask.

7. **`scout ask` queue-vs-reject behavior is inconsistent across offline agents.** `scout ask --to openscout` (offline) earlier queued silently with `queued - Openscout queued for local execution`. `scout ask --to smoke` (also offline) hard-rejected with `error: target @smoke is not currently routable; nothing was sent`. Same operator-visible state (offline), different broker outcome. Either always queue (preferred — caller can decide whether to wait) or always reject with the same error string; pick one and document it. Today the operator can't predict which they'll get.

8. **`scout who` and `scout up` disagree on what is a "known agent."** `scout who` lists `smoke.main.mini · offline` as a registered (just stale) agent. `scout up smoke.main.mini` then errors: `unknown agent "smoke.main.mini" — not a registered agent name or valid path`. The two commands need a single registry view. Right fix: `scout up` accepts anything `scout who` enumerates (and either revives the stale registration or surfaces a clear "this agent is registered but its session is no longer recoverable; here's how to recreate it" message).

9. **`scout up <project>` resolution changes identity over the session.** Earlier `scout up openscout` resolved silently to `smoke.main.mini` (codex). Hours later it errors: `unknown agent "openscout" — that matches project "/Users/arach/dev/openscout", but the registered agent is "openscout-ui-validate.main.mini"`. Whoever registered most recently for the project wins. That's defensible behavior but it's silent — earlier callers got smoke, later callers get openscout-ui-validate, with no signal that the binding shifted. Print "→ resolved `<project>` to `<agent>` (latest registration)" at minimum, so the operator knows which agent they're actually addressing.

## Resolved / shipped fixes

(none yet)
