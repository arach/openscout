# ARCHIVED

This directory holds code that is intentionally off the live Scout execution path.

Current archived material:

- `native/engine`
  The archived Swift native shell scaffold and its embedded Relay web resources.
- `packages/relay`
  The donor Relay CLI, TUI, docs, and runtime compatibility surface.
- `packages/relay-web`
  The donor web bundle used by the archived native shell.
- `scripts/scout-dev`
  The old repo-local native developer wrapper for the archived Swift shell.
- `scripts/openscout-dev`
  The old repo-local Electron helper that has been removed from the main root scripts and bin surface.

Rule:

- if `apps/scout`, `packages/electron-app`, `packages/runtime`, `packages/protocol`, `packages/cli`, or the current root scripts do not need it to boot, test, or build the live Scout path, it belongs here instead of the main tree.

Archived donor trees should preserve history and source context, but they are not allowed to remain on the live build or runtime path.
