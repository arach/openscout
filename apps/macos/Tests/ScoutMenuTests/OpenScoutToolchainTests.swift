import Foundation
@testable import ScoutMenu
import XCTest

final class OpenScoutToolchainTests: XCTestCase {
    func testRepoPairingControllerWinsOverInstalledFallbacks() throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "openscout-menu-pairing-toolchain-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        let cliEntrypoint = root.appending(path: "packages/cli/src/main.ts")
        let runtimeEntrypoint = root.appending(path: "packages/runtime/bin/openscout-runtime.mjs")
        let pairingController = root.appending(path: "packages/cli/dist/pairing-runtime-controller.mjs")
        for file in [cliEntrypoint, runtimeEntrypoint, pairingController] {
            try FileManager.default.createDirectory(
                at: file.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try Data().write(to: file)
        }

        let toolchain = OpenScoutToolchain(environment: [
            "OPENSCOUT_SETUP_CWD": root.path,
            "OPENSCOUT_BUN_BIN": "/usr/bin/true",
            "PATH": "",
        ])
        let command = try toolchain.pairingRuntimeControllerCommand()

        XCTAssertEqual(command.arguments, [pairingController.path])
        XCTAssertEqual(command.currentDirectoryURL?.standardizedFileURL, root.standardizedFileURL)
    }

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
