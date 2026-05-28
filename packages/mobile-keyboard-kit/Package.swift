// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MobileKeyboardKit",
    platforms: [
        .iOS(.v17),
    ],
    products: [
        .library(
            name: "MobileKeyboardKit",
            targets: ["MobileKeyboardKit"]
        ),
    ],
    targets: [
        .target(name: "MobileKeyboardKit"),
    ]
)
