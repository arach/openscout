// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OpenScoutMenu",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "OpenScoutMenu", targets: ["OpenScoutMenu"]),
        .executable(name: "Scout", targets: ["Scout"]),
    ],
    dependencies: [
        .package(path: "../../../hudson"),
        .package(path: "../../packages/scout-native-core"),
    ],
    targets: [
        .executableTarget(
            name: "OpenScoutMenu",
            dependencies: [
                "ScoutSharedUI",
                .product(name: "ScoutNativeCore", package: "scout-native-core"),
            ],
            path: "Sources/OpenScoutMenu"
        ),
        .target(
            name: "ScoutSharedUI",
            dependencies: [
                .product(name: "ScoutNativeCore", package: "scout-native-core"),
            ],
            path: "Sources/ScoutSharedUI"
        ),
        .executableTarget(
            name: "Scout",
            dependencies: [
                "ScoutSharedUI",
                .product(name: "HudsonShell", package: "hudson"),
                .product(name: "HudsonUI", package: "hudson"),
            ],
            path: "Sources/Scout"
        ),
    ]
)
