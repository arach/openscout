// swift-tools-version: 6.0
import PackageDescription

let hudsonSource = Context.environment["OPENSCOUT_HUDSON_SOURCE"] ?? "path"
let hudsonDependency: Package.Dependency = hudsonSource == "git"
    ? .package(url: "git@github.com:arach/hudson.git", branch: "main")
    : .package(path: "../../../hudson")

let package = Package(
    name: "ScoutMenu",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "ScoutMenu", targets: ["ScoutMenu"]),
        .executable(name: "Scout", targets: ["Scout"]),
    ],
    dependencies: [
        hudsonDependency,
        .package(path: "../../packages/scout-native-core"),
    ],
    targets: [
        .executableTarget(
            name: "ScoutMenu",
            dependencies: [
                "ScoutAppCore",
                "ScoutHUD",
                "ScoutSharedUI",
                .product(name: "ScoutNativeCore", package: "scout-native-core"),
            ],
            path: "Sources/ScoutMenu"
        ),
        .target(
            name: "ScoutAppCore",
            dependencies: [
                .product(name: "ScoutNativeCore", package: "scout-native-core"),
                .product(name: "ScoutCapabilities", package: "scout-native-core"),
            ],
            path: "Sources/ScoutAppCore"
        ),
        .target(
            name: "ScoutHUD",
            dependencies: [
                "ScoutAppCore",
                "ScoutSharedUI",
                .product(name: "ScoutNativeCore", package: "scout-native-core"),
            ],
            path: "Sources/ScoutHUD"
        ),
        .target(
            name: "ScoutSharedUI",
            dependencies: [
                .product(name: "HudsonVoice", package: "hudson"),
                .product(name: "ScoutNativeCore", package: "scout-native-core"),
            ],
            path: "Sources/ScoutSharedUI"
        ),
        .executableTarget(
            name: "Scout",
            dependencies: [
                "ScoutAppCore",
                "ScoutHUD",
                "ScoutSharedUI",
                .product(name: "ScoutCapabilities", package: "scout-native-core"),
                .product(name: "HudsonShell", package: "hudson"),
                .product(name: "HudsonUI", package: "hudson"),
            ],
            path: "Sources/Scout"
        ),
        .testTarget(
            name: "ScoutAppCoreTests",
            dependencies: [
                "ScoutAppCore",
                .product(name: "ScoutCapabilities", package: "scout-native-core"),
            ],
            path: "Tests/ScoutAppCoreTests"
        ),
        .testTarget(
            name: "ScoutMenuTests",
            dependencies: [
                "ScoutMenu",
            ],
            path: "Tests/ScoutMenuTests"
        ),
    ]
)
