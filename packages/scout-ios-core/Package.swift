// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ScoutIOSCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "ScoutIOSCore",
            targets: ["ScoutIOSCore"]
        ),
    ],
    targets: [
        .target(name: "ScoutIOSCore"),
        .testTarget(
            name: "ScoutIOSCoreTests",
            dependencies: ["ScoutIOSCore"]
        ),
    ]
)
