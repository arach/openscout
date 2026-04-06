# /ship-scout - Ship Scout (iOS + macOS)

Build, sign, and release Scout for one or both platforms.

## Usage

```
/ship-scout                 # both platforms (default)
/ship-scout ios             # iOS only → App Store Connect
/ship-scout mac             # macOS only → signed + notarized DMG + GitHub release
/ship-scout npm             # npm packages only → @openscout/protocol, runtime, cli
/ship-scout --same-version  # both platforms, skip patch bump
```

## Instructions

Parse the arguments to determine which platforms to ship and whether to bump the patch version.

**Platform detection:**
- No args or `both` → ship both platforms (use `bun run ship`)
- `ios` → iOS only (use `bun run ship:ios`)
- `mac`, `macos`, or `app` → macOS DMG only (use `bun run ship:app`)
- `npm` → npm packages only (use `bun run ship:npm`)
- `--same-version` → append `-- --same-version` to the iOS invocation; macOS/npm unaffected

**For iOS:**
```bash
cd /Users/arach/dev/openscout && bun run ship:ios
# with --same-version:
cd /Users/arach/dev/openscout && bash scout/ios/scripts/release.sh --same-version
```

**For macOS:**
```bash
cd /Users/arach/dev/openscout && bun run ship:mac
```

**For npm:**
```bash
cd /Users/arach/dev/openscout && bun run ship:npm
```

**When shipping both:**
```bash
cd /Users/arach/dev/openscout && bun run ship
```

Run as a background task and wait for completion before reporting.

**Output:**
- One-line status per platform as each finishes: `✓ iOS — build N uploaded` or `✓ macOS — vX.Y.Z tagged and DMG uploaded to GitHub`
- If either fails, show the error and which platform failed
