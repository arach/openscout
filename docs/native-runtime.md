# Historical Native Runtime

This document captures the shape of the earlier native shell scaffold that informed the current desktop-host and runtime split. The source tree is no longer kept in the repository, but the process model is still useful context.

## Historical Native Targets

The native scaffold exposed three products:

- `ScoutApp`
- `ScoutAgent`
- `ScoutCore`

## Why The Split Existed

OpenScout wants one central GUI shell and one helper process that can be relied on independently.

The shell and helper should not be the same process because they have different jobs:

- the shell owns windows, navigation, WebKit, and operator-facing state
- the helper owns long-running work and runtime continuity
- workflow and action logic should stay outside this layer whenever possible

That mirrors the stronger process model already proven elsewhere in your ecosystem.

## Historical Behavior

When `ScoutApp` launches it:

1. creates `~/Library/Application Support/OpenScout`
2. resolves the `ScoutAgent` executable
3. starts the helper if it is not already running
4. monitors `agent-status.json`
5. renders helper state in the sidebar, workers screen, and footer status bar

When `ScoutAgent` launches it:

1. accepts an optional `--status-file` argument
2. writes heartbeat updates to that file
3. stays alive until terminated

## Notes

- The helper status file is the first transport, not the final transport.
- The heartbeat file exists only to make the process boundary real immediately.
- The intended future direction is a richer local transport layer that hands orchestration and workflows to TypeScript runtime packages.
