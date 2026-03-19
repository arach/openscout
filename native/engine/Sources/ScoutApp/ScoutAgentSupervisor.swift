import AppKit
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

    init(supportPaths: ScoutSupportPaths = .default()) {
        self.supportPaths = supportPaths
    }

    func startIfNeeded() {
        if process?.isRunning == true {
            return
        }

        do {
            try FileManager.default.createDirectory(
                at: supportPaths.applicationSupportDirectory,
                withIntermediateDirectories: true
            )

            let executableURL = try resolvedAgentExecutableURL()
            let process = Process()
            process.executableURL = executableURL
            process.arguments = [
                "--status-file",
                supportPaths.agentStatusFileURL.path(percentEncoded: false),
            ]

            let outputPipe = Pipe()
            process.standardOutput = outputPipe
            process.standardError = outputPipe
            process.terminationHandler = { [weak self] terminatedProcess in
                Task { @MainActor in
                    self?.process = nil
                    self?.processIdentifier = nil
                    self?.state = .stopped
                    self?.detail = "Helper exited with status \(terminatedProcess.terminationStatus)."
                }
            }

            state = .launching
            detail = "Launching helper."
            try process.run()

            self.process = process
            processIdentifier = process.processIdentifier
            startMonitoring()
        } catch {
            state = .failed
            detail = "Failed to launch helper: \(error.localizedDescription)"
        }
    }

    func stop() {
        monitorTask?.cancel()
        monitorTask = nil
        process?.terminate()
        process = nil
        processIdentifier = nil
        state = .stopped
        detail = "Helper stopped."
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
}
