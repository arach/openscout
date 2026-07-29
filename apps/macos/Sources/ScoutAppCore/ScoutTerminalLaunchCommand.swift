import Darwin
import Foundation

/// A native terminal launch that clears identity inherited from the Claude
/// process which built or restarted Scout. Without this boundary, a fresh
/// Claude inside a Scout terminal can be mistaken for a nested child session
/// and silently disable transcript persistence.
public struct ScoutTerminalLaunchCommand: Equatable, Sendable {
    public static let inheritedClaudeSessionEnvironmentKeys = [
        "CLAUDECODE",
        "CLAUDE_CODE_CHILD_SESSION",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_SESSION_ID",
        "CLAUDE_CODE_REMOTE",
        "CLAUDE_CODE_REMOTE_SESSION_ID",
        "CLAUDE_PID",
    ]

    public let executableURL: URL
    public let arguments: [String]

    /// Clear parent-Claude identity as soon as the native app starts so every
    /// subprocess it launches begins from a top-level application environment.
    public static func clearInheritedClaudeSessionFromCurrentProcess() {
        for key in inheritedClaudeSessionEnvironmentKeys {
            unsetenv(key)
        }
    }

    public static func clearingInheritedClaudeSession(
        executableURL: URL,
        arguments: [String]
    ) -> ScoutTerminalLaunchCommand {
        let unsetArguments = inheritedClaudeSessionEnvironmentKeys.flatMap { ["-u", $0] }
        return ScoutTerminalLaunchCommand(
            executableURL: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: unsetArguments + [executableURL.path] + arguments
        )
    }
}
