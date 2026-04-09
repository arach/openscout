# Scout App

Canonical home for the new Scout-first implementation.

Structure:
- `src/cli` for argv parsing, command registration, and command handlers
- `src/app` for host-specific app wiring such as Electron
- `src/core` for product logic and orchestration
- `src/ui` for terminal and monitor presentation
- `src/shared` for low-level utilities

Legacy repo code outside `apps/desktop` should be treated as donor material.
