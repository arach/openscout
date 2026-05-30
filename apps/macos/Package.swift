// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OpenScoutMenu",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "OpenScoutMenu", targets: ["OpenScoutMenu"]),
    ],
    dependencies: [
        .package(path: "../../packages/scout-native-core"),
        .package(url: "https://github.com/arach/hudson.git", branch: "feat/share-primitive"),
        .package(path: "../../../vox/swift"),
    ],
    targets: [
        .executableTarget(
            name: "OpenScoutMenu",
            dependencies: [
                .product(name: "ScoutNativeCore", package: "scout-native-core"),
                .product(name: "HudsonShell", package: "Hudson"),
                .product(name: "HudsonUI", package: "Hudson"),
                .product(name: "VoxCore", package: "swift"),
                .product(name: "VoxEngine", package: "swift"),
            ],
            path: "Sources"
        ),
    ]
)
