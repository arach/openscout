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
    ],
    targets: [
        .executableTarget(
            name: "OpenScoutMenu",
            dependencies: [
                .product(name: "ScoutNativeCore", package: "scout-native-core"),
            ],
            path: "Sources"
        ),
    ]
)
