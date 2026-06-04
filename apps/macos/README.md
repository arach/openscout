# OpenScout macOS

Native macOS shells for OpenScout. The release installer is built through the
local Hudson `hkit package macos` packager and currently installs one app:

- `OpenScout.app` — HudsonKit-native chat/work surface with the menu bar/HUD
  helper embedded under `Contents/Library/LoginItems`

The menu app is intentionally thin:

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

## Menu Helper Bundle

```bash
bun apps/macos/bin/openscout-menu.ts build
```

```bash
bun apps/macos/bin/openscout-menu.ts launch
```

```bash
bun apps/macos/bin/openscout-menu.ts restart
```

The helper command builds the menu-bar helper app for local development. Release
installers are built through `apps/macos/scripts/build-dmg.sh`, which assembles
`OpenScout.app` and embeds the menu helper under `Contents/Library/LoginItems`.

The helper build signs with:

- `Developer ID Application` when available
- otherwise `Apple Development`
- otherwise ad hoc

## Signed Installer DMG

```bash
apps/macos/scripts/build-dmg.sh
```

The DMG script expects the local Hudson checkout at `../hudson` by default and
uses `apps/macos/hudson-package.json` as the packaging contract. Override with:

- `HUDSON_DIR`
- `HKIT_BIN`

Local smoke build without notarization:

```bash
SKIP_NOTARIZE=1 apps/macos/scripts/build-dmg.sh
```

Release DMG signing/notarization environment:

- `OPENSCOUT_SIGN_IDENTITY`
- `OPENSCOUT_NOTARY_PROFILE`
- `SKIP_NOTARIZE=1` for local packaging without notarization

The release artifacts are:

- `apps/macos/dist/OpenScout-<version>.dmg`
- `apps/macos/dist/OpenScout.dmg`

Build, notarize, and attach the DMG to an existing GitHub tag with:

```bash
npm run ship:macos -- v0.2.70
```

The release command creates the GitHub release if the tag exists but no release
exists yet. It uploads both the versioned DMG and the stable `OpenScout.dmg`
alias. Use `--clobber` when intentionally replacing an existing release asset.

To upload an already-built DMG without rebuilding:

```bash
npm run ship:macos -- v0.2.70 --skip-build
```

## Tool Resolution

The app prefers explicit `OPENSCOUT_*` overrides, then repo-local scripts when running from this checkout, then installed commands.

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
