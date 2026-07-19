// swift-tools-version: 6.0
import PackageDescription

let hudsonSource = Context.environment["OPENSCOUT_HUDSON_SOURCE"] ?? "path"
let hudsonDependency: Package.Dependency = hudsonSource == "git"
    ? .package(url: "git@github.com:arach/hudson.git", branch: "main")
    : .package(path: "../../../hudson")

let terminalEnabled = Context.environment["HUDSONKIT_WITH_TERMINAL"] == "1"
let terminiPackageName = Context.environment["HUDSON_TERMINI_PACKAGE"] ?? "termini"
let terminiDependency: Package.Dependency = {
    let url = Context.environment["HUDSON_TERMINI_GIT_URL"] ?? "git@github.com:arach/Termini.git"
    if let revision = Context.environment["HUDSON_TERMINI_GIT_REVISION"], !revision.isEmpty {
        return .package(url: url, revision: revision)
    }
    return .package(url: url, branch: Context.environment["HUDSON_TERMINI_GIT_BRANCH"] ?? "main")
}()

let terminalDependencies: [Target.Dependency] = terminalEnabled ? [
    .product(name: "HudsonTerminal", package: "hudson"),
    .product(name: "Termini", package: terminiPackageName),
] : []

let terminalSwiftSettings: [SwiftSetting] = terminalEnabled ? [
    .define("HUDSON_TERMINAL"),
] : []

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
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.7.0"),
    ] + (terminalEnabled ? [terminiDependency] : []),
    targets: [
        .executableTarget(
            name: "ScoutMenu",
            dependencies: [
                "ScoutAppCore",
                "ScoutHUD",
                "ScoutSharedUI",
                .product(name: "ScoutNativeCore", package: "scout-native-core"),
                .product(name: "HudsonObservability", package: "hudson"),
                .product(name: "HudsonUI", package: "hudson"),
                .product(name: "HudsonShell", package: "hudson"),
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
                .product(name: "HudsonObservability", package: "hudson"),
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
                .product(name: "HudsonObservability", package: "hudson"),
                .product(name: "HudsonShell", package: "hudson"),
                .product(name: "HudsonUI", package: "hudson"),
                .product(name: "Sparkle", package: "Sparkle"),
            ] + terminalDependencies,
            path: "Sources/Scout",
            swiftSettings: terminalSwiftSettings
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
        .testTarget(
            name: "ScoutHUDTests",
            dependencies: [
                "ScoutHUD",
                "ScoutAppCore",
            ],
            path: "Tests/ScoutHUDTests"
        ),
    ]
)
