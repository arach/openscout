# Releases

OpenScout releases are coordinated through one orchestrator:

```bash
npm run ship -- patch
npm run ship -- 0.2.64 --execute --yes
```

The default mode is a dry run. It prints the version plan and the commands that
would run. Passing `--execute --yes` performs the release.

The orchestrator keeps the root `package.json` release version in sync with the
published npm package versions, then runs the release train:

- bump root and published package manifests
- verify npm package builds and packed manifests
- build the signed/notarized macOS DMG as `OpenScoutMenu-<version>.dmg`
- commit the version bump and create `v<version>`
- push the branch and tag
- publish npm packages
- create the GitHub release and upload the DMG

iOS remains opt-in because it touches App Store Connect:

```bash
npm run ship -- 0.2.64 --execute --yes --include-ios
```

Useful skips:

```bash
npm run ship -- 0.2.64 --execute --yes --skip-dmg
npm run ship -- 0.2.64 --execute --yes --skip-github-release
npm run ship -- 0.2.64 --execute --yes --skip-npm
```

The script refuses to execute from a dirty worktree unless `--allow-dirty` is
passed. Prefer a clean release branch so the `Release v<version>` commit and tag
represent exactly what was shipped.
