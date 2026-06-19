# SCO-061 — Scout iOS HudsonKit Cutover

## Status

Cutover branch state: the HudsonKit-first iOS implementation is now the Scout
iOS app.

- Active source root: `apps/ios/Scout`
- Active Xcode target and scheme: `Scout`
- Product and display name: `Scout`
- Bundle identifier: `app.openscout.scout`
- Pairing URL scheme: `scout://`
- Legacy iOS app target: removed

## Current Shape

The iOS app is built around shared capability contracts and the iOS bridge
substrate:

```
packages/scout-native-core
  ScoutCapabilities      semantic contracts, projections, pure behavior

packages/scout-ios-core
  ScoutIOSCore           BridgeBrokerClient, pairing, route selection,
                         connection log, transport classification

apps/ios/Scout
  Scout                  HudsonKit-first mobile app surface
```

`Scout` depends on `Hudson`, `ScoutCapabilities`, and `ScoutIOSCore`. The old
bespoke SwiftUI app no longer owns a target, scheme, URL type, or test host.

## Product Rules

- New mobile-facing work lands in `apps/ios/Scout`.
- Shared transport, pairing, and broker-client behavior lands in
  `packages/scout-ios-core`.
- Shared semantic app contracts land in `packages/scout-native-core`.
- Mobile pairing links use `scout://pair?...`.
- Do not reintroduce `ScoutNext` names for targets, schemes, bundle ids, or
  user-facing copy.

## Verification

Use the narrowest relevant checks:

```bash
swift test --package-path packages/scout-ios-core
HUDSONKIT_WITH_TERMINAL=1 xcodebuild -project apps/ios/Scout.xcodeproj -scheme Scout -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath apps/ios/build/dd-scout build
```
