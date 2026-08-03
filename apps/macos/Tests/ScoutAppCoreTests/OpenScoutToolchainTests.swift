import Foundation
@testable import ScoutAppCore
import XCTest

final class OpenScoutToolchainTests: XCTestCase {
    func testPairingControllerWatchesItsNativeOwner() throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "openscout-core-pairing-toolchain-\(UUID().uuidString)")
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
            "OPENSCOUT_PARENT_PID": "1",
            "PATH": "",
        ])
        let command = try toolchain.pairingRuntimeControllerCommand()

        XCTAssertEqual(
            command.environment["OPENSCOUT_PARENT_PID"],
            String(ProcessInfo.processInfo.processIdentifier)
        )
    }
}
