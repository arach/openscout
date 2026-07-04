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
    dependencies: [
        .package(path: "../scout-native-core"),
        .package(path: "../../../hudson"),
    ],
    targets: [
        .target(
            name: "ScoutIOSCore",
            dependencies: [
                .product(name: "ScoutCapabilities", package: "scout-native-core"),
                .product(name: "HudsonObservability", package: "hudson"),
            ]
        ),
        .testTarget(
            name: "ScoutIOSCoreTests",
            dependencies: [
                "ScoutIOSCore",
                .product(name: "ScoutCapabilities", package: "scout-native-core"),
            ]
        ),
    ]
)
