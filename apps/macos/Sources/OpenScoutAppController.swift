import AppKit
import Combine
import Foundation

@MainActor
final class OpenScoutAppController: ObservableObject {
    static let shared = OpenScoutAppController()

    struct BrokerState: Sendable {
        var label: String = "OpenScout Broker"
        var brokerURL: String = "http://127.0.0.1:65535"
        var launchAgentPath: String = ""
        var installed: Bool = false
        var loaded: Bool = false
        var reachable: Bool = false
        var pid: Int? = nil
        var lastExitStatus: Int? = nil
        var statusDetail: String = "Checking broker status..."
    }

    struct PairingViewState: Sendable {
        var status: String = "stopped"
        var statusLabel: String = "Stopped"
        var statusDetail: String = "Checking pairing state..."
        var relay: String? = nil
        var workspaceRoot: String? = nil
        var identityFingerprint: String? = nil
        var trustedPeerCount: Int = 0
        var qrArt: String? = nil
        var qrValue: String? = nil
        var lastUpdatedLabel: String? = nil
        var isRunning: Bool = false
        var controlAvailable: Bool = false
        var controlHint: String? = nil
    }

    @Published private(set) var broker = BrokerState()
    @Published private(set) var pairing = PairingViewState()
    @Published private(set) var webReachable = false
    @Published private(set) var lastError: String? = nil
    @Published private(set) var menuBarSymbolName = "bolt.horizontal.circle"
    @Published private(set) var menuBarTooltip = "OpenScout"
    @Published private(set) var isRefreshing = false
    @Published private(set) var brokerActionPending = false
    @Published private(set) var pairingActionPending = false
    @Published private(set) var webActionPending = false
    @Published private(set) var webServerStartedByApp = false

    private let brokerService = BrokerService()
    private let pairingService = PairingService()
    private let toolchain = OpenScoutToolchain()
    private var refreshTimer: Timer?
    private var webServerProcess: Process?

    private init() {}

    func start() {
        guard refreshTimer == nil else {
            return
        }

        refresh()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refresh()
            }
        }
    }

    func stop() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    func refresh() {
        guard !isRefreshing else {
            return
        }

        Task {
            await refreshNow()
        }
    }

    func installBroker() {
        runBrokerAction(.install)
    }

    func startBroker() {
        runBrokerAction(.start)
    }

    func stopBroker() {
        runBrokerAction(.stop)
    }

    func restartBroker() {
        runBrokerAction(.restart)
    }

    func startPairing() {
        runPairingAction(.start)
    }

    func stopPairing() {
        runPairingAction(.stop)
    }

    func restartPairing() {
        runPairingAction(.restart)
    }

    func openWebApp() {
        Task {
            await openWebAppNow()
        }
    }

    func stopWebApp() {
        webServerProcess?.terminate()
        webServerProcess = nil
        webServerStartedByApp = false
        refresh()
    }

    func openFeedback() {
        if let rawURL = ProcessInfo.processInfo.environment["OPENSCOUT_FEEDBACK_REPORT_URL"],
           let url = URL(string: rawURL) {
            NSWorkspace.shared.open(url)
            return
        }

        openWebApp()
    }

    func openAboutPanel() {
        NSApp.orderFrontStandardAboutPanel([
            NSApplication.AboutPanelOptionKey.applicationName: "OpenScout Menu",
            NSApplication.AboutPanelOptionKey.applicationVersion: "0.1.0",
        ])
        NSApp.activate(ignoringOtherApps: true)
    }

    private func runBrokerAction(_ action: BrokerControlAction) {
        guard !brokerActionPending else {
            return
        }

        brokerActionPending = true
        lastError = nil

        Task {
            defer {
                brokerActionPending = false
            }

            do {
                let status = try await brokerService.control(action)
                broker = BrokerState(from: status)
            } catch {
                lastError = error.localizedDescription
            }

            await refreshNow()
        }
    }

    private func runPairingAction(_ action: PairingControlAction) {
        guard !pairingActionPending else {
            return
        }

        pairingActionPending = true
        lastError = nil

        Task {
            defer {
                pairingActionPending = false
            }

            do {
                pairing = try await pairingService.control(action)
            } catch {
                lastError = error.localizedDescription
            }

            await refreshNow()
        }
    }

    private func refreshNow() async {
        guard !isRefreshing else {
            return
        }

        isRefreshing = true
        defer {
            isRefreshing = false
        }

        if let webServerProcess, !webServerProcess.isRunning {
            self.webServerProcess = nil
            webServerStartedByApp = false
        }

        do {
            let status = try await brokerService.fetchStatus()
            broker = BrokerState(from: status)
        } catch {
            lastError = error.localizedDescription
            broker.statusDetail = error.localizedDescription
        }

        pairing = await pairingService.loadState()
        webReachable = await isWebSurfaceReachable()
        updateMenuBarPresentation()
    }

    private func updateMenuBarPresentation() {
        if pairing.status == "paired" {
            menuBarSymbolName = "checkmark.circle"
        } else if broker.reachable {
            menuBarSymbolName = "dot.radiowaves.left.and.right"
        } else if broker.installed || broker.loaded {
            menuBarSymbolName = "bolt.horizontal.circle"
        } else {
            menuBarSymbolName = "bolt.slash.circle"
        }

        let brokerLine = broker.reachable
            ? "Broker online"
            : (broker.installed ? "Broker installed, not reachable" : "Broker not installed")
        let pairingLine = "Pairing \(pairing.statusLabel.lowercased())"
        menuBarTooltip = "\(brokerLine)\n\(pairingLine)"
    }

    private func openWebAppNow() async {
        guard !webActionPending else {
            return
        }

        webActionPending = true
        defer {
            webActionPending = false
        }

        lastError = nil

        do {
            try await ensureWebServerRunning()
            if let url = URL(string: "http://127.0.0.1:3200") {
                NSWorkspace.shared.open(url)
            }
        } catch {
            lastError = error.localizedDescription
        }

        await refreshNow()
    }

    private func ensureWebServerRunning() async throws {
        if await isWebSurfaceReachable() {
            return
        }

        if let webServerProcess, webServerProcess.isRunning {
            return
        }

        let command = try toolchain.scoutCommand(arguments: ["server", "start"])
        let process = try CommandRunner.spawn(command)
        webServerProcess = process
        webServerStartedByApp = true

        for _ in 0..<16 {
            try? await Task.sleep(for: .milliseconds(250))
            if await isWebSurfaceReachable() {
                return
            }
        }
    }

    private func isWebSurfaceReachable() async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:3200") else {
            return false
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 0.8

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                return false
            }
            return (200..<500).contains(httpResponse.statusCode)
        } catch {
            return false
        }
    }
}

extension OpenScoutAppController.BrokerState {
    init(from status: BrokerServiceStatus) {
        self.label = status.label
        self.brokerURL = status.brokerURL
        self.launchAgentPath = status.launchAgentPath
        self.installed = status.installed
        self.loaded = status.loaded
        self.reachable = status.reachable
        self.pid = status.pid
        self.lastExitStatus = status.lastExitStatus

        if status.reachable {
            self.statusDetail = "Broker is responding at \(status.brokerURL)."
        } else if status.loaded {
            self.statusDetail = "Launch agent is loaded but the broker did not answer."
        } else if status.installed {
            self.statusDetail = "Launch agent is installed but not loaded."
        } else {
            self.statusDetail = "Launch agent is not installed."
        }
    }
}
