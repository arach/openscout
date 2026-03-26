import Foundation
import Darwin
import ScoutCore

@main
struct ScoutAgentMain {
    static func main() async throws {
        let statusFileURL = resolvedStatusFileURL()
        let parentPID = resolvedParentPID()
        try FileManager.default.createDirectory(
            at: statusFileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let lock = try acquireSingletonLock(statusFileURL: statusFileURL)
        defer {
            try? FileManager.default.removeItem(at: statusFileURL)
            releaseSingletonLock(lock)
        }

        while !Task.isCancelled {
            if let parentPID {
                if getppid() != parentPID || !isProcessAlive(parentPID) {
                    break
                }
            }

            let status = ScoutAgentStatus(
                state: .running,
                heartbeat: .now,
                pid: ProcessInfo.processInfo.processIdentifier,
                detail: "ScoutAgent heartbeat is healthy."
            )

            try write(status: status, to: statusFileURL)
            try await Task.sleep(for: .seconds(1))
        }
    }

    private static func resolvedStatusFileURL() -> URL {
        let arguments = CommandLine.arguments

        if let index = arguments.firstIndex(of: "--status-file"),
           arguments.indices.contains(index + 1) {
            return URL(filePath: arguments[index + 1])
        }

        return ScoutSupportPaths.default().agentStatusFileURL
    }

    private static func resolvedParentPID() -> Int32? {
        guard let raw = ProcessInfo.processInfo.environment["SCOUT_PARENT_PID"],
              let pid = Int32(raw),
              pid > 0 else {
            return nil
        }

        return pid
    }

    private static func write(status: ScoutAgentStatus, to fileURL: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        let data = try encoder.encode(status)
        try data.write(to: fileURL, options: .atomic)
    }

    private static func acquireSingletonLock(statusFileURL: URL) throws -> Int32 {
        let lockURL = statusFileURL.appendingPathExtension("lock")
        let path = lockURL.path(percentEncoded: false)
        let descriptor = open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH)
        guard descriptor >= 0 else {
            throw POSIXError(.EIO)
        }

        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            let error = errno
            close(descriptor)
            if error == EWOULDBLOCK {
                Foundation.exit(0)
            }
            throw POSIXError(POSIXErrorCode(rawValue: error) ?? .EIO)
        }

        let pidText = "\(ProcessInfo.processInfo.processIdentifier)\n"
        _ = ftruncate(descriptor, 0)
        _ = pidText.withCString { pointer in
            Darwin.write(descriptor, pointer, strlen(pointer))
        }

        return descriptor
    }

    private static func releaseSingletonLock(_ descriptor: Int32) {
        guard descriptor >= 0 else {
            return
        }

        _ = flock(descriptor, LOCK_UN)
        close(descriptor)
    }

    private static func isProcessAlive(_ pid: Int32) -> Bool {
        if kill(pid, 0) == 0 {
            return true
        }

        return errno != ESRCH
    }
}
