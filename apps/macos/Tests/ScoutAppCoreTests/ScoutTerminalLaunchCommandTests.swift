import Foundation
import XCTest
@testable import ScoutAppCore

final class ScoutTerminalLaunchCommandTests: XCTestCase {
    func testWrapsTerminalCommandWithClaudeSessionCleanup() {
        let command = ScoutTerminalLaunchCommand.clearingInheritedClaudeSession(
            executableURL: URL(fileURLWithPath: "/opt/homebrew/bin/herdr"),
            arguments: ["--session", "scout-test"]
        )

        let expectedCleanup = ScoutTerminalLaunchCommand.inheritedClaudeSessionEnvironmentKeys
            .flatMap { ["-u", $0] }
        XCTAssertEqual(command.executableURL.path, "/usr/bin/env")
        XCTAssertEqual(
            command.arguments,
            expectedCleanup + ["/opt/homebrew/bin/herdr", "--session", "scout-test"]
        )
    }

    func testWrapperRemovesClaudeMarkersAndPreservesExplicitPersistenceSetting() async throws {
        let command = ScoutTerminalLaunchCommand.clearingInheritedClaudeSession(
            executableURL: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: []
        )
        let inherited = Dictionary(
            uniqueKeysWithValues: ScoutTerminalLaunchCommand.inheritedClaudeSessionEnvironmentKeys
                .map { ($0, "inherited") }
        )
        let result = try await CommandRunner.run(
            CommandDescriptor(
                executableURL: command.executableURL,
                arguments: command.arguments,
                environment: inherited.merging([
                    "CLAUDE_CODE_FORCE_SESSION_PERSISTENCE": "1",
                ]) { _, new in new }
            )
        )
        let environment = Set(result.stdout.split(separator: "\n").map(String.init))

        XCTAssertEqual(result.exitCode, 0)
        for key in ScoutTerminalLaunchCommand.inheritedClaudeSessionEnvironmentKeys {
            XCTAssertFalse(environment.contains { $0.hasPrefix("\(key)=") })
        }
        XCTAssertTrue(environment.contains("CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1"))
    }
}
