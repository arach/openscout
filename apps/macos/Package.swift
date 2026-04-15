// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OpenScoutMenu",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "OpenScoutMenu", targets: ["OpenScoutMenu"]),
    ],
    targets: [
        .executableTarget(
            name: "OpenScoutMenu",
            path: "Sources"
        ),
    ]
)
