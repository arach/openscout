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
    private(set) var serviceInstalled = false
    private(set) var serviceLoaded = false
    private(set) var serviceLabel: String?
    private(set) var serviceMode: String?
    private(set) var launchAgentPath: String?
    private(set) var stdoutLogPath: String?
    private(set) var stderrLogPath: String?

    let supportPaths: ScoutSupportPaths
    let client: ScoutControlPlaneClient

    private var monitorTask: Task<Void, Never>?
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

            if await refreshStatus(), state == .running {
                ScoutDiagnosticsLogger.log("Broker supervisor found a healthy broker at \(brokerURL.absoluteString).")
                return
            }

            do {
                ScoutDiagnosticsLogger.log("Broker supervisor will start the broker LaunchAgent.")
                let service = try await ScoutBrokerServiceController.start()
                applyServiceStatus(service)
                _ = await refreshStatus()
            } catch {
                state = .failed
                detail = "Failed to start broker service: \(error.localizedDescription)"
                ScoutDiagnosticsLogger.log("Broker service start failed: \(error.localizedDescription)")
            }
        }
    }

    func stop() {
        ScoutDiagnosticsLogger.log("Broker supervisor stop requested.")
        startTask?.cancel()
        startTask = nil

        Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            do {
                let service = try await ScoutBrokerServiceController.stop()
                applyServiceStatus(service)
                counts = .zero
                nodeID = nil
                meshID = nil
                localDeviceActorID = nil
                lastHealthCheck = .now
                state = .stopped
                detail = "Broker service stopped."
                ScoutDiagnosticsLogger.log("Broker service stopped.")
            } catch {
                state = .failed
                detail = "Failed to stop broker service: \(error.localizedDescription)"
                ScoutDiagnosticsLogger.log("Broker service stop failed: \(error.localizedDescription)")
            }
        }
    }

    func restart() {
        ScoutDiagnosticsLogger.log("Broker supervisor restart requested.")
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            do {
                let service = try await ScoutBrokerServiceController.restart()
                applyServiceStatus(service)
                _ = await refreshStatus()
                ScoutDiagnosticsLogger.log("Broker service restart complete.")
            } catch {
                state = .failed
                detail = "Failed to restart broker service: \(error.localizedDescription)"
                ScoutDiagnosticsLogger.log("Broker service restart failed: \(error.localizedDescription)")
            }
        }
    }

    func install() {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            do {
                let service = try await ScoutBrokerServiceController.install()
                applyServiceStatus(service)
                detail = "Broker LaunchAgent installed."
                ScoutDiagnosticsLogger.log("Broker LaunchAgent installed at \(service.launchAgentPath).")
            } catch {
                state = .failed
                detail = "Failed to install broker service: \(error.localizedDescription)"
                ScoutDiagnosticsLogger.log("Broker service install failed: \(error.localizedDescription)")
            }
        }
    }

    func uninstall() {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            do {
                let service = try await ScoutBrokerServiceController.uninstall()
                applyServiceStatus(service)
                counts = .zero
                nodeID = nil
                meshID = nil
                localDeviceActorID = nil
                state = .stopped
                detail = "Broker LaunchAgent removed."
                ScoutDiagnosticsLogger.log("Broker LaunchAgent removed.")
            } catch {
                state = .failed
                detail = "Failed to uninstall broker service: \(error.localizedDescription)"
                ScoutDiagnosticsLogger.log("Broker service uninstall failed: \(error.localizedDescription)")
            }
        }
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
            let service = try await ScoutBrokerServiceController.status()
            applyServiceStatus(service)

            if service.health.reachable {
                let health = try await client.fetchHealth()
                let node = try await client.fetchNode()
                lastHealthCheck = .now
                nodeID = node.id
                meshID = node.meshID
                counts = health.counts
                state = health.ok ? .running : .degraded
                detail = service.loaded
                    ? "Broker healthy at \(brokerURL.absoluteString)."
                    : "Broker reachable at \(brokerURL.absoluteString)."
                await ensureLocalDeviceRegistered(for: node.id)
                return true
            }

            counts = .zero
            nodeID = nil
            meshID = nil
            localDeviceActorID = nil
            lastHealthCheck = .now

            if service.loaded {
                state = .launching
                detail = "Waiting for broker service to become healthy."
            } else if service.installed {
                state = .stopped
                detail = "Broker LaunchAgent installed but not running."
            } else {
                state = .stopped
                detail = "Broker LaunchAgent not installed."
            }
            return false
        } catch {
            counts = .zero
            nodeID = nil
            meshID = nil
            localDeviceActorID = nil
            state = .failed
            detail = "Broker service status failed: \(error.localizedDescription)"
            ScoutDiagnosticsLogger.log("Broker status refresh failed: \(error.localizedDescription)")
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

    private func applyServiceStatus(_ service: ScoutBrokerServiceStatus) {
        serviceInstalled = service.installed
        serviceLoaded = service.loaded
        serviceLabel = service.label
        serviceMode = service.mode
        launchAgentPath = service.launchAgentPath
        stdoutLogPath = service.stdoutLogPath
        stderrLogPath = service.stderrLogPath
        processIdentifier = service.pid
        usesManagedProcess = service.loaded
        lastLogLine = service.lastLogLine
    }
}
