# Scout Architecture Plan

`apps/desktop` is the new canonical Scout implementation.

## Layout

```text
apps/desktop/
├── bin/
│   └── scout.ts
├── src/
│   ├── cli/
│   │   ├── main.ts
│   │   ├── argv.ts
│   │   ├── context.ts
│   │   ├── options.ts
│   │   ├── registry.ts
│   │   ├── help.ts
│   │   ├── output.ts
│   │   ├── errors.ts
│   │   └── commands/
│   ├── app/
│   │   ├── electron/
│   │   └── desktop/
│   ├── core/
│   │   ├── broker/
│   │   ├── agents/
│   │   ├── pairing/
│   │   ├── setup/
│   │   ├── flows/
│   │   ├── context/
│   │   └── services/
│   ├── ui/
│   │   ├── terminal/
│   │   ├── monitor/
│   │   └── format/
│   └── shared/
└── plan.md
```

## Ownership Rules

- `src/cli` owns argv parsing, command registration, help, and exit behavior.
- `src/core` owns typed product behavior and cross-domain flows.
- `src/ui` owns rendering for terminal, monitor, and formatted output.
- `src/app` owns host shells such as Electron.
- `src/shared` stays low-level and should not absorb product logic.

## Donor Strategy

- Use legacy repo modules only as donor code; Scout owns the new runtime path.
- Port capabilities upward into `apps/desktop/src` instead of extending old CLI routers.
- Prefer moving reusable behavior into typed services before exposing it as a Scout command.

## Current Port Status

- `core/setup` owns `setup`, `doctor`, and `runtimes` reporting.
- `core/broker` owns `send`, `speak`, `ask`, `watch`, `who`, `enroll`, and `broadcast`.
- `cli` now owns shared command context, option parsing, output mode selection, and context-root handling.
- `pairing` and `agents` now have Scout-native command paths.
- `monitor` now has a Scout-native terminal surface behind `scout tui`.
- `app/desktop` now owns Scout-native desktop shell composition and phone-preparation state.
- `app/electron` now owns pure Electron host config, a Scout-native service surface for app info/shell state/phone-preparation state, and the typed IPC contract for preload/main-process wiring.
- Full Electron main/preload wiring remains to be ported as the next donor slice.
