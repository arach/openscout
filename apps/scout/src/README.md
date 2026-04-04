`apps/scout/src` is organized by architectural role:

- `cli/` command parsing, help, and command handlers
- `app/` host and shell wiring
- `core/` product logic and orchestration
- `ui/` presentation and renderers
- `shared/` low-level utilities

Rules:
- Only `cli/` should parse argv or decide exit codes.
- `core/` exposes typed behavior and never owns help text.
- `ui/` renders state and command results; it should not own domain logic.
- `shared/` stays small and low-level.
