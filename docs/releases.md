# Releases

OpenScout releases are coordinated through one orchestrator:

```bash
npm run ship -- patch
npm run ship -- 0.2.64 --execute --yes
npm run ship -- 0.2.64 --execute --yes --github-npm
```

The default mode is a dry run. It prints the version plan and the commands that
would run. Passing `--execute --yes` performs the release.

The orchestrator keeps the root `package.json` release version in sync with the
public `@openscout/scout` package version, then runs the release train:

- bump root and `@openscout/scout` manifests
- verify the internal builds and packed public manifest
- build the signed/notarized macOS DMG as `OpenScoutMenu-<version>.dmg`
- commit the version bump and create `v<version>`
- push the branch and tag
- create the GitHub release and upload the DMG
- publish `@openscout/scout` from GitHub Actions when `--github-npm` is used

iOS remains opt-in because it touches App Store Connect:

```bash
npm run ship -- 0.2.64 --execute --yes --include-ios
```

Useful skips:

```bash
npm run ship -- 0.2.64 --execute --yes --skip-dmg
npm run ship -- 0.2.64 --execute --yes --skip-github-release
npm run ship -- 0.2.64 --execute --yes --skip-npm
npm run ship -- 0.2.64 --execute --yes --github-npm
```

Use `--github-npm` for the normal public release path. It still runs the npm
dry-run build locally before tagging, but the real publish happens when the
release helper dispatches `.github/workflows/release-package-npm.yml` after
creating the GitHub release.
Configure npm trusted publishing for package `@openscout/scout` with:

- owner/repo: `arach/openscout`
- workflow filename: `release-package-npm.yml`
- allowed action: `npm publish`

If trusted publishing is not configured yet, add a GitHub repository secret
named `NPM_TOKEN` with publish access; the workflow supports that as a fallback.

The script refuses to execute from a dirty worktree unless `--allow-dirty` is
passed. Prefer a clean release branch so the `Release v<version>` commit and tag
represent exactly what was shipped.

## GitHub Actions release lanes

Routine pull requests run the Linux typecheck/unit workflow only. Merges to
`main` do not run CI unless they deploy the landing site.

- `candidate-v*` runs `Release Candidate`: Linux checks, native macOS/iOS
  simulator checks, package dry-runs, and runtime scenarios.
- `npm-v*` runs `Release Package npm` and publishes `@openscout/scout`.
- `app-macos-v*` runs `Release App macOS` and builds/uploads the signed,
  notarized DMG.
- `app-ios-v*` runs `Release App iOS` and uploads through App Store Connect.
