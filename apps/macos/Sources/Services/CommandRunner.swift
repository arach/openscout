import Foundation

struct CommandDescriptor: Sendable {
    let executableURL: URL
    let arguments: [String]
    var environment: [String: String] = [:]
    var currentDirectoryURL: URL? = nil

    var displayString: String {
        ([executableURL.path] + arguments).joined(separator: " ")
    }
}

struct CommandResult: Sendable {
    let exitCode: Int32
    let stdout: String
    let stderr: String

    var trimmedStdout: String {
        stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var trimmedStderr: String {
        stderr.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

enum CommandRunnerError: LocalizedError {
    case launchFailed(String)
    case nonZeroExit(String)

    var errorDescription: String? {
        switch self {
        case .launchFailed(let message), .nonZeroExit(let message):
            return message
        }
    }
}

enum CommandRunner {
    static func run(_ descriptor: CommandDescriptor) async throws -> CommandResult {
        try await Task.detached(priority: .utility) {
            let process = Process()
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()

            process.executableURL = descriptor.executableURL
            process.arguments = descriptor.arguments
            process.currentDirectoryURL = descriptor.currentDirectoryURL
            process.environment = mergedEnvironment(overrides: descriptor.environment)
            process.standardInput = nil
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe

            do {
                try process.run()
            } catch {
                throw CommandRunnerError.launchFailed(
                    "Failed to launch \(descriptor.displayString): \(error.localizedDescription)"
                )
            }

            process.waitUntilExit()

            let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
            let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()

            return CommandResult(
                exitCode: process.terminationStatus,
                stdout: String(decoding: stdoutData, as: UTF8.self),
                stderr: String(decoding: stderrData, as: UTF8.self)
            )
        }.value
    }

    static func spawn(_ descriptor: CommandDescriptor) throws -> Process {
        let process = Process()
        process.executableURL = descriptor.executableURL
        process.arguments = descriptor.arguments
        process.currentDirectoryURL = descriptor.currentDirectoryURL
        process.environment = mergedEnvironment(overrides: descriptor.environment)
        process.standardInput = nil
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            return process
        } catch {
            throw CommandRunnerError.launchFailed(
                "Failed to launch \(descriptor.displayString): \(error.localizedDescription)"
            )
        }
    }

    private static func mergedEnvironment(overrides: [String: String]) -> [String: String] {
        ProcessInfo.processInfo.environment.merging(overrides) { _, new in new }
    }
}
