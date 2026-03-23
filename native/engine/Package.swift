// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "ScoutEngine",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(
            name: "ScoutCore",
            targets: ["ScoutCore"]
        ),
        .executable(
            name: "ScoutApp",
            targets: ["ScoutApp"]
        ),
        .executable(
            name: "ScoutAgent",
            targets: ["ScoutAgent"]
        ),
    ],
    targets: [
        .target(
            name: "ScoutCore",
            path: "CoreSources"
        ),
        .executableTarget(
            name: "ScoutApp",
            dependencies: ["ScoutCore"],
            path: "Sources/ScoutApp",
            resources: [
                .process("Resources"),
            ]
        ),
        .executableTarget(
            name: "ScoutAgent",
            dependencies: ["ScoutCore"],
            path: "Sources/ScoutAgent"
        ),
    ]
)
