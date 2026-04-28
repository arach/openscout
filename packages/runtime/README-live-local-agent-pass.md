# Live Local Agent Pass

Run a real same-machine Codex <-> Claude broker pass with:

```bash
bash scripts/run-live-local-agent-pass.sh
```

Or through the runtime package script:

```bash
bun run --cwd packages/runtime test:live:local-agent-pass
```

What it exercises:

- a fresh isolated broker on localhost
- one Codex-backed local agent
- one Claude-backed local agent
- one broker-routed `ask` in each direction
- durable broker artifacts captured after the run

What it saves:

- broker log
- `scout up` output for both agents
- both `scout ask` transcripts
- `snapshot.json`
- `events.json`
- `who.json`

By default the helper cleans up successful runs. To keep artifacts, run:

```bash
OPENSCOUT_KEEP_LIVE_PASS=1 bash scripts/run-live-local-agent-pass.sh
```

Current caveats:

- The helper expects Bun and the Claude CLI to be available. Use `OPENSCOUT_BUN_BIN` or `OPENSCOUT_CLAUDE_BIN` if your shell PATH is sparse.
- Claude is launched from a detached worktree on purpose. Today, starting two manual agents from the same repo root can reuse session identity metadata unexpectedly.
- The first live invocation may briefly mark an endpoint `offline` with `session unavailable` before auto-recovering. The broker should still drive the flight through `queued -> running -> completed`.

This is a manual live check, not a CI test. Use it when you want to verify that same-machine agent execution stays on local harness transports while the broker still owns the conversation, invocation, and delivery lifecycle.
