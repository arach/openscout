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
    ],
    targets: [
        .target(name: "ScoutNativeCore"),
        .testTarget(
            name: "ScoutNativeCoreTests",
            dependencies: ["ScoutNativeCore"]
        ),
    ]
)
