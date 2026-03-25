import AppKit
import Foundation
import Observation
import ScoutCore

@MainActor
@Observable
final class ScoutBrokerSupervisor {
    private(set) var state: ScoutProcessState = .stopped
    private(set) var detail: String = "Broker not started."
    private(set) var lastHealthCheck: Date?
    private(set) var processIdentifier: Int32?
    private(set) var nodeID: String?
    private(set) var meshID: String?
    private(set) var lastLogLine: String?
    private(set) var counts = ScoutControlPlaneCounts.zero
    private(set) var usesManagedProcess = false
    private(set) var localDeviceActorID: String?

    let supportPaths: ScoutSupportPaths
    let client: ScoutControlPlaneClient

    private var process: Process?
    private var monitorTask: Task<Void, Never>?
    private var outputTask: Task<Void, Never>?
    @ObservationIgnored private var startTask: Task<Void, Never>?

    init(
        supportPaths: ScoutSupportPaths = .default(),
        client: ScoutControlPlaneClient? = nil
    ) {
        self.supportPaths = supportPaths
        self.client = client ?? ScoutControlPlaneClient()
    }

    var brokerURL: URL {
        client.baseURL
    }

    func startIfNeeded() {
        ScoutDiagnosticsLogger.log("Broker supervisor start requested.")
        startMonitoring()

        guard startTask == nil else {
            ScoutDiagnosticsLogger.log("Broker supervisor start ignored because start task already exists.")
            return
        }

        startTask = Task { [weak self] in
            guard let self else {
                return
            }

            defer {
                startTask = nil
            }

            if await refreshStatus() {
                ScoutDiagnosticsLogger.log("Broker supervisor found an existing reachable broker at \(brokerURL.absoluteString).")
                return
            }

            ScoutDiagnosticsLogger.log("Broker supervisor did not find a running broker and will launch one.")
            launchBroker()
        }
    }

    func stop() {
        ScoutDiagnosticsLogger.log("Broker supervisor stop requested.")
        startTask?.cancel()
        startTask = nil
        monitorTask?.cancel()
        monitorTask = nil
        outputTask?.cancel()
        outputTask = nil
        process?.terminate()
        process = nil
        processIdentifier = nil
        usesManagedProcess = false
        state = .stopped
        detail = "Broker stopped."
        ScoutDiagnosticsLogger.log("Broker supervisor stop complete.")
    }

    func restart() {
        stop()
        startIfNeeded()
    }

    func refreshNow() async {
        _ = await refreshStatus()
    }

    func openControlPlaneDirectory() {
        NSWorkspace.shared.open(supportPaths.controlPlaneDirectory)
    }

    private func startMonitoring() {
        guard monitorTask == nil else {
            return
        }

        monitorTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                await refreshStatus()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    @discardableResult
    private func refreshStatus() async -> Bool {
        do {
            let health = try await client.fetchHealth()
            let node = try await client.fetchNode()
            lastHealthCheck = .now
            nodeID = node.id
            meshID = node.meshID
            counts = health.counts
            state = health.ok ? .running : .degraded
            if detail == "Broker not started." || state != .degraded {
                detail = usesManagedProcess
                    ? "Broker healthy at \(brokerURL.absoluteString)."
                    : "Broker reachable at \(brokerURL.absoluteString)."
            }
            await ensureLocalDeviceRegistered(for: node.id)
            return true
        } catch {
            counts = .zero
            nodeID = nil
            meshID = nil
            localDeviceActorID = nil
            ScoutDiagnosticsLogger.log("Broker health check failed: \(error.localizedDescription)")

            if process?.isRunning == true {
                state = .launching
                detail = "Waiting for control-plane broker."
            } else if state != .failed {
                state = .stopped
                detail = "Control-plane broker not running."
            }

            return false
        }
    }

    private func ensureLocalDeviceRegistered(for nodeID: String) async {
        let actorID = "device.\(nodeID).scout-app"
        guard localDeviceActorID != actorID else {
            return
        }

        do {
            try await client.upsertDeviceActor(
                id: actorID,
                displayName: "Scout App",
                labels: ["native", "ui"]
            )
            localDeviceActorID = actorID
            ScoutDiagnosticsLogger.log("Registered local device actor \(actorID) with broker.")
        } catch {
            state = .degraded
            detail = "Broker reachable, but app device registration failed."
            ScoutDiagnosticsLogger.log("Failed to register local device actor \(actorID): \(error.localizedDescription)")
        }
    }

    private func launchBroker() {
        guard process?.isRunning != true else {
            ScoutDiagnosticsLogger.log("Broker launch skipped because managed broker is already running.")
            return
        }

        guard let packageURL = ScoutRuntimeLocator.packageURL(relativePath: "packages/runtime") else {
            state = .failed
            detail = "Unable to locate the repo-local runtime package."
            ScoutDiagnosticsLogger.log("Broker launch failed: runtime package path could not be resolved.")
            return
        }

        guard let bunURL = ScoutRuntimeLocator.bunExecutableURL() else {
            state = .failed
            detail = "Unable to locate Bun for the local broker."
            ScoutDiagnosticsLogger.log("Broker launch failed: Bun executable could not be resolved.")
            return
        }

        let process = Process()
        process.executableURL = bunURL
        process.arguments = [
            "run",
            "--cwd",
            packageURL.path(percentEncoded: false),
            "broker",
        ]
        process.environment = mergedEnvironment()

        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = outputPipe
        process.terminationHandler = { [weak self] terminatedProcess in
            Task { @MainActor in
                ScoutDiagnosticsLogger.log("Broker process terminated with status \(terminatedProcess.terminationStatus).")
                self?.process = nil
                self?.processIdentifier = nil
                self?.outputTask?.cancel()
                self?.outputTask = nil

                if terminatedProcess.terminationStatus != 0 {
                    self?.state = .failed
                    self?.detail = "Broker exited with status \(terminatedProcess.terminationStatus)."
                }

                _ = await self?.refreshStatus()
            }
        }

        state = .launching
        detail = "Launching control-plane broker."

        do {
            ScoutDiagnosticsLogger.log("Launching broker with \(bunURL.path(percentEncoded: false)) in \(packageURL.path(percentEncoded: false)).")
            try process.run()
            self.process = process
            self.processIdentifier = process.processIdentifier
            self.usesManagedProcess = true
            ScoutDiagnosticsLogger.log("Broker process started with pid \(process.processIdentifier).")
            self.outputTask = Task { [weak self] in
                await self?.readOutput(from: outputPipe.fileHandleForReading)
            }
        } catch {
            state = .failed
            detail = "Failed to launch broker: \(error.localizedDescription)"
            ScoutDiagnosticsLogger.log("Broker launch threw error: \(error.localizedDescription)")
        }
    }

    private func mergedEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["OPENSCOUT_BROKER_HOST"] = environment["OPENSCOUT_BROKER_HOST"] ?? "127.0.0.1"
        environment["OPENSCOUT_BROKER_PORT"] = environment["OPENSCOUT_BROKER_PORT"] ?? "\(client.baseURL.port ?? ScoutControlPlaneClient.resolvedBrokerPort())"
        environment["OPENSCOUT_BROKER_URL"] = environment["OPENSCOUT_BROKER_URL"] ?? client.baseURL.absoluteString
        environment["OPENSCOUT_CONTROL_HOME"] = environment["OPENSCOUT_CONTROL_HOME"] ?? supportPaths.controlPlaneDirectory.path(percentEncoded: false)
        environment["OPENSCOUT_PARENT_PID"] = environment["OPENSCOUT_PARENT_PID"] ?? "\(ProcessInfo.processInfo.processIdentifier)"
        return environment
    }

    private func readOutput(from handle: FileHandle) async {
        do {
            for try await line in handle.bytes.lines {
                await MainActor.run {
                    lastLogLine = line
                    ScoutDiagnosticsLogger.log("Broker output: \(line)")
                    if line.contains("broker already running on") {
                        usesManagedProcess = false
                        detail = "Using existing broker at \(brokerURL.absoluteString)."
                    } else if line.contains("broker listening on") {
                        usesManagedProcess = true
                        detail = "Broker healthy at \(brokerURL.absoluteString)."
                    }
                }
            }
        } catch {
            await MainActor.run {
                lastLogLine = "Broker output failed: \(error.localizedDescription)"
                ScoutDiagnosticsLogger.log("Broker output read failed: \(error.localizedDescription)")
            }
        }
    }
}
