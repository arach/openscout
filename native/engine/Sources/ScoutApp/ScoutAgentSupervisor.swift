import AppKit
import Darwin
import Foundation
import Observation
import ScoutCore

@MainActor
@Observable
final class ScoutAgentSupervisor {
    private(set) var state: ScoutProcessState = .stopped
    private(set) var detail: String = "Helper not started."
    private(set) var lastHeartbeat: Date?
    private(set) var processIdentifier: Int32?

    private let supportPaths: ScoutSupportPaths
    private var process: Process?
    private var monitorTask: Task<Void, Never>?
    @ObservationIgnored private var startTask: Task<Void, Never>?

    init(supportPaths: ScoutSupportPaths = .default()) {
        self.supportPaths = supportPaths
    }

    func startIfNeeded() {
        if process?.isRunning == true {
            ScoutDiagnosticsLogger.log("Helper supervisor start ignored because managed helper is already running.")
            return
        }

        guard startTask == nil else {
            ScoutDiagnosticsLogger.log("Helper supervisor start ignored because a launch task is already active.")
            return
        }

        startTask = Task { [weak self] in
            guard let self else {
                return
            }

            defer {
                startTask = nil
            }

            await startHelperLifecycle()
        }
    }

    func stop() {
        startTask?.cancel()
        startTask = nil
        ScoutDiagnosticsLogger.log("Helper supervisor stop requested.")
        monitorTask?.cancel()
        monitorTask = nil
        process?.terminate()
        if process == nil, let processIdentifier, processIdentifier > 0 {
            _ = kill(processIdentifier, SIGTERM)
        }
        process = nil
        processIdentifier = nil
        state = .stopped
        detail = "Helper stopped."
        ScoutDiagnosticsLogger.log("Helper supervisor stop complete.")
    }

    func restart() {
        stop()
        startIfNeeded()
    }

    func openSupportDirectory() {
        NSWorkspace.shared.open(supportPaths.applicationSupportDirectory)
    }

    private func startMonitoring() {
        monitorTask?.cancel()
        monitorTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                await self.refreshStatus()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func refreshStatus() async {
        do {
            let data = try Data(contentsOf: supportPaths.agentStatusFileURL)
            let status = try JSONDecoder().decode(ScoutAgentStatus.self, from: data)
            lastHeartbeat = status.heartbeat
            processIdentifier = status.pid

            if Date.now.timeIntervalSince(status.heartbeat) > 5 {
                state = .degraded
                detail = "Heartbeat is stale."
            } else {
                state = status.state
                detail = status.detail
            }
        } catch {
            if process?.isRunning == true {
                state = .launching
                detail = "Waiting for helper heartbeat."
            } else if state != .failed {
                state = .stopped
                detail = "Helper status file not found yet."
            }
        }
    }

    private func startHelperLifecycle() async {
        do {
            try FileManager.default.createDirectory(
                at: supportPaths.applicationSupportDirectory,
                withIntermediateDirectories: true
            )

            let executableURL = try resolvedAgentExecutableURL()
            ScoutDiagnosticsLogger.log("Helper supervisor resolved executable at \(executableURL.path(percentEncoded: false)).")

            let helperPIDs = try await runningHelperPIDs(executableURL: executableURL)
            if adoptExistingHelperIfRunning(helperPIDs: helperPIDs) {
                return
            }

            let process = Process()
            process.executableURL = executableURL
            process.arguments = [
                "--status-file",
                supportPaths.agentStatusFileURL.path(percentEncoded: false),
            ]
            var environment = ProcessInfo.processInfo.environment
            environment["SCOUT_PARENT_PID"] = "\(ProcessInfo.processInfo.processIdentifier)"
            process.environment = environment

            let outputPipe = Pipe()
            process.standardOutput = outputPipe
            process.standardError = outputPipe
            process.terminationHandler = { [weak self] terminatedProcess in
                Task { @MainActor in
                    ScoutDiagnosticsLogger.log("Helper process terminated with status \(terminatedProcess.terminationStatus).")
                    self?.process = nil
                    self?.processIdentifier = nil
                    self?.state = .stopped
                    self?.detail = "Helper exited with status \(terminatedProcess.terminationStatus)."
                }
            }

            state = .launching
            detail = "Launching helper."
            ScoutDiagnosticsLogger.log("Launching helper process.")
            try process.run()

            self.process = process
            processIdentifier = process.processIdentifier
            ScoutDiagnosticsLogger.log("Helper process started with pid \(process.processIdentifier).")
            startMonitoring()
        } catch {
            state = .failed
            detail = "Failed to launch helper: \(error.localizedDescription)"
            ScoutDiagnosticsLogger.log("Helper launch failed: \(error.localizedDescription)")
        }
    }

    private func resolvedAgentExecutableURL() throws -> URL {
        if let override = ProcessInfo.processInfo.environment["SCOUT_AGENT_EXECUTABLE"],
           !override.isEmpty {
            return URL(filePath: override)
        }

        if let executableURL = Bundle.main.executableURL {
            let siblingURL = executableURL.deletingLastPathComponent().appending(path: "ScoutAgent")
            if FileManager.default.isExecutableFile(atPath: siblingURL.path(percentEncoded: false)) {
                return siblingURL
            }
        }

        throw NSError(
            domain: "OpenScout",
            code: 1,
            userInfo: [
                NSLocalizedDescriptionKey: "Build ScoutAgent first or set SCOUT_AGENT_EXECUTABLE.",
            ]
        )
    }

    private func adoptExistingHelperIfRunning(helperPIDs: [Int32]) -> Bool {
        guard !helperPIDs.isEmpty else {
            return false
        }

        let preferredPID = preferredHelperPID(from: helperPIDs)
        ScoutDiagnosticsLogger.log("Adopting existing helper pid \(preferredPID) and terminating \(max(helperPIDs.count - 1, 0)) duplicates.")
        for pid in helperPIDs where pid != preferredPID {
            _ = kill(pid, SIGTERM)
        }

        process = nil
        processIdentifier = preferredPID
        state = .launching
        detail = "Attached to existing helper."
        startMonitoring()
        return true
    }

    private func preferredHelperPID(from pids: [Int32]) -> Int32 {
        if let status = try? Data(contentsOf: supportPaths.agentStatusFileURL),
           let decoded = try? JSONDecoder().decode(ScoutAgentStatus.self, from: status),
           pids.contains(decoded.pid) {
            return decoded.pid
        }

        return pids.max() ?? pids[0]
    }

    private func runningHelperPIDs(executableURL: URL) async throws -> [Int32] {
        let executablePath = executableURL.path(percentEncoded: false)
        let statusFilePath = supportPaths.agentStatusFileURL.path(percentEncoded: false)

        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let process = Process()
                process.executableURL = URL(filePath: "/bin/ps")
                process.arguments = ["-axo", "pid=,command="]

                let outputPipe = Pipe()
                process.standardOutput = outputPipe
                process.standardError = Pipe()

                do {
                    try process.run()
                    let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
                    process.waitUntilExit()

                    guard process.terminationStatus == 0 else {
                        continuation.resume(returning: [])
                        return
                    }

                    let output = String(decoding: data, as: UTF8.self)
                    let pids = output
                        .split(separator: "\n")
                        .compactMap { line -> Int32? in
                            let trimmed = line.trimmingCharacters(in: .whitespaces)
                            guard trimmed.contains(executablePath),
                                  trimmed.contains("--status-file"),
                                  trimmed.contains(statusFilePath) else {
                                return nil
                            }

                            let parts = trimmed.split(maxSplits: 1, whereSeparator: \.isWhitespace)
                            guard let pidPart = parts.first,
                                  let pid = Int32(pidPart) else {
                                return nil
                            }

                            return pid
                        }
                    continuation.resume(returning: pids)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}
