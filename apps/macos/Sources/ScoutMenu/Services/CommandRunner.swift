import Foundation
import Darwin

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
    case timedOut(String)

    var errorDescription: String? {
        switch self {
        case .launchFailed(let message), .nonZeroExit(let message), .timedOut(let message):
            return message
        }
    }
}

enum CommandRunner {
    static func run(_ descriptor: CommandDescriptor, timeout: TimeInterval = 60) async throws -> CommandResult {
        try await Task.detached(priority: .utility) {
            let process = Process()
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()
            let stdoutCapture = PipeCapture()
            let stderrCapture = PipeCapture()

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

            stdoutCapture.startReading(from: stdoutPipe.fileHandleForReading)
            stderrCapture.startReading(from: stderrPipe.fileHandleForReading)

            let completed = waitUntilExit(process, timeout: timeout)
            if !completed {
                terminate(process)
            }

            let stdoutData = stdoutCapture.waitForData()
            let stderrData = stderrCapture.waitForData()

            if !completed {
                throw CommandRunnerError.timedOut(
                    "Timed out after \(Int(timeout))s: \(descriptor.displayString)"
                )
            }

            return CommandResult(
                exitCode: process.terminationStatus,
                stdout: String(decoding: stdoutData, as: UTF8.self),
                stderr: String(decoding: stderrData, as: UTF8.self)
            )
        }.value
    }

    static func spawn(
        _ descriptor: CommandDescriptor,
        terminationHandler: (@Sendable (Process) -> Void)? = nil
    ) throws -> Process {
        let process = Process()
        process.executableURL = descriptor.executableURL
        process.arguments = descriptor.arguments
        process.currentDirectoryURL = descriptor.currentDirectoryURL
        process.environment = mergedEnvironment(overrides: descriptor.environment)
        process.standardInput = nil
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = terminationHandler

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

    private static func waitUntilExit(_ process: Process, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning {
            if Date() >= deadline {
                return false
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
        process.waitUntilExit()
        return true
    }

    private static func terminate(_ process: Process) {
        guard process.isRunning else { return }
        process.terminate()

        let deadline = Date().addingTimeInterval(1)
        while process.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }

        if process.isRunning {
            kill(process.processIdentifier, SIGKILL)
        }
        process.waitUntilExit()
    }
}

private final class PipeCapture: @unchecked Sendable {
    private let group = DispatchGroup()
    private let lock = NSLock()
    private var data = Data()

    func startReading(from handle: FileHandle) {
        group.enter()
        DispatchQueue.global(qos: .utility).async { [self] in
            let captured = handle.readDataToEndOfFile()
            self.lock.lock()
            self.data = captured
            self.lock.unlock()
            self.group.leave()
        }
    }

    func waitForData() -> Data {
        group.wait()
        lock.lock()
        defer { lock.unlock() }
        return data
    }
}
