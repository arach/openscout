# OpenScout Menu

Native macOS menu bar shell for OpenScout. This is intentionally thin:

- broker lifecycle is driven through `openscout-runtime service ...`
- pairing state is read from `~/.scout/pairing/runtime.json`
- pairing control uses the existing `pair-supervisor` entrypoint when it can be resolved
- the local web UI is opened from the menu app instead of being reimplemented in Swift

## Development

```bash
cd apps/macos
swift run
```

```bash
cd apps/macos
swift build
```

You can also open `Package.swift` directly in Xcode.

## Quick Launch

From the repo root:

```bash
bun run menu
```

From the Scout CLI on macOS:

```bash
scout menu
```

## App Bundle

```bash
bun apps/macos/bin/openscout-menu.ts build
```

```bash
bun apps/macos/bin/openscout-menu.ts launch
```

```bash
bun apps/macos/bin/openscout-menu.ts restart
```

The helper builds a release Swift binary, assembles `apps/macos/dist/OpenScoutMenu.app`,
and signs it with:

- `Developer ID Application` when available
- otherwise `Apple Development`
- otherwise ad hoc

## Signed DMG

```bash
bun apps/macos/bin/openscout-menu.ts dmg
```

Or directly:

```bash
apps/macos/scripts/build-dmg.sh
```

Release DMG signing/notarization environment:

- `OPENSCOUT_SIGN_IDENTITY`
- `OPENSCOUT_NOTARY_PROFILE`
- `SKIP_NOTARIZE=1` for local packaging without notarization

## Tool Resolution

The app prefers installed commands first, then falls back to repo-local scripts when running from this checkout.

Optional overrides:

- `OPENSCOUT_RUNTIME_BIN`
- `OPENSCOUT_CLI_BIN`
- `OPENSCOUT_BUN_BIN`
- `OPENSCOUT_PAIR_SUPERVISOR_BIN`
- `OPENSCOUT_SIGN_IDENTITY`
- `OPENSCOUT_SETUP_CWD`

`OPENSCOUT_PAIR_SUPERVISOR_BIN` is useful when you want native pairing control outside the repo checkout.

When the menu app launches `scout server start`, it forwards `OPENSCOUT_CLI_BIN`,
`OPENSCOUT_BUN_BIN`, and `OPENSCOUT_SETUP_CWD` so downstream pairing and Codex
sessions can bootstrap Scout MCP without depending on the user's interactive shell.
