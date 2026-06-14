# Releasing OpenScout

Scope: how to cut a release of the public npm package and the macOS app installer.

The npm package and the `.dmg` are independent artifacts but are typically
shipped at the same version so the helper app matches the runtime it pairs
with.

## Artifacts

- **npm package** (published to the public registry)
  - `@openscout/scout` (the `scout` CLI, bundled broker/runtime, and web UI)
- **macOS app installer**
  - `apps/macos/dist/OpenScout.app`
  - `apps/macos/dist/OpenScout-<version>.dmg` (signed + notarized)
  - `apps/macos/dist/OpenScout.dmg` (stable local alias for release upload)

## Prerequisites

Before your first release, make sure the following are set up locally.

### npm

- Preferred: configure npm trusted publishing for `@openscout/scout`:
  - owner/repo: `arach/openscout`
  - workflow filename: `release-package-npm.yml`
  - allowed action: `npm publish`
- Fallback: add a GitHub repository secret named `NPM_TOKEN` with publish
  access.
- The npm release workflow runs on macOS arm64 because the package includes the
  native `scoutd` executable. Configure
  `MACOS_DEVELOPER_ID_APPLICATION_P12_BASE64`,
  `MACOS_DEVELOPER_ID_APPLICATION_P12_PASSWORD`, and
  `MACOS_RELEASE_KEYCHAIN_PASSWORD` in the Production environment.
- For local emergency publishing, `~/.npmrc` must contain
  `//registry.npmjs.org/:_authToken=...`, or export `NPM_TOKEN` in the shell
  before publishing. Confirm publish access with `npm whoami`.

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

Normal releases should publish npm through GitHub Actions:

```bash
npm run ship -- 0.2.68 --execute --yes --github-npm
```

This verifies the internal builds and packed public manifest locally, pushes the
tag, creates the GitHub release, then dispatches
`.github/workflows/release-package-npm.yml` to publish `@openscout/scout` from
the release tag. The workflow imports the Developer ID Application certificate
and requires the packaged `scoutd` binary to be a Developer ID signed macOS
arm64 Mach-O before publishing.

For manual recovery or an emergency local publish, the lower-level helper still
builds the internal packages, verifies the packed public manifest, and publishes
only `@openscout/scout`.

```bash
bash scripts/ship-npm.sh --dry-run
bash scripts/ship-npm.sh
```

The public package carries the bundled broker/runtime and web UI. Installing it
does not start anything automatically; `scout setup`, `scout up`, and
`scout server start` are explicit activation paths.

`scripts/ship-npm.sh` exports `OPENSCOUT_REQUIRE_SCOUTD_SIGN=1` by default, so
both local dry runs and npm's publish-time `prepack` rebuild verify the native
broker signature.

Verify:

```bash
npm view @openscout/scout version
```

## Building the macOS DMG

The app bundle and DMG are built locally from `apps/macos/` through Hudson's
file-path packager. This path intentionally does not require Hudson to be
checked out or vendored by CI.

By default the script expects the sibling checkout at `../hudson`. Override with
`HUDSON_DIR` or `HKIT_BIN` when using a different local path.

```bash
# One-shot: build app bundle, create DMG, codesign, notarize, staple.
./apps/macos/scripts/build-dmg.sh 0.2.41
```

`build-dmg.sh` resolves the version from its first argument, then `VERSION`
env, then the repo root `package.json`. It will:

1. Build the SwiftPM app products.
2. Assemble `apps/macos/dist/OpenScout.app` with `ScoutMenu.app` embedded
   under `Contents/Library/LoginItems`.
3. Stage `OpenScout.app` with an `/Applications` symlink and write the Finder
   installer layout.
4. Produce `apps/macos/dist/OpenScout-<version>.dmg` and the stable local alias
   `apps/macos/dist/OpenScout.dmg`.
5. `codesign` the app bundles and DMG with the Developer ID identity.
6. Submit to `notarytool` with `--wait`, then `stapler staple` the result.
7. `spctl --assess` the final DMG.

The native `scoutd` daemon is signed separately when the public CLI package
stages `packages/cli/bin/scoutd`. The signing helper uses
`OPENSCOUT_SCOUTD_SIGN_IDENTITY` first, then `OPENSCOUT_SIGN_IDENTITY`, then
the first keychain Developer ID Application identity. Local builds can fall back
to Apple Development or ad hoc signing. Release lanes that must enforce
Developer ID signing set `OPENSCOUT_REQUIRE_SCOUTD_SIGN=1`.

`apps/macos/dist/` is gitignored — artifacts do not land in git. Attach the
DMG to a GitHub release (or similar) for distribution.

### Skip notarization for quick local builds

```bash
SKIP_NOTARIZE=1 ./apps/macos/scripts/build-dmg.sh 0.2.41
```

The DMG is still signed, just not submitted for notarization.

### Ship the local DMG to a GitHub release

```bash
npm run ship:macos -- v0.2.70
```

The macOS ship command builds/notarizes the DMG locally, then uploads both:

- `apps/macos/dist/OpenScout-<version>.dmg`
- `apps/macos/dist/OpenScout.dmg`

It uses `gh release upload` when the release exists. If the tag exists but no
GitHub release exists yet, it creates the release with `--verify-tag` and then
uploads the assets. The website download CTA points at GitHub's latest-release
`OpenScout.dmg` asset:

```plaintext
https://github.com/arach/openscout/releases/latest/download/OpenScout.dmg
```

Use `--clobber` only when intentionally replacing existing release assets:

```bash
npm run ship:macos -- v0.2.70 --clobber
```

To upload an already-built DMG without rebuilding:

```bash
npm run ship:macos -- v0.2.70 --skip-build
```

Tag `app-ios-v<version>` to run the iOS App Store Connect upload. The tag
version must match the root `package.json` version because
`apps/ios/scripts/release.sh` uses that manifest as the iOS marketing version.
The runner must have the `asc` CLI available, or `OPENSCOUT_ASC_BIN` must point
to it. `OPENSCOUT_ASC_APP_ID` can override the default App Store app id.

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
  launchctl kickstart -k gui/$(id -u)/dev.openscout
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
