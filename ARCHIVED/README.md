# ARCHIVED

This directory holds code that is intentionally off the live Scout execution path.

Current archived material:

- `packages/electron-app/src/`
  The old Electron renderer tree that was copied into `apps/scout/src/ui/desktop` and is no longer used by the running desktop app.
- `scripts/openscout-dev`
  The old repo-local Electron helper that has been removed from the main root scripts and bin surface.

Rule:

- if `apps/scout`, `packages/electron-app`, `packages/cli`, or the current root scripts do not need it to boot, test, or build the live Scout path, it belongs here instead of the main tree.
