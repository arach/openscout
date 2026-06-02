// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ScoutNativeCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "ScoutNativeCore",
            targets: ["ScoutNativeCore"]
        ),
        .library(
            name: "ScoutCapabilities",
            targets: ["ScoutCapabilities"]
        ),
    ],
    targets: [
        .target(name: "ScoutNativeCore"),
        .testTarget(
            name: "ScoutNativeCoreTests",
            dependencies: ["ScoutNativeCore"]
        ),
        // SCO-061: shared semantic capability layer (contracts + pure behavior +
        // conversation projection). Foundation-only — no transport, no UI, no @MainActor.
        .target(name: "ScoutCapabilities"),
        .testTarget(
            name: "ScoutCapabilitiesTests",
            dependencies: ["ScoutCapabilities"]
        ),
    ]
)
