## Scout iOS

This directory contains the Scout iOS app, the mobile human surface for the
same broker/runtime that powers the desktop and CLI. Once the agent substrate
exists, this app is where a human reaches, reads, and responds to their agents
without treating mobile as a separate product.

Status:
- restored intact first to preserve behavior
- product identity is now Scout
- deeper internal renames will land in-place as the mobile surface is aligned
- human-facing copy should describe the app as part of the Scout product, not a sidecar

Expected migration order:
1. user-facing copy and product identity
2. product semantics such as partner surface and inbox/work-state flows
3. deeper internal renames once behavior is stable in Scout

Project notes:
- XcodeGen project definition: [project.yml](./project.yml)
- source root: [Scout](./Scout)

## Local commands

```bash
cd apps/ios
xcodegen generate
open Scout.xcodeproj
```

Device scripts live under `scripts/`:

```bash
apps/ios/scripts/build-device.sh
apps/ios/scripts/install-last-build.sh
apps/ios/scripts/push-device.sh
```

Use an explicit `xcodebuild -derivedDataPath` for any flow that reuses a prior
device build. Do not guess the latest build by scanning DerivedData.

## App Store prep

- The iOS marketing version should track the repo root npm version from [package.json](../../package.json).
- [scripts/release.sh](./scripts/release.sh) regenerates the Xcode project from [project.yml](./project.yml), resolves the next build number from App Store Connect with `asc`, uploads the archive, attaches the build to the current App Store draft, and runs `asc validate`.
- `asc validate` still requires App Store Connect-side completeness, especially pricing/availability, screenshots, and published App Privacy data.
