// swift-tools-version: 6.0
import PackageDescription

let hudsonSource = Context.environment["OPENSCOUT_HUDSON_SOURCE"] ?? "path"
let hudsonDependency: Package.Dependency = hudsonSource == "git"
    ? .package(url: "git@github.com:arach/hudson.git", branch: "main")
    : .package(path: "../../../hudson")

let package = Package(
    name: "OpenScoutMenu",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "OpenScoutMenu", targets: ["OpenScoutMenu"]),
        .executable(name: "Scout", targets: ["Scout"]),
    ],
    dependencies: [
        hudsonDependency,
        .package(path: "../../packages/scout-native-core"),
    ],
    targets: [
        .executableTarget(
            name: "OpenScoutMenu",
            dependencies: [
                "ScoutAppCore",
                "ScoutSharedUI",
                .product(name: "ScoutNativeCore", package: "scout-native-core"),
            ],
            path: "Sources/OpenScoutMenu"
        ),
        .target(
            name: "ScoutAppCore",
            path: "Sources/ScoutAppCore"
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
                "ScoutSharedUI",
                .product(name: "HudsonShell", package: "hudson"),
                .product(name: "HudsonUI", package: "hudson"),
            ],
            path: "Sources/Scout"
        ),
    ]
)
