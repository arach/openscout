# Releasing OpenScout

Scope: how to cut a release of the public npm package and the macOS menu bar helper.

The npm package and the `.dmg` are independent artifacts but are typically
shipped at the same version so the helper app matches the runtime it pairs
with.

## Artifacts

- **npm package** (published to the public registry)
  - `@openscout/scout` (the `scout` CLI, bundled broker/runtime, and web UI)
- **macOS helper**
  - `apps/macos/dist/OpenScoutMenu.app`
  - `apps/macos/dist/OpenScoutMenu.dmg` (signed + notarized)

## Prerequisites

Before your first release, make sure the following are set up locally.

### npm

- `~/.npmrc` must contain `//registry.npmjs.org/:_authToken=...`, or export
  `NPM_TOKEN` in the shell before publishing. An automation token avoids the
  OTP prompt.
- Confirm publish access: `npm whoami` and `npm access list packages`.

### macOS signing + notarization

- A `Developer ID Application` identity in the login keychain
  (`security find-identity -v -p codesigning` should list one).
- A notarytool keychain profile. The default profile name is `notarytool`:
  ```bash
  xcrun notarytool store-credentials notarytool \
    --apple-id <apple-id> \
    --team-id <team-id> \
    --password <app-specific-password>
  ```
- Verify the profile: `xcrun notarytool history --keychain-profile notarytool`.

Overrides:

- `OPENSCOUT_SIGN_IDENTITY` — pick a specific identity instead of the
  auto-discovered one.
- `OPENSCOUT_NOTARY_PROFILE` — use a different notarytool profile name.
- `SKIP_NOTARIZE=1` — local packaging only; produces an unnotarized DMG.

## E2E agent pass

For normal development, keep the faster checks focused:

```bash
bun run check
bun run test:scenarios
```

Before a larger release, or whenever broker/harness changes need more
confidence, run the opt-in e2e agent pass as well:

```bash
bun run test:e2e
```

The final step starts real Codex and Claude-backed local agents through the
broker, so it requires authenticated local CLIs and is intentionally not part of
the default check path.

You can also run only the agent pass with an open-ended mission:

```bash
bun run test:e2e:agents -- \
  --mission "Verify docs freshness and update the project KB if a small stale note is obvious."
```

The mission and exact prompts are saved with the broker artifacts. Set
`OPENSCOUT_KEEP_LIVE_PASS=1` or pass `--keep` to preserve the broker snapshot,
event log, prompts, and ask transcripts when investigating a failure.

## Version bump

The root manifest and public `@openscout/scout` package are versioned in
lockstep. Internal workspace packages remain private implementation boundaries
and do not need public release bumps.

```bash
npm run bump -- patch
git add package.json packages/cli/package.json
git commit -m "Release v0.2.41"
```

Intra-workspace deps use `workspace:*`. Private packages can stay modular
inside the repo without becoming public npm artifacts.

## Publishing npm

The release helper builds the internal packages, verifies the packed public
manifest, and publishes only `@openscout/scout`.

```bash
bash scripts/ship-npm.sh --dry-run
bash scripts/ship-npm.sh
```

The public package carries the bundled broker/runtime and web UI. Installing it
does not start anything automatically; `scout setup`, `scout up`, and
`scout server start` are explicit activation paths.

Verify:

```bash
npm view @openscout/scout version
```

## Building the macOS DMG

The helper app bundle and DMG are built from `apps/macos/`:

```bash
# One-shot: build app bundle, create DMG, codesign, notarize, staple.
./apps/macos/scripts/build-dmg.sh 0.2.41
```

`build-dmg.sh` resolves the version from its first argument, then
`VERSION` env, then the repo root `package.json`. It will:

1. Run `bun apps/macos/bin/openscout-menu.ts build --version <v>` to produce
   `apps/macos/dist/OpenScoutMenu.app`.
2. Stage the `.app` with an `/Applications` symlink and run `hdiutil create`
   to produce `apps/macos/dist/OpenScoutMenu.dmg` (UDZO).
3. `codesign` the DMG with the Developer ID identity.
4. Submit to `notarytool` with `--wait`, then `stapler staple` the result.
5. `spctl --assess` the final DMG.

`apps/macos/dist/` is gitignored — artifacts do not land in git. Attach the
DMG to a GitHub release (or similar) for distribution.

### Skip notarization for quick local builds

```bash
SKIP_NOTARIZE=1 ./apps/macos/scripts/build-dmg.sh 0.2.41
```

The DMG is still signed, just not submitted for notarization.

### Lower-level entry point

`openscout-menu.ts` also exposes a `dmg` subcommand if you want the helper
to orchestrate signing without the shell wrapper:

```bash
bun apps/macos/bin/openscout-menu.ts dmg
```

The shell script stays the source of truth for release builds because it
fails fast when signing or notarization is misconfigured.

## After publishing

- **Push the bump commit**: `git push origin main`.
- **Upgrade the global `scout` CLI** — prefer `bun install -g` over
  `npm -g` through Homebrew's node, since `~/.bun/bin` is earlier on PATH
  and stays user-owned:
  ```bash
  bun install -g @openscout/scout
  ```
- **Restart the local broker** so it picks up the newly bundled runtime:
  ```bash
  launchctl kickstart -k gui/$(id -u)/dev.openscout.broker
  curl -s http://localhost:65535/health | jq
  ```

## Semver conventions

Pre-1.0. Current practice is to bump the **patch** (`0.2.x`) for additive
protocol, runtime, CLI, or UI changes. Reserve a **minor** bump for
control-plane schema changes that require a migration users cannot skip, or for
protocol changes that break 0.2.x consumers. Keep the root manifest and
`@openscout/scout` lockstep.

## Troubleshooting

- `npm error You cannot publish over the previously published versions`:
  the version in the working tree was already published from a prior
  session. Bump the patch again before retrying.
- `notarytool profile '<name>' is not configured`: run
  `xcrun notarytool store-credentials <name>` and verify with
  `xcrun notarytool history --keychain-profile <name>`.
- `No Developer ID Application identity found`: install the cert into the
  login keychain, or set `OPENSCOUT_SIGN_IDENTITY` to a matching identity.
