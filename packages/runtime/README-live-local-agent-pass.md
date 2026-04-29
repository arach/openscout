# E2E Local Agent Pass

Run a real same-machine Codex <-> Claude broker e2e pass with:

```bash
bash scripts/run-live-local-agent-pass.sh
```

Or through the runtime package script:

```bash
bun run --cwd packages/runtime test:e2e:local-agent-pass
```

What it exercises:

- a fresh isolated broker on localhost
- one Codex-backed local agent
- one Claude-backed local agent
- one broker-routed `ask` in each direction around a mission
- durable broker artifacts captured after the run

You can pass a practical mission so the run doubles as a useful docs or KB
check:

```bash
bun run --cwd packages/runtime test:e2e:local-agent-pass -- \
  --mission "Verify docs freshness and identify one KB update opportunity."
```

Use `--codex-to-claude` or `--claude-to-codex` when you need exact prompts for
one side of the exchange. The older `test:live:local-agent-pass` script name
still works as a compatibility alias.

What it saves:

- `mission.txt`
- prompt files for both broker-routed asks
- broker log
- `scout up` output for both agents
- both `scout ask` transcripts
- `snapshot.json`
- `events.json`
- `who.json`

By default the helper cleans up successful runs. To keep artifacts, run:

```bash
bun run --cwd packages/runtime test:e2e:local-agent-pass -- --keep
```

Current caveats:

- The helper expects Bun and the Claude CLI to be available. Use `OPENSCOUT_BUN_BIN` or `OPENSCOUT_CLAUDE_BIN` if your shell PATH is sparse.
- Claude is launched from a detached worktree on purpose. Today, starting two manual agents from the same repo root can reuse session identity metadata unexpectedly.
- The first live invocation may briefly mark an endpoint `offline` with `session unavailable` before auto-recovering. The broker should still drive the flight through `queued -> running -> completed`.

This is an opt-in e2e check, not a CI test. Use it when you want to verify that same-machine agent execution stays on local harness transports while the broker still owns the conversation, invocation, and delivery lifecycle.

## Pi/MiniMax Headless Smoke

For a quick Pi-backed headless check against MiniMax:

```bash
bun run pi:minimax -- "Reply exactly: openscout-pi-minimax-ok"
```

The helper uses `MINIMAX_API_KEY`, or falls back to `MINIMAX_TOKEN` when that is
the key already present in the shell. It defaults to `MiniMax-M2.7`; override
with `OPENSCOUT_PI_MINIMAX_MODEL` or `--model` when a different plan/model is
available. The child process is launched with a minimal environment; the
MiniMax token alias is converted to `MINIMAX_API_KEY` and is not forwarded.

To keep a Pi MiniMax session running behind Scout and attach it as
`@pi-minimax`:

```bash
bun run pi:minimax:up
bun run pi:minimax:restart
bun run pi:minimax:down
```

`pi:minimax:up` writes the local pairing session config, starts the pair
supervisor, starts the broker if needed, and attaches the live pairing session
to Scout. The pairing config and broker attach payload contain provider/model
metadata only. The pair supervisor receives a minimal environment, and only the
Pi adapter child receives `MINIMAX_API_KEY`.
