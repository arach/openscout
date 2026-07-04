import AppKit
import Combine
import Foundation
import HudsonObservability
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
        var brokerURL: String = "http://127.0.0.1:43110"
        var launchAgentPath: String = ""
        var installed: Bool = false
        var loaded: Bool = false
        var reachable: Bool = false
        var pid: Int? = nil
        var lastExitStatus: Int? = nil
        var restartTelemetry: BrokerRestartTelemetry? = nil
        var statusDetail: String = "Checking broker status..."
        var webURL: String? = nil

        var hasRestartWarning: Bool {
            guard loaded || reachable else { return false }
            return restartTelemetry?.shouldWarn == true
        }

        var restartWarningSummary: String? {
            guard let restartTelemetry, restartTelemetry.shouldWarn else { return nil }
            return restartTelemetry.compactWarning(reachable: reachable)
        }
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

    typealias TailscaleViewState = ScoutAppCore.TailscaleViewState

    struct OpenScoutNetworkViewState: Sendable {
        var discoveryEnabled: Bool = false
        var rendezvousURL: String = OpenScoutNetworkSettings.defaultRendezvousURL
        var pairingRelayURL: String = OpenScoutNetworkSettings.defaultPairingRelayURL
        var keepPairingRelayRunning: Bool = true
        var sessionAvailable: Bool = false
        var settingsPath: String = OpenScoutNetworkSettingsStore.settingsPath()
        var statusLabel: String = "Off"
        var statusDetail: String = "OpenScout Network discovery is off."
    }

    @Published private(set) var broker = BrokerState()
    @Published private(set) var pairing = PairingViewState()
    @Published private(set) var tailscale = TailscaleViewState()
    @Published private(set) var openScoutNetwork = OpenScoutNetworkViewState()
    @Published private(set) var webReachable = false
    @Published private(set) var lastError: String? = nil
    @Published private(set) var menuBarSymbolName = "bolt.horizontal.circle"
    @Published private(set) var menuBarTooltip = "OpenScout"
    @Published private(set) var isRefreshing = false
    @Published private(set) var brokerActionPending = false
    @Published private(set) var pairingActionPending = false
    @Published private(set) var openScoutNetworkActionPending = false
    @Published private(set) var tailscaleActionPending = false
    @Published private(set) var webActionPending = false
    @Published private(set) var webServerStartedByApp = false
    @Published private(set) var actionLog: [ActionLogEntry] = []
    /// Incoming LAN pairing requests awaiting approval on this Mac. Surfaced as a
    /// floating popup (PairingApprovalWindowController) the moment one arrives.
    @Published private(set) var pendingPairingRequests: [ScoutPairingRequest] = []
    @Published private(set) var pairingApprovalPending = false
    private var pairingRequestsTimer: Timer?
    private static let pairingRequestsInterval: TimeInterval = 4

    private let brokerService = BrokerService()
    private let pairingService = PairingService()
    private let tailscaleService = ScoutAppCore.TailscaleService()
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

    var openScoutNetworkSetupActionLabel: String {
        if !openScoutNetwork.sessionAvailable {
            return "Sign in and publish"
        }
        if !openScoutNetwork.discoveryEnabled {
            return "Publish this Mac"
        }
        if !openScoutNetworkRelayReady {
            return "Start OSN relay"
        }
        return "Republish"
    }

    func start() {
        guard refreshTimer == nil else {
            return
        }

        ScoutVoiceHostRunner.shared.start()
        requestRefresh(reason: .startup)
        scheduleRefreshTimer()
        schedulePairingRequestsTimer()
    }

    func stop() {
        ScoutVoiceHostRunner.shared.stop()
        refreshTimer?.invalidate()
        refreshTimer = nil
        pairingRequestsTimer?.invalidate()
        pairingRequestsTimer = nil
    }

    /// A dedicated, always-on (popover-independent) poll for incoming pairing
    /// requests — separate from the broker/tailscale status loop so a request
    /// pops within a few seconds even when the popover is closed.
    private func schedulePairingRequestsTimer() {
        pairingRequestsTimer?.invalidate()
        let timer = Timer.scheduledTimer(withTimeInterval: Self.pairingRequestsInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refreshPairingRequests() }
        }
        timer.tolerance = 1
        pairingRequestsTimer = timer
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

    func approvePairingRequest(_ token: String) {
        decidePairingRequest(token, approve: true)
    }

    func denyPairingRequest(_ token: String) {
        decidePairingRequest(token, approve: false)
    }

    /// Fetch pending requests; keep the last set on a transient error (pending
    /// requests live in the web server's memory, so a brief blip shouldn't drop
    /// an active prompt). The popup window observes `pendingPairingRequests`.
    private func refreshPairingRequests() async {
        guard let requests = try? await ScoutPairingRequests.fetchPending() else { return }
        pendingPairingRequests = requests
    }

    private func decidePairingRequest(_ token: String, approve: Bool) {
        guard !pairingApprovalPending else { return }
        pairingApprovalPending = true
        lastError = nil
        // Drop it immediately so the popup dismisses without waiting on the poll.
        pendingPairingRequests.removeAll { $0.token == token }

        Task {
            defer { pairingApprovalPending = false }
            do {
                try await ScoutPairingRequests.decide(token: token, approve: approve)
            } catch {
                lastError = error.localizedDescription
            }
            requestRefresh(reason: .manual)
        }
    }

    func setOpenScoutNetworkDiscoveryEnabled(_ enabled: Bool) {
        guard !openScoutNetworkActionPending else {
            return
        }

        openScoutNetworkActionPending = true
        lastError = nil

        Task {
            defer {
                openScoutNetworkActionPending = false
            }

            do {
                var settings = OpenScoutNetworkSettingsStore.load()
                settings.discoveryEnabled = enabled
                try OpenScoutNetworkSettingsStore.save(settings)
                refreshOpenScoutNetworkState()
                if enabled {
                    try await ensureOpenScoutNetworkPairingRelay()
                }
            } catch {
                lastError = error.localizedDescription
            }

            requestRefresh(reason: .manual)
        }
    }

    func setOpenScoutNetworkKeepPairingRelayRunning(_ enabled: Bool) {
        guard !openScoutNetworkActionPending else {
            return
        }

        openScoutNetworkActionPending = true
        lastError = nil

        Task {
            defer {
                openScoutNetworkActionPending = false
            }

            do {
                var settings = OpenScoutNetworkSettingsStore.load()
                settings.keepPairingRelayRunning = enabled
                try OpenScoutNetworkSettingsStore.save(settings)
                refreshOpenScoutNetworkState()
                if settings.discoveryEnabled && enabled {
                    try await ensureOpenScoutNetworkPairingRelay()
                }
            } catch {
                lastError = error.localizedDescription
            }

            requestRefresh(reason: .manual)
        }
    }

    func signInOpenScoutNetwork() {
        let settings = OpenScoutNetworkSettingsStore.load()
        guard var components = URLComponents(string: settings.rendezvousURL) else {
            return
        }
        components.path = "/v1/auth/github/start"
        components.queryItems = [
            URLQueryItem(name: "return_to", value: "/v1/auth/native/complete"),
        ]
        guard let url = components.url else {
            return
        }
        NSWorkspace.shared.open(url)
    }

    func setUpOpenScoutNetwork() {
        runOpenScoutNetworkSetup(openSignInIfNeeded: true, reason: "Setting up OpenScout Network...")
    }

    func completeOpenScoutNetworkAuth(from url: URL) throws {
        try OpenScoutNetworkSessionStore.saveSession(from: url)
        runOpenScoutNetworkSetup(openSignInIfNeeded: false, reason: "Completing OpenScout Network setup...")
    }

    func finishOpenScoutNetworkSetupAfterAuth() {
        runOpenScoutNetworkSetup(openSignInIfNeeded: false, reason: "Completing OpenScout Network setup...")
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

        let level: HudLogLevel = switch kind {
        case .info: .notice
        case .success: .info
        case .error: .error
        }
        var metadata: [String: String] = [:]
        if let copyDetails, !copyDetails.isEmpty {
            metadata["details"] = copyDetails
        }
        HudLogStore.shared.record(trimmed, level: level, category: "menu", metadata: metadata)
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
        refreshOpenScoutNetworkState()
        await reconcileOpenScoutNetworkDiscovery()
        webReachable = await isWebSurfaceReachable()
        await refreshPairingRequests()
        updateMenuBarPresentation()
    }

    private func refreshOpenScoutNetworkState() {
        let settings = OpenScoutNetworkSettingsStore.load()
        let sessionAvailable = OpenScoutNetworkSessionStore.loadSessionToken() != nil
        let relayReady = openScoutNetworkRelayReady(settings: settings)
        let statusLabel: String
        let detail: String

        if !settings.discoveryEnabled {
            statusLabel = "Off"
            detail = "OpenScout Network discovery is off."
        } else if !sessionAvailable {
            statusLabel = "Sign in required"
            detail = "Sign in to OpenScout Network before publishing this Mac."
        } else if settings.keepPairingRelayRunning && !relayReady {
            statusLabel = "Starting relay"
            detail = "OpenScout Network discovery is on; starting the pairing relay."
        } else {
            statusLabel = "On"
            detail = "OpenScout Network discovery is on."
        }

        openScoutNetwork = OpenScoutNetworkViewState(
            discoveryEnabled: settings.discoveryEnabled,
            rendezvousURL: settings.rendezvousURL,
            pairingRelayURL: settings.pairingRelayURL,
            keepPairingRelayRunning: settings.keepPairingRelayRunning,
            sessionAvailable: sessionAvailable,
            settingsPath: OpenScoutNetworkSettingsStore.settingsPath(),
            statusLabel: statusLabel,
            statusDetail: detail
        )
    }

    private var openScoutNetworkRelayReady: Bool {
        openScoutNetworkRelayReady(settings: OpenScoutNetworkSettingsStore.load())
    }

    private func openScoutNetworkRelayReady(settings: OpenScoutNetworkSettings) -> Bool {
        pairing.isRunning
            && ((pairing.relay?.hasPrefix(settings.pairingRelayURL) ?? false)
                || pairing.relay == settings.pairingRelayURL)
    }

    private func enableOpenScoutNetworkSettings() throws {
        var settings = OpenScoutNetworkSettingsStore.load()
        settings.discoveryEnabled = true
        settings.keepPairingRelayRunning = true
        try OpenScoutNetworkSettingsStore.save(settings)
        refreshOpenScoutNetworkState()
    }

    private func runOpenScoutNetworkSetup(openSignInIfNeeded: Bool, reason: String) {
        guard !openScoutNetworkActionPending else {
            return
        }

        openScoutNetworkActionPending = true
        lastError = nil
        resetActionLog()
        appendActionLog(.info, reason)

        Task {
            defer {
                openScoutNetworkActionPending = false
            }

            do {
                try enableOpenScoutNetworkSettings()

                guard OpenScoutNetworkSessionStore.loadSessionToken() != nil else {
                    if openSignInIfNeeded {
                        appendActionLog(.info, "Opening OpenScout Network sign-in...")
                        signInOpenScoutNetwork()
                    } else {
                        appendActionLog(.error, "Sign-in did not provide an OpenScout Network session.")
                    }
                    requestRefresh(reason: .manual)
                    return
                }

                appendActionLog(.info, "Restarting broker for OSN publishing...")
                broker = BrokerState(from: try await brokerService.control(.restart))

                appendActionLog(.info, "Starting OSN pairing relay...")
                try await ensureOpenScoutNetworkPairingRelay()

                refreshOpenScoutNetworkState()
                appendActionLog(.success, "OpenScout Network is publishing this Mac.")
                scheduleActionLogCollapse()
            } catch {
                lastError = error.localizedDescription
                appendActionLog(.error, error.localizedDescription, copyDetails: error.localizedDescription)
            }

            requestRefresh(reason: .manual)
        }
    }

    private func reconcileOpenScoutNetworkDiscovery() async {
        let settings = OpenScoutNetworkSettingsStore.load()
        guard settings.discoveryEnabled,
              settings.keepPairingRelayRunning,
              OpenScoutNetworkSessionStore.loadSessionToken() != nil,
              !pairingActionPending,
              !openScoutNetworkActionPending else {
            return
        }

        let relayMatches = pairing.relay == settings.pairingRelayURL
            || (pairing.relay?.hasPrefix(settings.pairingRelayURL) ?? false)
        guard !pairing.isRunning || !relayMatches else {
            return
        }

        do {
            try await ensureOpenScoutNetworkPairingRelay()
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func ensureOpenScoutNetworkPairingRelay() async throws {
        guard !pairingActionPending else {
            return
        }
        pairingActionPending = true
        defer {
            pairingActionPending = false
        }
        pairing = try await pairingService.control(pairing.isRunning ? .restart : .start)
        refreshOpenScoutNetworkState()
    }

    private func updateMenuBarPresentation() {
        if broker.hasRestartWarning {
            menuBarSymbolName = "exclamationmark.triangle"
        } else if tailscale.available && !tailscale.running {
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
        let restartLine = broker.restartWarningSummary
        let pairingLine = "Pairing \(pairing.statusLabel.lowercased())"
        let tailscaleLine = tailscale.available
            ? "Tailscale \(tailscale.statusLabel.lowercased())"
            : "Tailscale unavailable"
        menuBarTooltip = ([brokerLine, restartLine, pairingLine, tailscaleLine].compactMap { $0 }).joined(separator: "\n")
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
            ScoutAppBridge.openScout(channelId: cId)
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
        return await probeWebSurfaceReachable(baseURL: webSurfaceBaseURL)
    }

    private func probeWebSurfaceReachable(baseURL: URL) async -> Bool {
        guard let url = URL(string: "/api/health", relativeTo: baseURL)?.absoluteURL else {
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

    var webSurfacePortLabel: String {
        if let port = webSurfaceBaseURL.port {
            return ":\(port)"
        }
        return "WEB"
    }

    private var webSurfaceBaseURL: URL {
        if let webURL = broker.webURL,
           let url = URL(string: webURL),
           let scheme = url.scheme?.lowercased(),
           (scheme == "http" || scheme == "https"),
           url.host != nil {
            return url
        }
        return ScoutWeb.baseURL()
    }

    private var webSurfaceDisplayURL: String {
        webSurfaceBaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}

extension OpenScoutAppController.BrokerState {
    init(from status: BrokerServiceStatus) {
        self.label = status.label
        self.brokerURL = status.brokerURL
        self.webURL = status.webURL
        self.launchAgentPath = status.launchAgentPath
        self.installed = status.installed
        self.loaded = status.loaded
        self.reachable = status.reachable
        self.pid = status.pid
        self.lastExitStatus = status.lastExitStatus
        self.restartTelemetry = status.restartTelemetry

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
