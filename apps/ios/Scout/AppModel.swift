import SwiftUI
import Network
import HudsonUI
import HudsonVoice
import ScoutCapabilities
import ScoutIOSCore
#if canImport(UIKit)
import UIKit
#endif

/// App-level state for Scout: the fleet of encrypted bridge clients, the
/// focused connection lifecycle, and the shared `ConnectionLog` that records
/// which transport path (LAN / TSN / OSN) was attempted and won. There is no
/// offline data mode — you're either connected to a Mac or you're in the shell
/// with empty surfaces (so Settings stays reachable while unpaired).
@MainActor
@Observable
final class AppModel {
    enum ConnectionState: Equatable {
        case idle
        case connecting
        case connected(TransportKind)
        case failed(String)
    }

    /// Top-level navigation gate. `connect` is the first-run screen (a single
    /// pair CTA + a "continue without pairing" escape hatch); `shell` is the tab
    /// app. We never drop straight into the camera — pairing is always a
    /// deliberate tap.
    enum Phase: Equatable {
        case connect
        case shell
    }

    var phase: Phase = .connect
    var connectionState: ConnectionState = .idle
    var showPairing = false

    private let fleet: FleetConnectionManager
    let connectionLog: ConnectionLog

    /// Shared on-device dictation controller (Parakeet via Vox + Apple fallback),
    /// used by every conversation composer and reflected/controlled in Settings.
    let dictation = HudDictation()

    var lanRoutingEnabled: Bool
    var tailnetRoutingEnabled: Bool
    var openScoutNetworkRoutingEnabled: Bool

    /// Fleet rollup for the bottom status bar (`N agents · Y active`). Polled
    /// while connected; the machine count comes straight from `pairedMachines`.
    var agentCount: Int = 0
    var activeAgentCount: Int = 0

    /// Bumped whenever the trusted-bridge set changes (forgetting a Mac). The
    /// `pairedMachines` list is computed straight off the keychain and reads no
    /// other observed state, so without this nudge a forget wouldn't re-render.
    private var machinesRevision = 0
    private var dataRevision = 0
    private var backgroundFleetConnectTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempt = 0
    private var reconnectMachineId: String?
    private var nextReconnectAt: Date?
    private var scenePhase: ScenePhase = .active
    private let networkMonitor = NWPathMonitor()
    private let networkMonitorQueue = DispatchQueue(label: "Scout.NetworkPath")
    private var networkAvailable = true

    private static let voicePrefKey = "scout.voicePreference"
    private static let reconnectBaseDelayMs = 700
    private static let reconnectMaxDelayMs = 30_000

    init() {
        let log = ConnectionLog()
        connectionLog = log
        fleet = FleetConnectionManager(connectionLog: log)
        lanRoutingEnabled = BridgeRoutePreferences.lanRoutingEnabled()
        tailnetRoutingEnabled = BridgeRoutePreferences.tailnetRoutingEnabled()
        openScoutNetworkRoutingEnabled = BridgeRoutePreferences.openScoutNetworkRoutingEnabled()
        if let raw = UserDefaults.standard.string(forKey: Self.voicePrefKey),
           let pref = HudDictation.Preference(rawValue: raw) {
            dictation.preference = pref
        }
        fleet.onChange = { [weak self] changedMachineId in
            guard let self else { return }
            self.machinesRevision += 1
            if changedMachineId == nil || changedMachineId == self.fleet.focusedMachineId {
                self.syncFocusedConnectionState()
            }
        }
        fleet.onUnexpectedDisconnect = { [weak self] machineId, event in
            self?.handleUnexpectedDisconnect(machineId: machineId, event: event)
        }
        startNetworkMonitor()
    }

    deinit {
        networkMonitor.cancel()
    }

    /// Persist + apply the user's transcription-engine choice.
    func setVoicePreference(_ pref: HudDictation.Preference) {
        dictation.preference = pref
        UserDefaults.standard.set(pref.rawValue, forKey: Self.voicePrefKey)
    }

    func setScenePhase(_ phase: ScenePhase) {
        guard scenePhase != phase else { return }
        scenePhase = phase
        switch phase {
        case .active:
            connectionLog.log("App active; reconnect policy resumed", event: .lifecycle, level: .info)
            if reconnectMachineId != nil || shouldReconnectWhenReady {
                scheduleReconnect(reason: "app active", immediate: true)
            }
        case .background:
            pauseScheduledReconnect(reason: "app backgrounded")
        case .inactive:
            connectionLog.log("App inactive; keeping current connection state", event: .lifecycle, level: .info)
        @unknown default:
            break
        }
    }

    private func startNetworkMonitor() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.handleNetworkPath(path)
            }
        }
        networkMonitor.start(queue: networkMonitorQueue)
    }

    private func handleNetworkPath(_ path: NWPath) {
        let available = path.status == .satisfied
        let changed = available != networkAvailable
        networkAvailable = available
        guard changed else { return }

        if available {
            let interfaces = networkInterfaces(path)
            connectionLog.log(
                interfaces.isEmpty ? "Network path restored" : "Network path restored via \(interfaces)",
                event: .network,
                level: .success
            )
            if shouldReconnectWhenReady {
                scheduleReconnect(reason: "network restored", immediate: true)
            }
        } else {
            pauseScheduledReconnect(reason: "network unavailable")
            connectionLog.log("Network unavailable; reconnect attempts paused", event: .network, level: .warning)
        }
    }

    private func networkInterfaces(_ path: NWPath) -> String {
        var labels: [String] = []
        if path.usesInterfaceType(.wifi) { labels.append("Wi-Fi") }
        if path.usesInterfaceType(.cellular) { labels.append("cellular") }
        if path.usesInterfaceType(.wiredEthernet) { labels.append("Ethernet") }
        if path.usesInterfaceType(.loopback) { labels.append("loopback") }
        if path.usesInterfaceType(.other) { labels.append("other") }
        return labels.joined(separator: ", ")
    }

    private var shouldReconnectWhenReady: Bool {
        guard phase == .shell, scenePhase == .active, networkAvailable, hasTrustedBridge else {
            return false
        }
        guard let machineId = reconnectCandidateMachineId else {
            return false
        }
        if reconnectMachineId != nil || reconnectAttempt > 0 || nextReconnectAt != nil {
            return true
        }
        switch fleet.state(machineId: machineId) {
        case .connected:
            return false
        case .connecting, .failed:
            return true
        case .idle:
            return connectionState != .idle
        }
    }

    private var reconnectCandidateMachineId: String? {
        let machineIds = trustedMachineIds
        guard !machineIds.isEmpty else { return nil }
        if let reconnectMachineId = reconnectMachineId?.lowercased(),
           machineIds.contains(reconnectMachineId) {
            return reconnectMachineId
        }
        return preferredFocusMachineId(in: machineIds)
    }

    private func handleUnexpectedDisconnect(machineId: String, event: BridgeConnectionDisconnectEvent) {
        let key = machineId.lowercased()
        guard hasTrustedMachine(id: key) else {
            connectionLog.log(
                "Dropped untrusted bridge \(shortMachineId(key)); reconnect skipped: \(event.reason)",
                event: .trust,
                level: .warning,
                route: event.route == .none ? nil : event.route
            )
            return
        }

        backgroundFleetConnectTask?.cancel()
        reconnectMachineId = key
        fleet.markReconnecting(machineId: key)
        if key == fleet.focusedMachineId {
            connectionState = .connecting
        }
        machinesRevision += 1

        connectionLog.log(
            "Reconnect policy engaged for \(shortMachineId(key)) via \(routeDiagnostic(event.route)) host=\(event.host ?? "unknown") reason=\(event.reason)",
            event: .reconnect,
            level: .warning,
            route: event.route == .none ? nil : event.route
        )

        if scenePhase != .active {
            pauseScheduledReconnect(reason: "app not active after transport drop")
            return
        }
        guard networkAvailable else {
            pauseScheduledReconnect(reason: "network unavailable after transport drop")
            connectionLog.log(
                "Reconnect waiting for network for \(shortMachineId(key))",
                event: .network,
                level: .warning,
                route: event.route == .none ? nil : event.route
            )
            return
        }
        scheduleReconnect(reason: "unexpected transport drop: \(event.reason)", immediate: false)
    }

    private func scheduleReconnect(reason: String, immediate: Bool) {
        guard hasTrustedBridge else {
            resetReconnectState()
            connectionLog.log("Reconnect skipped: no paired Mac remains", event: .trust, level: .warning)
            return
        }
        guard phase == .shell else {
            connectionLog.log("Reconnect deferred while pairing screen is active: \(reason)", event: .reconnect, level: .info)
            return
        }
        guard let machineId = reconnectCandidateMachineId else {
            resetReconnectState()
            connectionLog.log("Reconnect skipped: no trusted Mac target", event: .trust, level: .warning)
            return
        }

        reconnectMachineId = machineId
        guard scenePhase == .active else {
            pauseScheduledReconnect(reason: "app not active: \(reason)")
            return
        }
        guard networkAvailable else {
            pauseScheduledReconnect(reason: "network unavailable: \(reason)")
            connectionLog.log(
                "Reconnect pending for \(shortMachineId(machineId)); waiting for network",
                event: .network,
                level: .warning
            )
            return
        }

        reconnectTask?.cancel()
        let attempt = reconnectAttempt + 1
        reconnectAttempt = attempt
        let delayMs = immediate ? 0 : reconnectDelayMs(for: attempt)
        nextReconnectAt = Date().addingTimeInterval(Double(delayMs) / 1000)
        fleet.markReconnecting(machineId: machineId)
        if machineId == fleet.focusedMachineId {
            connectionState = .connecting
        }
        machinesRevision += 1

        connectionLog.log(
            "Reconnect attempt \(attempt) scheduled \(delayDescription(delayMs)) for \(shortMachineId(machineId)): \(reason)",
            event: .reconnect,
            level: immediate ? .info : .warning
        )

        reconnectTask = Task { @MainActor [weak self] in
            if delayMs > 0 {
                try? await Task.sleep(for: .milliseconds(delayMs))
            }
            guard !Task.isCancelled else { return }
            await self?.performReconnectAttempt(machineId: machineId, attempt: attempt)
        }
    }

    private func performReconnectAttempt(machineId: String, attempt: Int) async {
        let key = machineId.lowercased()
        guard reconnectMachineId == key else { return }
        guard hasTrustedMachine(id: key) else {
            resetReconnectState()
            connectionLog.log("Reconnect target \(shortMachineId(key)) is no longer trusted", event: .trust, level: .warning)
            syncFocusedConnectionState()
            return
        }
        guard scenePhase == .active else {
            pauseScheduledReconnect(reason: "app not active before attempt \(attempt)")
            return
        }
        guard networkAvailable else {
            pauseScheduledReconnect(reason: "network unavailable before attempt \(attempt)")
            connectionLog.log("Reconnect attempt \(attempt) paused before dialing; network unavailable", event: .network, level: .warning)
            return
        }

        nextReconnectAt = nil
        fleet.markReconnecting(machineId: key)
        if key == fleet.focusedMachineId {
            connectionState = .connecting
        }
        machinesRevision += 1
        connectionLog.log(
            "Reconnect attempt \(attempt) starting for \(shortMachineId(key))",
            event: .reconnect,
            level: .info
        )

        let state = await fleet.connect(machineId: key)
        if key == fleet.focusedMachineId {
            connectionState = state
        }
        machinesRevision += 1

        switch state {
        case .connected(let route):
            resetReconnectState()
            dataRevision += 1
            connectionLog.log(
                "Reconnect attempt \(attempt) succeeded via \(route.label)",
                event: .connected,
                level: .success,
                route: route
            )
            connectRemainingMachines(excluding: key)
        case .failed(let message):
            connectionLog.log(
                "Reconnect attempt \(attempt) failed for \(shortMachineId(key)): \(message)",
                event: .reconnect,
                level: .warning
            )
            scheduleReconnect(reason: "attempt \(attempt) failed: \(message)", immediate: false)
        case .idle:
            connectionLog.log(
                "Reconnect attempt \(attempt) ended idle for \(shortMachineId(key))",
                event: .reconnect,
                level: .warning
            )
            scheduleReconnect(reason: "attempt \(attempt) ended idle", immediate: false)
        case .connecting:
            scheduleReconnect(reason: "attempt \(attempt) still connecting", immediate: false)
        }
    }

    private func pauseScheduledReconnect(reason: String) {
        let hadPendingReconnect = reconnectTask != nil || reconnectMachineId != nil || reconnectAttempt > 0 || nextReconnectAt != nil
        reconnectTask?.cancel()
        reconnectTask = nil
        nextReconnectAt = nil
        if hadPendingReconnect {
            connectionLog.log("Reconnect paused: \(reason)", event: .reconnect, level: .warning)
        }
        machinesRevision += 1
    }

    private func resetReconnectState() {
        reconnectTask?.cancel()
        reconnectTask = nil
        reconnectAttempt = 0
        reconnectMachineId = nil
        nextReconnectAt = nil
    }

    private func reconnectDelayMs(for attempt: Int) -> Int {
        let exponent = min(max(attempt - 1, 0), 5)
        let base = min(Self.reconnectMaxDelayMs, Self.reconnectBaseDelayMs * (1 << exponent))
        let jitter = Int.random(in: 0...max(75, min(750, base / 3)))
        return min(Self.reconnectMaxDelayMs, base + jitter)
    }

    private func delayDescription(_ delayMs: Int) -> String {
        if delayMs == 0 { return "now" }
        if delayMs < 1000 { return "in \(delayMs) ms" }
        return String(format: "in %.1f s", Double(delayMs) / 1000)
    }

    private func shortMachineId(_ machineId: String) -> String {
        String(machineId.prefix(8))
    }

    private func routeDiagnostic(_ route: TransportKind) -> String {
        route.label.isEmpty ? "none" : route.label
    }

    func setLANRoutingEnabled(_ enabled: Bool) {
        guard lanRoutingEnabled != enabled else { return }
        lanRoutingEnabled = enabled
        BridgeRoutePreferences.setLanRoutingEnabled(enabled)
        connectionLog.log(
            "LAN routing \(enabled ? "enabled" : "skipped")",
            event: enabled ? .lifecycle : .routeDisabled,
            route: .lan
        )
        reconnectIfCurrentRouteWasDisabled(.lan, enabled: enabled)
    }

    func setTailnetRoutingEnabled(_ enabled: Bool) {
        guard tailnetRoutingEnabled != enabled else { return }
        tailnetRoutingEnabled = enabled
        BridgeRoutePreferences.setTailnetRoutingEnabled(enabled)
        connectionLog.log(
            "Tailscale routing \(enabled ? "enabled" : "disabled")",
            event: enabled ? .lifecycle : .routeDisabled,
            route: .tailnet
        )
        reconnectIfCurrentRouteWasDisabled(.tailnet, enabled: enabled)
    }

    func setOpenScoutNetworkRoutingEnabled(_ enabled: Bool) {
        guard openScoutNetworkRoutingEnabled != enabled else { return }
        openScoutNetworkRoutingEnabled = enabled
        BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(enabled)
        connectionLog.log(
            "OpenScout Network routing \(enabled ? "enabled" : "disabled")",
            event: enabled ? .lifecycle : .routeDisabled,
            route: .oscout
        )
        reconnectIfCurrentRouteWasDisabled(.oscout, enabled: enabled)
    }

    private func reconnectIfCurrentRouteWasDisabled(_ route: TransportKind, enabled: Bool) {
        guard !enabled, fleet.hasConnectedRoute(route) else { return }
        Task { await reconnect() }
    }

    /// The client every surface consumes.
    var client: any ScoutBrokerClient { fleet.focusedClient }

    /// Refresh the fleet rollup shown in the status bar. A cheap directory read;
    /// callers poll it while the shell is up so `active` stays roughly live.
    func refreshFleetStats() async {
        // Keep the last good rollup on a transient failure — a dropped poll
        // shouldn't blink the status bar to "0 agents". Only a successful fetch
        // (even an empty fleet) updates the counts. Mirrors HomeSurface.load().
        guard let agents = try? await client.listAgents(query: nil, limit: 200) else { return }
        agentCount = agents.count
        activeAgentCount = agents.filter { $0.state == .live }.count
    }

    /// Saved route inventory for the focused pairing. This is route metadata, not
    /// a network probe.
    var savedRouteSummary: BridgeRouteSummary { fleet.focusedClient.savedRouteSummary }

    /// A value that changes when a surface should (re)load its data: the focused
    /// bridge client becomes ready only once connected. Surfaces key their load
    /// `.task(id:)` on this so a list reloads when the focused Mac changes.
    /// Disconnected → 0 → surfaces show their empty states.
    var dataReadyToken: Int {
        if case .connected = connectionState { return dataRevision + 1 }
        return 0
    }

    /// The host the focused live bridge reached the Mac through — the SSH target for the
    /// in-app Terminal when the route is direct (the host IS the Mac). nil on a
    /// relay route (`.remote`), where the bridge host isn't the Mac, so the
    /// Terminal falls back to the broker's advertised `.local` name.
    var terminalSSHHost: String? {
        guard case .connected(let route) = connectionState else { return nil }
        switch route {
        // Only routes where the bridge host is the Mac are safe SSH shortcuts.
        // OSN reaches an OpenScout front door/relay; Terminal must use the
        // broker-provisioned SSH host instead of trying port 22 on that relay.
        case .lan, .tailnet, .loopback: return fleet.focusedClient.currentHost
        case .oscout, .remote, .none: return nil
        }
    }

    /// True once at least one bridge has been paired (keychain-backed).
    var hasTrustedBridge: Bool {
        ((try? ScoutIdentity.getTrustedBridges()) ?? []).isEmpty == false
    }

    /// Resolve the launch phase. A trusted bridge takes us straight into the
    /// shell (connecting in the background); otherwise we land on the Connect
    /// screen. This is the only place that decides the opening surface.
    func start() async {
        #if DEBUG
        // Sim-verification hook (sibling to SCOUT_TAB / SCOUT_OPEN_SETTINGS):
        // enter the shell unpaired so Settings and the empty surfaces are reachable
        // on a fresh simulator that has no trusted bridge. Never affects release.
        if ProcessInfo.processInfo.environment["SCOUT_SKIP_PAIRING"] != nil {
            phase = .shell
            return
        }
        #endif
        if hasTrustedBridge {
            phase = .shell
            await connectIfNeeded()
        } else {
            phase = .connect
        }
    }

    /// Skip pairing for now and enter the shell unconnected. Surfaces show their
    /// empty states (no fabricated data); the point is to reach Settings. The
    /// status chip still routes back to pairing whenever the operator is ready.
    func continueWithoutPairing() {
        phase = .shell
    }

    /// Attempt to connect the focused bridge first, then warm the rest of the
    /// paired fleet in the background. Unpaired is reported (the Connect screen /
    /// status chip own the pairing entry point); this never force-presents the
    /// camera.
    func connectIfNeeded() async {
        resetReconnectState()
        if connectionState == .connecting { return }
        guard hasTrustedBridge else {
            connectionState = .failed("No bridge paired")
            connectionLog.log("No paired bridge — scan the QR on your Mac to pair", event: .trust, level: .warning)
            return
        }
        let machineIds = trustedMachineIds
        fleet.reconcile(trustedMachineIds: machineIds)
        guard let focusId = preferredFocusMachineId(in: machineIds) else {
            connectionState = .failed("No bridge paired")
            return
        }
        fleet.focus(machineId: focusId)
        connectionState = .connecting
        machinesRevision += 1
        connectionLog.log(machineIds.count == 1 ? "Connecting to paired Mac…" : "Connecting to paired Macs…", level: .info)

        let state = await fleet.connect(machineId: focusId)
        connectionState = state
        if case .connected = state { dataRevision += 1 }
        connectRemainingMachines(excluding: focusId)
    }

    func reconnect() async {
        resetReconnectState()
        backgroundFleetConnectTask?.cancel()
        fleet.disconnectAll()
        connectionState = .idle
        machinesRevision += 1
        await connectIfNeeded()
    }

    /// Focus one explicit paired Mac. If its keyed bridge client is already
    /// connected, switching is instant; otherwise we connect that client without
    /// tearing down other live Mac connections.
    func connect(toMachineId hex: String) async {
        resetReconnectState()
        let machineId = hex.lowercased()
        guard hasTrustedMachine(id: machineId) else {
            connectionState = .failed("Mac is no longer paired")
            connectionLog.log("Selected Mac is no longer paired", event: .trust, level: .error)
            machinesRevision += 1
            return
        }

        backgroundFleetConnectTask?.cancel()
        fleet.reconcile(trustedMachineIds: trustedMachineIds)
        fleet.focus(machineId: machineId)
        BridgeBrokerClient.setActiveConnectionPublicKeyHex(machineId)
        machinesRevision += 1
        connectionLog.log("Switching to paired Mac…", event: .lifecycle, level: .info)

        let existingState = fleet.state(machineId: machineId)
        if case .connected = existingState {
            connectionState = existingState
            dataRevision += 1
            connectRemainingMachines(excluding: machineId)
            return
        }

        connectionState = .connecting
        let state = await fleet.connect(machineId: machineId)
        connectionState = state
        if case .connected = state { dataRevision += 1 }
        connectRemainingMachines(excluding: machineId)
    }

    /// Pair from a scanned QR string, then stay connected. Returns true on success.
    @discardableResult
    func pair(scanned: String) async -> Bool {
        await completePair(source: "scanned QR") { try QRPayload.parse(from: scanned) }
    }

    /// Pair from a camera-free pairing link — a pasted payload or a
    /// `scout://pair?…` deep link. Same payload as the QR.
    @discardableResult
    func pairFromLink(_ link: String) async -> Bool {
        await completePair(source: "pairing link") { try QRPayload.parse(fromLink: link) }
    }

    /// Shared pairing tail: build the payload, run the XX handshake, and land in
    /// the shell on success. The `makePayload` closure is the only difference
    /// between the QR and link entry points.
    @discardableResult
    private func completePair(source channel: String, _ makePayload: () throws -> QRPayload) async -> Bool {
        resetReconnectState()
        backgroundFleetConnectTask?.cancel()
        connectionState = .connecting
        connectionLog.log("Pairing from \(channel)…", event: .pairing, level: .info)
        do {
            let pairingBridge = BridgeBrokerClient(connectionLog: ConnectionLogHandle(connectionLog))
            let payload = try makePayload()
            try await pairingBridge.pair(qrPayload: payload, primaryName: deviceName)
            let route = pairingBridge.currentRoute
            let pairedMachineId = fleet.adoptConnectedPairingClient(pairingBridge)
            if let pairedMachineId {
                BridgeBrokerClient.setActiveConnectionPublicKeyHex(pairedMachineId)
                dataRevision += 1
            }
            connectionState = .connected(route)
            connectionLog.log("Paired & connected via \(route.label)", event: .connected, level: .success, route: route)
            phase = .shell
            showPairing = false
            connectRemainingMachines(excluding: pairedMachineId)
            return true
        } catch {
            connectionState = .failed(error.localizedDescription)
            connectionLog.log("Pairing failed: \(error.localizedDescription)", event: .pairing, level: .error)
            return false
        }
    }

    private var deviceName: String {
        #if canImport(UIKit)
        return UIDevice.current.name
        #else
        return "Scout"
        #endif
    }

    // MARK: - Status presentation

    /// Short label for the title-bar status chip.
    var statusLabel: String {
        if !networkAvailable, reconnectMachineId != nil || reconnectAttempt > 0 {
            return "waiting for network"
        }
        if reconnectAttempt > 0 || nextReconnectAt != nil {
            return "reconnecting…"
        }
        switch connectionState {
        case .idle: return "not connected"
        case .connecting: return "connecting…"
        case .connected(let route): return route.label.isEmpty ? "connected" : route.label
        case .failed: return "disconnected"
        }
    }

    var connectionStatusText: String {
        if !networkAvailable, reconnectMachineId != nil || reconnectAttempt > 0 {
            return "Waiting for network; reconnect attempts are paused"
        }
        if reconnectAttempt > 0 {
            if let nextReconnectAt {
                return "Reconnect attempt \(reconnectAttempt) queued for \(nextReconnectAt.formatted(.dateTime.hour().minute().second()))"
            }
            return "Reconnect attempt \(reconnectAttempt) in progress"
        }
        switch connectionState {
        case .idle: return "Not connected"
        case .connecting: return "Connecting…"
        case .connected(let route): return "Connected via \(route.label)"
        case .failed(let message): return message
        }
    }

    var statusShortLabel: String {
        if !networkAvailable, reconnectMachineId != nil || reconnectAttempt > 0 {
            return "Wait"
        }
        if reconnectAttempt > 0 || nextReconnectAt != nil {
            return "Retry"
        }
        switch connectionState {
        case .connected: return "Live"
        case .connecting: return "…"
        case .failed: return "Off"
        case .idle: return "Idle"
        }
    }

    var statusTint: Color {
        if !networkAvailable, reconnectMachineId != nil || reconnectAttempt > 0 {
            return HudPalette.statusWarn
        }
        if reconnectAttempt > 0 || nextReconnectAt != nil {
            return HudPalette.statusWarn
        }
        switch connectionState {
        case .connected: return HudPalette.accent
        case .connecting: return HudPalette.muted
        case .failed: return HudPalette.statusError
        case .idle: return HudPalette.muted
        }
    }

    var statusPulses: Bool {
        if !networkAvailable { return false }
        if reconnectAttempt > 0 || nextReconnectAt != nil { return true }
        if case .connecting = connectionState { return true }
        return false
    }

    // MARK: - Paired machines

    /// One paired base machine for the Home machine-rail. `isActive` means
    /// focused: surfaces route through this Mac's client. `isOnline` / `route`
    /// reflect each pinned client's own live connection state, so Settings can
    /// show several Macs online at the same time before FleetClient coalescing
    /// lands.
    struct PairedMachine: Identifiable, Equatable {
        let id: String          // public-key hex
        let name: String
        let lastSeen: Date?
        let isActive: Bool
        let isOnline: Bool
        let route: TransportKind?
        let connectionState: ConnectionState
    }

    /// Trusted bridges as rail chips, most-recently-seen first. The focused one
    /// is what surfaces are looking at; every row carries its own live state from
    /// the keyed bridge-client fleet.
    var pairedMachines: [PairedMachine] {
        _ = machinesRevision   // participate in observation (see machinesRevision)
        let records = (try? ScoutIdentity.getTrustedBridges()) ?? []
        return records
            .sorted { ($0.lastSeen ?? $0.pairedAt) > ($1.lastSeen ?? $1.pairedAt) }
            .map { record in
                let machineId = record.publicKeyHex.lowercased()
                let isActive = machineId == fleet.focusedMachineId
                let state = fleet.state(machineId: machineId)
                var route: TransportKind?
                if case .connected(let r) = state { route = r }
                // Prefer the Mac's live advertised host for connected machines —
                // the stored record name can be stale (older pairs saved the
                // phone's name). Fall back to the record, then a generic label.
                let rawName = fleet.host(machineId: machineId) ?? record.name
                return PairedMachine(
                    id: machineId,
                    name: rawName.map(Self.prettyMachineName) ?? "Mac",
                    lastSeen: record.lastSeen,
                    isActive: isActive,
                    isOnline: route != nil,
                    route: route,
                    connectionState: state
                )
            }
    }

    /// Forget a paired Mac: drop its trusted-bridge record from the keychain and
    /// tear down that keyed client. No-op if the id doesn't match.
    func forgetMachine(id hex: String) {
        guard let record = ((try? ScoutIdentity.getTrustedBridges()) ?? [])
            .first(where: { $0.publicKeyHex.lowercased() == hex.lowercased() }) else { return }
        if reconnectMachineId == hex.lowercased() {
            resetReconnectState()
        }
        backgroundFleetConnectTask?.cancel()
        try? ScoutIdentity.removeTrustedBridge(publicKey: record.publicKey)
        fleet.forget(machineId: hex)
        BridgeBrokerClient.removeSavedConnectionInfo(publicKeyHex: hex.lowercased())
        if let replacement = preferredFocusMachineId(in: trustedMachineIds) {
            fleet.focus(machineId: replacement)
        }
        syncFocusedConnectionState()
        machinesRevision += 1
    }

    /// Turn a relay host / stored hostname into a friendly machine label by
    /// keeping just the machine's own hostname label — the first dotted
    /// component — and humanizing the separators:
    ///   "Arachs-Mac-mini.local"                 → "Arachs Mac mini"
    ///   "arachs-mac-mini.tail1e8e67.ts.net"     → "arachs mac mini"
    /// This drops every network suffix (.local, the Tailscale MagicDNS tail, the
    /// OpenScout front door) in one move, so a long Tailnet host can never bleed
    /// into the chrome. An IP address has no friendly label to extract — it's
    /// shown verbatim. A plain name (no dots) passes straight through.
    static func prettyMachineName(_ raw: String) -> String {
        let isIP = raw.contains(".") && raw.split(separator: ".").allSatisfy { UInt($0) != nil }
        let label = isIP ? raw : (raw.split(separator: ".").first.map(String.init) ?? raw)
        return label.replacingOccurrences(of: "-", with: " ")
    }

    private func hasTrustedMachine(id hex: String) -> Bool {
        ((try? ScoutIdentity.getTrustedBridges()) ?? [])
            .contains { $0.publicKeyHex.lowercased() == hex.lowercased() }
    }

    private var trustedMachineIds: [String] {
        ((try? ScoutIdentity.getTrustedBridges()) ?? [])
            .sorted { ($0.lastSeen ?? $0.pairedAt) > ($1.lastSeen ?? $1.pairedAt) }
            .map { $0.publicKeyHex.lowercased() }
    }

    private func preferredFocusMachineId(in machineIds: [String]) -> String? {
        if let focused = fleet.focusedMachineId, machineIds.contains(focused) {
            return focused
        }
        if let active = BridgeBrokerClient.activeConnectionPublicKeyHex(),
           machineIds.contains(active) {
            return active
        }
        return machineIds.first
    }

    private func syncFocusedConnectionState() {
        let state = fleet.focusedState
        connectionState = state
        if case .connected = state {
            dataRevision += 1
        }
    }

    private func connectRemainingMachines(excluding focusedMachineId: String?) {
        let remaining = trustedMachineIds.filter { $0 != focusedMachineId }
        guard !remaining.isEmpty else { return }
        backgroundFleetConnectTask?.cancel()
        backgroundFleetConnectTask = Task { @MainActor in
            for machineId in remaining {
                guard !Task.isCancelled else { return }
                let state = await self.fleet.connect(machineId: machineId)
                if case .connected = state,
                   case .connected = self.connectionState {
                    continue
                } else if case .connected = state {
                    self.fleet.focus(machineId: machineId)
                    BridgeBrokerClient.setActiveConnectionPublicKeyHex(machineId)
                    self.syncFocusedConnectionState()
                }
            }
        }
    }
}

// MARK: - FleetConnectionManager

/// Owns the live bridge-client fleet for PR-1. It deliberately stops short of a
/// coalescing `FleetClient`: surfaces still receive exactly one
/// `ScoutBrokerClient`, while Settings can observe all keyed connections.
@MainActor
private final class FleetConnectionManager: @unchecked Sendable {
    var onChange: ((String?) -> Void)?
    var onUnexpectedDisconnect: ((String, BridgeConnectionDisconnectEvent) -> Void)?

    private let connectionLog: ConnectionLog
    private let fallbackClient: BridgeBrokerClient
    private var clients: [String: BridgeBrokerClient] = [:]
    private var states: [String: AppModel.ConnectionState] = [:]

    private(set) var focusedMachineId: String?

    init(connectionLog: ConnectionLog) {
        self.connectionLog = connectionLog
        self.fallbackClient = Self.makeClient(connectionLog: connectionLog, preferredPublicKeyHex: nil)
    }

    var focusedClient: BridgeBrokerClient {
        guard let focusedMachineId else { return fallbackClient }
        return client(for: focusedMachineId)
    }

    var focusedState: AppModel.ConnectionState {
        guard let focusedMachineId else { return .idle }
        return state(machineId: focusedMachineId)
    }

    func reconcile(trustedMachineIds: [String]) {
        let trusted = Set(trustedMachineIds.map { $0.lowercased() })
        let stale = clients.keys.filter { !trusted.contains($0) }
        for machineId in stale {
            clients[machineId]?.disconnect()
            clients.removeValue(forKey: machineId)
            states.removeValue(forKey: machineId)
        }
        if let focusedMachineId, !trusted.contains(focusedMachineId) {
            self.focusedMachineId = nil
        }
        onChange?(nil)
    }

    func focus(machineId: String) {
        let key = machineId.lowercased()
        focusedMachineId = key
        _ = client(for: key)
        if states[key] == nil { states[key] = .idle }
        onChange?(key)
    }

    @discardableResult
    func adoptConnectedPairingClient(_ client: BridgeBrokerClient) -> String? {
        guard let machineId = client.currentPublicKeyHex?.lowercased() else { return nil }
        installDisconnectHandler(on: client, machineId: machineId)
        clients[machineId] = client
        states[machineId] = .connected(client.currentRoute)
        focusedMachineId = machineId
        onChange?(machineId)
        return machineId
    }

    func state(machineId: String) -> AppModel.ConnectionState {
        states[machineId.lowercased()] ?? .idle
    }

    func host(machineId: String) -> String? {
        clients[machineId.lowercased()]?.currentHost
    }

    func hasConnectedRoute(_ route: TransportKind) -> Bool {
        states.values.contains { state in
            if case .connected(let connectedRoute) = state {
                return connectedRoute == route
            }
            return false
        }
    }

    func markReconnecting(machineId: String) {
        let key = machineId.lowercased()
        states[key] = .connecting
        onChange?(key)
    }

    @discardableResult
    func connect(machineId: String) async -> AppModel.ConnectionState {
        let key = machineId.lowercased()
        let client = client(for: key)
        if client.isConnected {
            let state: AppModel.ConnectionState = .connected(client.currentRoute)
            states[key] = state
            onChange?(key)
            return state
        }

        states[key] = .connecting
        onChange?(key)
        do {
            try await client.connect()
            let state: AppModel.ConnectionState = .connected(client.currentRoute)
            states[key] = state
            onChange?(key)
            return state
        } catch {
            let state: AppModel.ConnectionState = .failed(error.localizedDescription)
            states[key] = state
            onChange?(key)
            return state
        }
    }

    func disconnectAll() {
        for (machineId, client) in clients {
            client.disconnect()
            states[machineId] = .idle
        }
        fallbackClient.disconnect()
        onChange?(nil)
    }

    func forget(machineId: String) {
        let key = machineId.lowercased()
        clients[key]?.disconnect()
        clients.removeValue(forKey: key)
        states.removeValue(forKey: key)
        if focusedMachineId == key {
            focusedMachineId = nil
        }
        onChange?(key)
    }

    private func client(for machineId: String) -> BridgeBrokerClient {
        let key = machineId.lowercased()
        if let existing = clients[key],
           existing.isConnected || existing.targetPublicKeyHex == key {
            installDisconnectHandler(on: existing, machineId: key)
            return existing
        }
        let client = Self.makeClient(connectionLog: connectionLog, preferredPublicKeyHex: key)
        installDisconnectHandler(on: client, machineId: key)
        clients[key] = client
        return client
    }

    private func installDisconnectHandler(on client: BridgeBrokerClient, machineId: String) {
        let key = machineId.lowercased()
        client.setUnexpectedDisconnectHandler { [weak self] event in
            self?.handleUnexpectedDisconnect(machineId: key, event: event)
        }
    }

    private func handleUnexpectedDisconnect(machineId: String, event: BridgeConnectionDisconnectEvent) {
        let key = machineId.lowercased()
        states[key] = .connecting
        onChange?(key)
        onUnexpectedDisconnect?(key, event)
    }

    private static func makeClient(
        connectionLog: ConnectionLog,
        preferredPublicKeyHex: String?
    ) -> BridgeBrokerClient {
        BridgeBrokerClient(
            connectionLog: ConnectionLogHandle(connectionLog),
            preferredPublicKeyHex: preferredPublicKeyHex
        )
    }
}
