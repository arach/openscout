# Terminal Session Intake And Interchangeable Surfaces

Date: 2026-06-17
Workspace: `/Users/art/dev/openscout`
Studio study: `http://127.0.0.1:43140/studies/terminal-sessions`

## Purpose

This document hands off the current product and implementation discovery around
Scout-managed terminal sessions. It is meant for an agent working on the Studio
terminal sessions study and the surrounding implementation.

The short version:

```text
harness session id = stable identity
terminal backend = disposable surface
```

Scout should not make tmux, Zellij, SSH, or any future host-control protocol the
core noun. Those are ways to materialize, attach to, observe, or drive a stable
harness session.

## What Changed

The CLI now has a concrete `session intake` primitive:

```bash
scout session intake --harness claude --session <id> --backend tmux
scout session intake --harness claude --session <id> --backend zellij
```

Aliases:

```bash
scout session handoff ...
scout session onboard ...
```

The command takes a harness-native session id and creates or reuses a local
terminal surface for it. It returns both human-facing attach commands and a
structured `terminalSurface` payload.

Important files:

```text
apps/desktop/src/cli/commands/session.ts
apps/desktop/src/cli/commands/session.test.ts
docs/runtime-sessions.md
docs/agent/runtime-sessions.agent.md
```

The existing runtime harness catalog already knows resume commands:

```text
claude -> claude --resume <session-id>
codex  -> codex resume -C <cwd> <session-id>
pi     -> pi --session-id <session-id>
```

The intake command uses that catalog instead of hard-coding harness resume
syntax inside the terminal logic.

## Product Model

The model should be:

```ts
type TerminalBackend = "tmux" | "zellij";

type TerminalSurface = {
  backend: TerminalBackend;
  sessionName: string;
  paneId: string | null;
  attachCommand: string[];
  observeCommand: string[] | null;
  relay: {
    backend: TerminalBackend;
    sessionName: string;
    tmuxSession?: string;
    zellijSession?: string;
    zellijPaneId?: string;
  };
};
```

For UI purposes, the durable object is closer to this:

```ts
type HarnessSession = {
  harness: "claude" | "codex" | "pi" | string;
  sourceSessionId: string;
  cwd: string;
  resumeCommand: string;
  surfaces: TerminalSurface[];
};
```

The UI should not say "this is a tmux session" as the main object. It should say
"this is a known harness session, and here are the terminal surfaces available
for it."

## Why This Matters For The Studio Study

The current Studio page is:

```text
http://127.0.0.1:43140/studies/terminal-sessions
```

The page should be shaped around known sessions and materialized surfaces.

Good UI nouns:

- `Session`
- `Terminal surface`
- `Backend`
- `Attach`
- `Observe`
- `Materialize`
- `Detach`
- `Rematerialize`

Avoid making these the primary noun:

- `tmux session`
- `Zellij session`
- `terminal tab`
- `pane`

Those are useful implementation details and secondary metadata, not the main
product abstraction.

A row might show:

```text
Claude Code
source session 7e55c009-f579-439c-a817-988318789330
cwd ~/Library/Caches/openscout-session-intake-test/...
surfaces: tmux, zellij
actions: attach, observe, materialize another surface
```

The key behavior to design for:

1. A known harness session can have no active terminal surface.
2. A known harness session can be materialized through tmux.
3. The same known harness session can later be materialized through Zellij.
4. The session identity should not change when the backend changes.
5. Future SSH or host-control surfaces should fit without changing the model.

## Real End-To-End Validation

This was tested for real, not just via dry-run.

Scratch workspace:

```text
/Users/art/Library/Caches/openscout-session-intake-test/7e55c009-f579-439c-a817-988318789330
```

Pinned Claude session id:

```text
7e55c009-f579-439c-a817-988318789330
```

Test sequence:

1. Start Claude Code in tmux with a pinned session id.
2. Attach iTerm to that tmux session.
3. Accept Claude Code's trust prompt for the scratch workspace.
4. Send three prompts through the tmux-hosted Claude Code process:

   ```text
   TMUX_PROMPT_ONE_READY
   TMUX_PROMPT_TWO_READY
   TMUX_PROMPT_THREE_READY
   ```

5. Detach the iTerm/tmux client.
6. Exit the tmux-hosted Claude Code process cleanly.
7. Use the new intake CLI to materialize the same Claude session id through
   Zellij:

   ```bash
   scout session intake \
     --backend zellij \
     --harness claude \
     --session 7e55c009-f579-439c-a817-988318789330 \
     --project /Users/art/Library/Caches/openscout-session-intake-test/7e55c009-f579-439c-a817-988318789330
   ```

8. Send a Zellij-side prompt asking whether the previous tmux tokens are visible.
9. Claude replied:

   ```text
   ZELLIJ_RESUME_READY
   ```

That proves the useful claim: the same harness session can move from one terminal
surface to another.

## Observed Zellij Structure

The final live Zellij session was:

```text
scout-zj-final-7e55c009
```

Relevant pane list:

```text
terminal_0  claude  sh -lc claude --resume 7e55c009-f579-439c-a817-988318789330
terminal_1  Pane #2 /bin/zsh
plugin_0    zellij:link
plugin_1    tab-bar
plugin_2    status-bar
```

Important observation:

Zellij creates a default shell pane in addition to the pane we create for
Claude. An attempted cleanup using `new-pane --in-place` was brittle because on
a fresh install Zellij can focus a first-run or release-notes plugin instead of
the default shell pane. For v1, tolerate the extra shell pane. It is better than
making pane creation fragile.

## Zellij Socket Directory Gotcha

The live test found a real macOS issue:

```text
error: the IPC socket path is too long
```

Zellij used the default macOS `$TMPDIR`, which made the socket path exceed the
Unix socket length limit.

The CLI now gives Zellij subprocesses a shorter socket dir:

```text
~/.openscout/zellij-sockets
```

The generated attach command includes the env var:

```bash
env ZELLIJ_SOCKET_DIR=/Users/art/.openscout/zellij-sockets \
  zellij attach scout-zj-final-7e55c009
```

The generated observe command does the same:

```bash
env ZELLIJ_SOCKET_DIR=/Users/art/.openscout/zellij-sockets \
  zellij watch scout-zj-final-7e55c009
```

Any web/native relay or terminal launcher that attaches to a Scout-created
Zellij surface must preserve this socket directory or it will not see the same
Zellij server/session namespace.

## Current CLI Output Shape

Example tmux dry-run:

```text
session intake planned
harness claude
backend tmux
source session claude-session-example
terminal session scout-claude-openscout-3c9050f56e
cwd /Users/art/dev/openscout
resume claude --resume claude-session-example
attach tmux attach -t scout-claude-openscout-3c9050f56e
relay backend=tmux sessionName=scout-claude-openscout-3c9050f56e
```

Example Zellij real output:

```text
session intake created
harness claude
backend zellij
source session 7e55c009-f579-439c-a817-988318789330
terminal session scout-zj-final-7e55c009
pane terminal_0
cwd /Users/art/Library/Caches/openscout-session-intake-test/7e55c009-f579-439c-a817-988318789330
resume claude --resume 7e55c009-f579-439c-a817-988318789330
attach env ZELLIJ_SOCKET_DIR=/Users/art/.openscout/zellij-sockets zellij attach scout-zj-final-7e55c009
observe env ZELLIJ_SOCKET_DIR=/Users/art/.openscout/zellij-sockets zellij watch scout-zj-final-7e55c009
relay backend=zellij sessionName=scout-zj-final-7e55c009
```

In JSON mode, the important shared object is `terminalSurface`.

## Tests Run

Focused tests:

```bash
bun test apps/desktop/src/cli/commands/session.test.ts
```

Desktop typecheck:

```bash
bun run --cwd apps/desktop check
```

Both passed after the Zellij socket-dir fix.

## What Is Not Done Yet

This is the CLI substrate and product model proof. It is not yet the full app
integration.

Still needed:

1. Web relay generalization:

   Current relay assumptions are still tmux-heavy in places. Add a generic
   terminal backend contract, then map:

   ```text
   tmux   -> pty.spawn("tmux", ["attach", "-t", sessionName])
   zellij -> pty.spawn("zellij", ["attach", sessionName], env with ZELLIJ_SOCKET_DIR)
   ```

   For read-only:

   ```text
   zellij -> zellij watch <sessionName>
   tmux   -> either existing tmux observe behavior or a read-only relay mode
   ```

2. Session registry:

   The CLI returns useful metadata, but there is not yet a durable Scout registry
   record for "known harness session plus surfaces." The web UI needs something
   to list. This record should not import terminal scrollback as Scout messages.

3. Vantage planning:

   Vantage nodes currently assume `runtimeKind: "tmux"` in places. That should
   become more like `runtimeKind: "terminal"` with `terminalSurface.backend`.

4. Inspector/UI copy:

   Replace tmux-first language with session/surface language. Keep tmux/Zellij
   visible as backend badges, not the core object name.

5. Zellij pane hygiene:

   For v1, tolerate the extra shell pane. Later, use a layout file or a
   Zellij-specific startup recipe to create only the Claude pane and standard
   plugins.

## Design Direction For The Studio Page

The Studio study should show a working mental model, not a marketing page.

Suggested layout:

1. Left rail: known harness sessions.
2. Center: selected session detail plus active surface preview.
3. Right rail: resume context and backend capabilities.
4. Bottom/create area: materialize a new surface.

Example actions:

- `Attach`
- `Observe`
- `Materialize in tmux`
- `Materialize in Zellij`
- `Copy attach command`
- `Detach surface`

Example row state:

```text
Claude Code
Session 7e55c009...
cwd ~/Library/Caches/...
Surfaces: tmux exited, zellij live
```

The page should make this obvious:

```text
You are not moving a terminal session.
You are rematerializing a harness session in another terminal backend.
```

## Guidance For The Agent

When working on the Studio page or web implementation:

1. Do not rename the core feature to tmux management.
2. Treat terminal backends as interchangeable and disposable.
3. Preserve the stable harness session id and resume cwd as first-class fields.
4. Keep terminal output outside Scout-owned messages.
5. Make backend-specific details visible but secondary.
6. When adding Zellij UI, include the socket-dir detail in attach/relay paths.
7. Prefer a small, real flow over a decorative shell mock:

   ```text
   known Claude session -> materialize in tmux -> detach -> materialize in Zellij
   ```

8. Keep future SSH/HCP/native terminal surfaces in mind. If a type or UI label
   would make SSH feel weird later, it is probably too tmux-specific now.

## The One-Sentence Product Statement

Scout should let an operator resume a stable agent session wherever it is most
useful right now: tmux, Zellij, SSH, native terminal, or a future host-control
surface.
