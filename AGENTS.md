# Agent Instructions

See [DEV_INSTRUCTIONS.md](./DEV_INSTRUCTIONS.md) for repository-wide development instructions.

For fast project context, read [llms.txt](./llms.txt), then the dense agent notes in [docs/agent/README.agent.md](./docs/agent/README.agent.md). If you need a larger copy/paste context bundle, use [llms-full.txt](./llms-full.txt).

OpenScout product discovery (remote): [https://openscout.app/.well-known/scout.json](https://openscout.app/.well-known/scout.json) then [https://openscout.app/.well-known/agent.md](https://openscout.app/.well-known/agent.md). Local CLI: `scout whoami --json` returns the same URLs plus the nearest project instruction file when found.

Host-specific instruction files [CODEX.md](./CODEX.md) and [CLAUDE.md](./CLAUDE.md) are intentionally thin redirects. Keep shared guidance here or in `docs/agent`, not duplicated per host.

## Work Preservation

- Treat uncommitted source, docs, tests, and UI work in the active checkout as intentional by default.
- Err on the side of staging and committing real project work. Weed out only artifacts, generated leftovers, scratch files, and clear experiments that should not land.
- Do not use `git stash` as the main preservation mechanism for user work. Prefer explicit commits or named branches so useful work cannot be forgotten in a hidden stash.
- Before committing broad work, confirm the staged file list and call out anything excluded.

## Worktree Lifecycle

- Repo copies are allowed to build and run. The lifecycle rule is retirement
  after merge, not a canonical-tree execution restriction.
- Immediately after creating an OpenScout clone/worktree, register it with an
  owner, task id, and expected lifetime:

  ```bash
  python3 scripts/derived-state/register.py register \
    --path "$PWD" --owner "${SCOUT_AGENT_ID:-agent:<handle>}" \
    --task-id "<issue/pr/flight>" --lifetime-hours 72
  ```

- After its PR is confirmed merged, request retirement with
  `register.py retire --path <copy> --task-id pr:<number>`. The dry-run-first
  janitor removes it only after a fresh safety pass proves it is clean,
  inactive, merged into observed origin main, and remote-reachable. Dirty,
  unmerged, unpushed, active, and orphan-risk copies are kept.
- Use `python3 scripts/derived-state/roster.py` for the human roster. Do not use
  `du` as a reclaim estimate on APFS; only `df /System/Volumes/Data` measures
  physical reclaim.

## Product Posture

OpenScout is currently for high-trust local developer pilots, not enterprise-ready deployment. Do not claim compliance readiness, hardened multi-tenant security, guaranteed distributed delivery, or a finalized open-source license unless package and repo metadata have changed.

## Core Architecture Rules

- The broker is the canonical writer for Scout-owned coordination records.
- Scout-owned records include messages, invocations, flights, deliveries, bindings, agent registrations, questions, and work items created through Scout.
- External harness transcripts such as Claude Code and Codex JSONL are observed source material. Do not bulk-import them into Scout as first-party conversation messages.
- Mesh means reachability and coordination across machines. It does not mean exactly-once delivery, global consensus, CRDT convergence, or replicated external transcript storage.
- Prefer explicit routing metadata over body mentions. Message body text is payload.

## Main Entry Points

| Area | Path |
| --- | --- |
| Web UI/server | `packages/web` |
| Native macOS menu app | `apps/macos` |
| Transitional desktop/CLI source | `apps/desktop` |
| iOS app | `apps/ios` |
| Broker/runtime | `packages/runtime` |
| Shared protocol | `packages/protocol` |
| Public CLI package | `packages/cli` |
| Landing/docs site | `landing` |
| Product docs | `docs` |

## Routing Model

- One explicit target means a DM.
- Group coordination requires an explicit channel.
- Shared broadcast is opt-in.
- Use `scout send` or `messages_send` for tell/update.
- Use `scout ask` or MCP `ask` for owned work or requested replies.
- Use `invocations_get` / `invocations_wait` only to observe flights created by asks.
- Use `replyMode: "notify"` for longer-running agent work that should return quickly and report back later.
- Capability requests start with project + harness/capability, not a guessed generic agent name: `scout ask --project /path/to/repo --harness claude "..."`.
- When exact execution matters, select all dimensions explicitly (`--harness`,
  `--model`, `--effort`) or use the fixed-position RuntimeSpec
  `<harness>[/<model>[/<effort>]]`, for example
  `scout ask --project /path/to/repo --runtime codex/gpt-5.6-sol/xhigh "..."`.
  Inspect `scout runtimes --json` for legal tuples.
- An exact runtime request creates an isolated session. An exact
  `session:<id>` continuation is accepted only when that session's observed
  harness, model, and effort match the request.
- Verify exact asks through the invocation's `executionResolution`: compare
  requested, resolved, source, observed, and drift per dimension. Launch
  arguments prove resolution, not harness acceptance; only observed values do.
- Continuity requests use the returned handle (`ref`, `flightId`, `conversationId`, `workId`, or `session:<id>`), not a fresh short-name guess.
- In natural-language CLI asks, bare reserved profile names (`Fable`, `Kimi`, `Grok`, `Opus`) mean a fresh current-project launch through the broker runtime profile. They never mean `ask --to`.
- Bare-token priority is profile id, then harness id as a RuntimeSpec. Model
  family words are never bare targets, and runtime/profile/effort grammar words
  cannot be newly assigned as agent names.
- Natural-language existing-target asks use `agent <name> to <request>`; Scout slugifies `<name>` and requires one exact live agent/session handle match. Zero or multiple matches fail closed.
- Explicit `scout ask --to ...` remains existing-target routing. Use `scout ask --profile <name> ...` for an explicit fresh profile launch.
- Named long-lived siblings are deliberate promotions after routing is known good; prefer broker-suggested handles over inventing names like `claude.main`.

## Must-Read Docs

- [install.md](./install.md) for install and bootstrap expectations.
- [docs/current-posture.md](./docs/current-posture.md) for maturity, trust, mesh, install footprint, and license boundaries.
- [docs/architecture.md](./docs/architecture.md) for the broker/runtime/protocol model.
- [docs/architecture.md](./docs/architecture.md#the-data-model) before changing transcript persistence.
- [docs/agent-integration-contract.md](./docs/agent-integration-contract.md) before adding agent/adaptor integrations.
- [docs/operator-attention-and-unblock.md](./docs/operator-attention-and-unblock.md) before changing permission, approval, or human-input flows.

## Session search (past harness work) — prefer this

When looking up **prior Codex/Claude/Kimi (or other harness) sessions** —
what they said, which session ran a build, cwd, tool commands — use
**`scout search` first**. Do not start by grepping `~/.codex`, `~/.claude`,
or `~/.kimi-code`.

```bash
scout search status
scout search index --source sessions --harness kimi --hours 12   # explicit warm-up
scout search query "xcodebuild" --harness kimi --hours 12
```

Indexing is explicit only (never ambient). Guide: [docs/session-search.md](./docs/session-search.md).
Do not bulk-import harness transcripts into Scout messages.

## Common Verification

Run the narrowest relevant checks for your change. Common commands:

```bash
bun run --cwd apps/desktop check
npm --prefix packages/runtime run check
npm --prefix packages/protocol run check
bun run --cwd landing build
```

## Web Capture Hygiene

- Do not invoke Chrome or Chromium with `--headless` / `--screenshot` directly.
- Use the bounded repository helper instead:

```bash
bun run capture:web --url http://localhost:43120/ --output /tmp/scout-page.png
```

- The helper owns an isolated browser profile, applies a hard timeout, terminates
  the complete browser process group, and leaves a short-lived lease so `scoutd`
  can reap the group if the wrapper itself is interrupted.
