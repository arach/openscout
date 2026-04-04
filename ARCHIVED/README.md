# ARCHIVED

This directory holds code that is intentionally off the live Scout execution path.

Current archived material:

- `site/`
  The old root Next.js product site, public assets, and site-specific config/scripts.
- `native/engine`
  The archived Swift native shell scaffold and its embedded Relay web resources.
- `packages/relay`
  The donor Relay CLI, TUI, docs, and runtime compatibility surface.
- `packages/relay-web`
  The donor web bundle used by the archived native shell.
- `packages/voice`
  The old standalone voice bridge package that is no longer on the live product path.
- `packages/workflows`
  The old standalone workflows package that is no longer on the live product path.
- `scripts/scout-dev`
  The old repo-local native developer wrapper for the archived Swift shell.
- `scripts/launch-openscout-electron.mjs`
  The old detached Electron launcher used by archived helper flows.
- `scripts/openscout-dev`
  The old repo-local Electron helper that has been removed from the main root scripts and bin surface.

Rule:

- if `apps/scout`, `packages/electron-app`, `packages/runtime`, `packages/protocol`, `packages/cli`, or the current root scripts do not need it to boot, test, or build the live Scout path, it belongs here instead of the main tree.

Archived donor trees should preserve history and source context, but they are not allowed to remain on the live build or runtime path.
