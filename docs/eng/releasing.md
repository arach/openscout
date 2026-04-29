# Releasing OpenScout

Scope: how to cut a release of the npm packages and the macOS menu bar helper.

The npm packages and the `.dmg` are independent artifacts but are typically
shipped at the same version so the helper app matches the runtime it pairs
with.

## Artifacts

- **npm packages** (published to the public registry)
  - `@openscout/protocol`
  - `@openscout/runtime`
  - `@openscout/web`
  - `@openscout/scout` (the `scout` CLI)
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

All four npm packages are versioned in lockstep. Bump them together in a
single commit.

```bash
# Edit each package.json manually, or use a helper:
for f in packages/{protocol,runtime,web,cli}/package.json; do
  sed -i '' 's/"version": "0.2.40"/"version": "0.2.41"/' "$f"
done

git add packages/{protocol,runtime,web,cli}/package.json
git commit -m "🔖 Bump all packages to 0.2.41"
```

Intra-workspace deps use `workspace:*`; the `prepack` script runs
`scripts/prepare-publish-manifest.mjs` to rewrite those to the concrete
version at pack time, and `postpublish` restores the workspace form.

## Publishing npm packages

Publish in dependency order so a consumer that pulls `@openscout/runtime`
can always resolve a matching `@openscout/protocol`.

```bash
cd packages/protocol && npm publish --access public
cd ../runtime         && npm publish --access public
cd ../web             && npm publish --access public
cd ../cli             && npm publish --access public  # @openscout/scout
```

Each package's `prepack` runs `npm run build` (`rm -rf dist && tsc`), so you
do not need a separate build step.

Verify:

```bash
for pkg in @openscout/protocol @openscout/runtime @openscout/web @openscout/scout; do
  echo -n "$pkg: "; npm view "$pkg" version
done
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
- **Restart the local broker** so it picks up the newly built runtime dist:
  ```bash
  launchctl kickstart -k gui/$(id -u)/dev.openscout.broker
  curl -s http://localhost:65535/health | jq
  ```

## Semver conventions

Pre-1.0. Current practice is to bump the **patch** (`0.2.x`) for additive
protocol or runtime changes. Reserve a **minor** bump for control-plane
schema changes that require a migration users cannot skip, or for protocol
changes that break 0.2.x consumers. Keep bumps lockstep across the four
packages.

## Troubleshooting

- `npm error You cannot publish over the previously published versions`:
  the version in the working tree was already published from a prior
  session. Bump the patch again before retrying.
- `notarytool profile '<name>' is not configured`: run
  `xcrun notarytool store-credentials <name>` and verify with
  `xcrun notarytool history --keychain-profile <name>`.
- `No Developer ID Application identity found`: install the cert into the
  login keychain, or set `OPENSCOUT_SIGN_IDENTITY` to a matching identity.
