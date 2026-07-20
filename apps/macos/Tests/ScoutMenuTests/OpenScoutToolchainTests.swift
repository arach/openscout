import Foundation
@testable import ScoutMenu
import XCTest

final class OpenScoutToolchainTests: XCTestCase {
    func testRepoToolchainUsesBuiltScoutdWithoutLaunchEnvironmentGate() throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "openscout-menu-toolchain-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        let cliEntrypoint = root.appending(path: "packages/cli/src/main.ts")
        let runtimeEntrypoint = root.appending(path: "packages/runtime/bin/openscout-runtime.mjs")
        let scoutd = root.appending(path: "target/release/scoutd")
        for file in [cliEntrypoint, runtimeEntrypoint, scoutd] {
            try FileManager.default.createDirectory(
                at: file.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try Data().write(to: file)
        }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: scoutd.path
        )

        let toolchain = OpenScoutToolchain(environment: [
            "OPENSCOUT_SETUP_CWD": root.path,
        ])
        let command = try toolchain.runtimeServiceCommand(subcommand: "status")

        XCTAssertEqual(command.executableURL.standardizedFileURL, scoutd.standardizedFileURL)
        XCTAssertEqual(command.arguments, ["status", "--json"])
        XCTAssertEqual(command.environment["OPENSCOUT_SCOUTD_BIN"], scoutd.path)
    }
}
