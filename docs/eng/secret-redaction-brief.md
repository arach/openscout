# Brief: stop credentials leaking into agent sessions

**Status:** audit done, boundary redaction landed — see [secret-redaction-audit.md](./secret-redaction-audit.md)
**Motivation:** live credentials keep ending up in agent transcripts, session logs, and tail output. This has happened repeatedly. It is a recurring class of defect, not a one-off.

## The concrete incidents (2026-08-04, one session)

Two live credentials were printed into an agent transcript in a single working session:

1. **`SCOUT_OPENCODE_API_KEY`** — a unit test exercised a keychain-fallback code path. The test tried to isolate itself by prepending a temp dir to `process.env.PATH`, but that does **not** redirect `spawnSync`. The real `secret` CLI ran and the live key landed in the assertion diff.
2. **`GH` (a GitHub PAT)** — `varlock load --agent` is documented as safe to inspect in logs because it redacts sensitive values. It redacted `NPM_TOKEN` and `HERMES_API_KEY` but printed the `GH` PAT in full.

Both were rotated. Neither was caused by carelessness with an obvious secret — both came from tooling that was *believed* to be safe.

## Why this keeps happening

- Secrets are resolved as plain strings and then flow through normal string paths: test assertion diffs, `console.log`, broker logs, tail events, error messages, harness stdout/stderr capture.
- Nothing in the pipeline knows which strings are secret, so nothing can redact them.
- Redaction that does exist is opt-in and heuristic. Varlock's `init` writes `@defaultSensitive=false` and tags items by **name heuristics** — `NPM_TOKEN` and `HERMES_API_KEY` match, `GH` does not. Opt-in redaction fails exactly on the items nobody thought to mark.

Scout's whole job is streaming agent output to a UI. Redaction is closer to a requirement than a feature.

## Current state of secret handling

- Workstation credentials live in the **macOS login keychain**, read via the `secret` CLI at `~/.local/bin/secret`. See `docs/local-secrets.md` — "the keychain is the source of truth; `.env` is only for ad-hoc overrides."
- Scout provider keys follow `SCOUT_<VENDOR>_API_KEY`: `SCOUT_OPENCODE_API_KEY`, `SCOUT_XAI_API_KEY`, `SCOUT_CURSOR_API_KEY`, `SCOUT_OPENROUTER_API_KEY`.
- **These are not in the environment.** `process.env.SCOUT_*` is empty; you must `secret get`.
- The broker is **launchd-managed** (`~/Library/LaunchAgents/app.openscout.plist`) with a fixed `EnvironmentVariables` dict, so a shell export never reaches a Scout-spawned harness.
- Per-harness credential requirements are currently scattered across `readiness.anyOf` blocks in `packages/runtime/src/harness-catalog.ts`, one per harness, discoverable only by reading source.
- `packages/agent-sessions/src/adapters/opencode-acp/adapter.ts` has a working reference implementation of env-var-first-then-keychain resolution (`providerKeyEnv` / `keychainSecret`).

## Varlock groundwork already done

`varlock@1.16.0` is installed as a root dependency and `.env.schema` exists at the repo root. Verified working:

- `exec()` resolves from the existing `secret` CLI. This line is in `.env.schema` now and resolves correctly, redacted in `load` output:
  ```
  # @sensitive @required=false
  SCOUT_OPENCODE_API_KEY=exec(`secret get SCOUT_OPENCODE_API_KEY`)
  ```
- `varlock run -- <cmd>` injects resolved values into a subprocess (confirmed: correct key length reached the child).
- `varlock load --agent` prints JSON with sensitive values redacted (**after** pinning `@defaultSensitive=true`).
- Varlock ships a **programmatic API**, not just a CLI. Exports include `varlock/env`, `varlock/auto-load`, **`varlock/patch-console`**, `varlock/exec-sync-varlock`, `varlock/config`.
- Other resolvers available: `keychain()` (macOS, via varlock's native Swift daemon with Touch ID + per-session ACL) and `varlock()` (cross-platform encrypted payload committed in-file). A 1Password plugin exists for teams.

## Requested work

Judgment calls are the operator's; come back with findings and a recommendation rather than a large speculative refactor.

### 1. Audit — where can a secret reach a transcript? (do this first)

Map every path by which a resolved credential can reach something a human or agent reads: broker logs, tail events, `console.*`, error messages and stack traces, harness stdout/stderr capture, session/turn metadata, `providerMeta`, invocation results, test output. Produce a concrete list of leak sites with file:line. This audit is the actual deliverable — the rest depends on it.

### 2. Redaction at the boundary (highest value)

Design and implement redaction where agent output crosses into logs/UI. `varlock/patch-console` is a candidate primitive but do not assume it is sufficient — it will not cover spawned-process stdout, which is most of Scout's output volume. A registry of known-secret strings scrubbed at the log/tail boundary may be needed instead of, or in addition to, it.

Requirement: **default-deny, not heuristic.** If a value came from a credential resolver it must be treated as sensitive regardless of its variable name. The `GH` incident is the test case.

### 3. Schema as the provider-key contract (propose, don't build yet)

Evaluate consolidating the scattered `readiness.anyOf` credential checks in `harness-catalog.ts` into `.env.schema`, with `exec()` → `secret` on macOS and `varlock()` elsewhere. Report whether this is worth it; do not land it without sign-off.

### Integration constraint

Depend on varlock **as a library, not as a CLI wrapper.** Wrapping the launchd plist in `varlock run -- scoutd supervise` would make the whole Scout stack's boot depend on an external binary resolving from an absolute path — a fragile single point of failure for a daemon, and an onboarding cost for shipped users. Scout is already a Bun/TS project; import it.

## Gotchas that will cost you time

- `varlock init` writes `bunfig.toml` with `env = false`, which disables Bun's automatic `.env` loading **repo-wide**. It was removed from this repo. If it needs to come back, that must be a deliberate, documented decision — other agents share this working tree.
- `varlock init` defaults to `@defaultSensitive=false`. The repo schema pins `true`. Keep it that way.
- Mutating `process.env.PATH` does **not** redirect `spawnSync` to a stub binary. Pass an explicit command path instead — see the `secretCommand` option on the opencode-acp adapter for the pattern. Any test touching credential resolution must be hermetic or it will print a live key.
- Never write a test that logs a resolved credential, even into a temp dir.

## Working agreement

- The tree is shared and currently on branch `codex/delivery-campaign-source` with heavy uncommitted churn from another agent. Do not stash, do not switch branches, do not create worktrees. Additive files and edits only.
- `bun run --cwd packages/agent-sessions check`, `bun run protocol:check`, `bun run runtime:check` must stay clean. Two pre-existing runtime test failures in `broker-daemon-thread-mesh.test.ts` are not yours — a service was rewritten without updating its test.
- Report findings as a durable file under `docs/eng/` plus a short reply pointing at it.
