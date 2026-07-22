## Scout iOS

This directory contains the Scout iOS app, the mobile human surface for the
same broker/runtime that powers the desktop and CLI. Once the agent substrate
exists, this app is where a human reaches, reads, and responds to their agents
without treating mobile as a separate product.

Status:
- the HudsonKit-first implementation is the active Scout iOS app
- the legacy ScoutApp target has been removed
- `apps/ios/Scout` is the source root for new mobile-facing work
- Scout owns `scout://` pairing and native auth links

Project notes:
- XcodeGen project definition: [project.yml](./project.yml)
- source root: [Scout](./Scout)
- scheme: `Scout`
- bundle id: `app.openscout.scout`

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

Debug iPad builds load the signed, app-bundled Lanes and Dispatch pages. Set
`SCOUT_REMOTE_WEB_SURFACES=1` in an Xcode run scheme only when intentionally
troubleshooting the transitional host-served versions. Release keeps its
existing gated behavior until the SCO-089 renderer cutover is complete.

Use an explicit `xcodebuild -derivedDataPath` for any flow that reuses a prior
device build. Do not guess the latest build by scanning DerivedData.

## App Store prep

- The iOS marketing version should track the repo root npm version from [package.json](../../package.json).
- [scripts/release.sh](./scripts/release.sh) regenerates the Xcode project from [project.yml](./project.yml), resolves the next build number from App Store Connect with `asc`, uploads the archive, attaches the build to the current App Store draft, and runs `asc validate`.
- `asc validate` still requires App Store Connect-side completeness, especially pricing/availability, screenshots, and published App Privacy data.
