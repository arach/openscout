import AppKit
import Combine
import Foundation
import ScoutAppCore

@MainActor
final class OpenScoutAppController: ObservableObject {
    static let shared = OpenScoutAppController()

    struct ActionLogEntry: Identifiable, Sendable {
        enum Kind: Sendable { case info, success, error }
        let id = UUID()
        let ts: Date
        let kind: Kind
        let text: String
        let copyDetails: String?
    }

    private enum RefreshReason {
        case startup
        case timer
        case manual
    }

    private struct WebSurfaceHealth: Decodable {
        let ok: Bool
        let surface: String
    }

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

    struct TailscaleViewState: Sendable {
        var status: String = "checking"
        var statusLabel: String = "Checking"
        var statusDetail: String = "Checking Tailscale..."
        var backendState: String? = nil
        var dnsName: String? = nil
        var address: String? = nil
        var peerCount: Int = 0
        var onlinePeerCount: Int = 0
        var health: [String] = []
        var cliPath: String? = nil
        var available: Bool = false
        var running: Bool = false
        var controlAvailable: Bool = false
        var controlHint: String? = nil
    }

    @Published private(set) var broker = BrokerState()
    @Published private(set) var pairing = PairingViewState()
    @Published private(set) var tailscale = TailscaleViewState()
    @Published private(set) var webReachable = false
    @Published private(set) var lastError: String? = nil
    @Published private(set) var menuBarSymbolName = "bolt.horizontal.circle"
    @Published private(set) var menuBarTooltip = "OpenScout"
    @Published private(set) var isRefreshing = false
    @Published private(set) var brokerActionPending = false
    @Published private(set) var pairingActionPending = false
    @Published private(set) var tailscaleActionPending = false
    @Published private(set) var webActionPending = false
    @Published private(set) var webServerStartedByApp = false
    @Published private(set) var actionLog: [ActionLogEntry] = []

    private let brokerService = BrokerService()
    private let pairingService = PairingService()
    private let tailscaleService = TailscaleService()
    private let toolchain = OpenScoutToolchain()
    private var refreshTimer: Timer?
    private var refreshQueued = false
    private var statusSurfaceSources: Set<String> = []
    private var webServerProcess: Process?
    private var actionLogCollapseTask: Task<Void, Never>?
    private static let actionLogMaxEntries = 50
    private static let fastRefreshInterval: TimeInterval = 2.5
    private static let backgroundRefreshInterval: TimeInterval = 30

    private init() {}

    func start() {
        guard refreshTimer == nil else {
            return
        }

        requestRefresh(reason: .startup)
        scheduleRefreshTimer()
    }

    func stop() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    func refresh() {
        requestRefresh(reason: .manual)
    }

    func setStatusSurfaceVisible(_ visible: Bool, source: String) {
        let wasInteractive = !statusSurfaceSources.isEmpty
        if visible {
            statusSurfaceSources.insert(source)
        } else {
            statusSurfaceSources.remove(source)
        }
        guard wasInteractive != !statusSurfaceSources.isEmpty else { return }
        scheduleRefreshTimer()
        if !statusSurfaceSources.isEmpty {
            requestRefresh(reason: .manual)
        }
    }

    private func scheduleRefreshTimer() {
        refreshTimer?.invalidate()
        let interval = statusSurfaceSources.isEmpty
            ? Self.backgroundRefreshInterval
            : Self.fastRefreshInterval
        let timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.requestRefresh(reason: .timer)
            }
        }
        timer.tolerance = min(5, interval * 0.2)
        refreshTimer = timer
    }

    private func requestRefresh(reason: RefreshReason) {
        if isRefreshing {
            if reason == .manual {
                refreshQueued = true
            }
            return
        }

        isRefreshing = true
        Task {
            await runRefreshLoop()
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
        runBrokerAction(.restart, narrate: true)
    }

    func startPairing() {
        runPairingAction(.start)
    }

    func stopPairing() {
        runPairingAction(.stop)
    }

    func restartPairing() {
        runPairingAction(.restart, narrate: true)
    }

    func openTailscale() {
        guard !tailscaleActionPending else {
            return
        }

        tailscaleActionPending = true
        lastError = nil

        Task {
            defer {
                tailscaleActionPending = false
            }

            do {
                tailscale = try await tailscaleService.openApp()
            } catch {
                lastError = error.localizedDescription
            }

            requestRefresh(reason: .manual)
        }
    }

    func openWebApp() {
        openWebPath("/")
    }

    func openComms(cId: String? = nil) {
        Task {
            await openCommsNow(cId: cId)
        }
    }

    func openWebPath(_ path: String) {
        Task {
            await openWebSurfaceNow(path: path)
        }
    }

    func openLogsView() {
        Task {
            await openWebSurfaceNow(path: "/activity")
        }
    }

    func stopWebApp() {
        webServerProcess?.terminate()
        webServerProcess = nil
        webServerStartedByApp = false
        refresh()
    }

    func restartWebApp() {
        guard !webActionPending else { return }
        Task { await runWebRestart() }
    }

    func clearActionLog() {
        actionLogCollapseTask?.cancel()
        actionLogCollapseTask = nil
        actionLog.removeAll()
    }

    private func appendActionLog(_ kind: ActionLogEntry.Kind, _ text: String, copyDetails: String? = nil) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let entry = ActionLogEntry(ts: Date(), kind: kind, text: trimmed, copyDetails: copyDetails)
        actionLog.append(entry)
        if actionLog.count > Self.actionLogMaxEntries {
            actionLog.removeFirst(actionLog.count - Self.actionLogMaxEntries)
        }
    }

    private func resetActionLog() {
        actionLogCollapseTask?.cancel()
        actionLogCollapseTask = nil
        actionLog.removeAll()
    }

    private func scheduleActionLogCollapse(after seconds: Double = 5) {
        actionLogCollapseTask?.cancel()
        actionLogCollapseTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.actionLog.removeAll()
                self?.actionLogCollapseTask = nil
            }
        }
    }

    private func runWebRestart() async {
        resetActionLog()
        appendActionLog(.info, "Stopping web server…")

        if let process = webServerProcess, process.isRunning {
            process.terminate()
        }
        webServerProcess = nil
        webServerStartedByApp = false
        appendActionLog(.success, "Stopped")

        appendActionLog(.info, "Starting web server…")
        webActionPending = true
        defer { webActionPending = false }
        lastError = nil

        let tailTask = Task { [weak self] in
            await self?.tailWebServerLog(forSeconds: 6)
        }

        do {
            try await ensureWebServerRunning()
            appendActionLog(.success, "Reachable at \(webSurfaceDisplayURL)")
            await tailTask.value
            scheduleActionLogCollapse()
        } catch {
            tailTask.cancel()
            let msg = error.localizedDescription
            let logTail = readScoutWebServerLogTail(at: scoutWebServerLogPath(), maxLines: 20)
            let copy = logTail.isEmpty ? msg : "\(msg)\n\n--- web-server.log (last 20 lines) ---\n\(logTail)"
            appendActionLog(.error, msg, copyDetails: copy)
            lastError = msg
        }

        requestRefresh(reason: .manual)
    }

    private func tailWebServerLog(forSeconds seconds: Double) async {
        let path = scoutWebServerLogPath()
        let url = URL(fileURLWithPath: path)
        guard let handle = try? FileHandle(forReadingFrom: url) else { return }
        defer { try? handle.close() }

        do { try handle.seekToEnd() } catch { return }

        let deadline = Date().addingTimeInterval(seconds)
        var pending = ""

        while Date() < deadline {
            try? await Task.sleep(nanoseconds: 200_000_000)
            if Task.isCancelled { return }
            guard let data = try? handle.read(upToCount: 64 * 1024), !data.isEmpty else {
                continue
            }
            guard let chunk = String(data: data, encoding: .utf8) else { continue }
            pending += chunk

            while let nl = pending.firstIndex(of: "\n") {
                let raw = String(pending[..<nl]).trimmingCharacters(in: .whitespacesAndNewlines)
                pending = String(pending[pending.index(after: nl)...])
                guard !raw.isEmpty else { continue }
                let lower = raw.lowercased()
                let kind: ActionLogEntry.Kind = (lower.contains("error") || lower.contains("✗") || lower.contains("fatal"))
                    ? .error
                    : .info
                appendActionLog(kind, raw)
            }
        }
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
            NSApplication.AboutPanelOptionKey.applicationName: "Scout Menu",
            NSApplication.AboutPanelOptionKey.applicationVersion: "0.1.0",
        ])
        NSApp.activate(ignoringOtherApps: true)
    }

    private func runBrokerAction(_ action: BrokerControlAction, narrate: Bool = false) {
        guard !brokerActionPending else {
            return
        }

        brokerActionPending = true
        lastError = nil

        if narrate {
            resetActionLog()
            appendActionLog(.info, "Restarting broker…")
        }

        Task {
            defer {
                brokerActionPending = false
            }

            do {
                let status = try await brokerService.control(action)
                broker = BrokerState(from: status)
                if narrate {
                    appendActionLog(.success, broker.reachable ? "Broker online" : broker.statusDetail)
                    scheduleActionLogCollapse()
                }
            } catch {
                lastError = error.localizedDescription
                if narrate {
                    appendActionLog(.error, error.localizedDescription, copyDetails: error.localizedDescription)
                }
            }

            requestRefresh(reason: .manual)
        }
    }

    private func runPairingAction(_ action: PairingControlAction, narrate: Bool = false) {
        guard !pairingActionPending else {
            return
        }

        pairingActionPending = true
        lastError = nil

        if narrate {
            resetActionLog()
            appendActionLog(.info, "Restarting relay…")
        }

        Task {
            defer {
                pairingActionPending = false
            }

            do {
                pairing = try await pairingService.control(action)
                if narrate {
                    appendActionLog(.success, pairing.statusLabel)
                    scheduleActionLogCollapse()
                }
            } catch {
                lastError = error.localizedDescription
                if narrate {
                    appendActionLog(.error, error.localizedDescription, copyDetails: error.localizedDescription)
                }
            }

            requestRefresh(reason: .manual)
        }
    }

    private func runRefreshLoop() async {
        defer {
            isRefreshing = false
        }

        repeat {
            refreshQueued = false
            await refreshNow()
        } while refreshQueued
    }

    private func refreshNow() async {
        if let webServerProcess, !webServerProcess.isRunning {
            self.webServerProcess = nil
            webServerStartedByApp = false
        }

        do {
            let status = try await brokerService.fetchStatus()
            broker = BrokerState(from: status)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
            broker.statusDetail = error.localizedDescription
        }

        pairing = await pairingService.loadState()
        tailscale = await tailscaleService.loadState()
        webReachable = await isWebSurfaceReachable()
        updateMenuBarPresentation()
    }

    private func updateMenuBarPresentation() {
        if tailscale.available && !tailscale.running {
            menuBarSymbolName = "exclamationmark.triangle"
        } else if pairing.status == "paired" {
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
        let tailscaleLine = tailscale.available
            ? "Tailscale \(tailscale.statusLabel.lowercased())"
            : "Tailscale unavailable"
        menuBarTooltip = "\(brokerLine)\n\(pairingLine)\n\(tailscaleLine)"
    }

    private func openWebSurfaceNow(path: String) async {
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
            let normalizedPath = path.hasPrefix("/") ? path : "/\(path)"
            if let url = URL(string: normalizedPath, relativeTo: webSurfaceBaseURL)?.absoluteURL {
                NSWorkspace.shared.open(url)
            }
        } catch {
            lastError = error.localizedDescription
        }

        requestRefresh(reason: .manual)
    }

    private func openCommsNow(cId: String?) async {
        _ = cId
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
            ScoutAppBridge.openScout()
        } catch {
            lastError = error.localizedDescription
        }

        requestRefresh(reason: .manual)
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

        for _ in 0..<60 {
            try? await Task.sleep(for: .milliseconds(250))
            if await isWebSurfaceReachable() {
                return
            }
        }

        let logPath = scoutWebServerLogPath()
        let tail = readScoutWebServerLogTail(at: logPath, maxLines: 12)
        let detail = tail.isEmpty
            ? "Timed out waiting for the OpenScout web app at \(webSurfaceDisplayURL). Check \(logPath)."
            : "Timed out waiting for the OpenScout web app at \(webSurfaceDisplayURL).\n\nLast lines from \(logPath):\n\(tail)"
        throw NSError(
            domain: "OpenScoutWeb",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: detail]
        )
    }

    private func scoutWebServerLogPath() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".scout/logs/web-server.log").path
    }

    private func readScoutWebServerLogTail(at path: String, maxLines: Int) -> String {
        guard let data = try? String(contentsOfFile: path, encoding: .utf8) else {
            return ""
        }
        let lines = data.split(separator: "\n", omittingEmptySubsequences: false)
        let slice = lines.suffix(maxLines)
        return slice.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func isWebSurfaceReachable() async -> Bool {
        guard let url = URL(string: "/api/health", relativeTo: webSurfaceBaseURL)?.absoluteURL else {
            return false
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 0.8
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                return false
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                return false
            }
            let health = try JSONDecoder().decode(WebSurfaceHealth.self, from: data)
            return health.ok && (health.surface == "openscout-web" || health.surface == "control-plane")
        } catch {
            return false
        }
    }

    private var webSurfaceBaseURL: URL {
        ScoutWeb.baseURL()
    }

    private var webSurfaceDisplayURL: String {
        webSurfaceBaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
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
