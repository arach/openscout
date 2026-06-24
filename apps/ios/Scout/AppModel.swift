import Foundation
import SwiftUI
import Network
import HudsonUI
import HudsonVoice
import ScoutCapabilities
import ScoutIOSCore
import AuthenticationServices
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

    /// Which machine(s) the fleet surfaces (Home, Agents) show. `.all` aggregates
    /// across every connected Mac; `.machine` narrows to one. Independent of the
    /// *bound* Mac in the status bar (`focusedMachineId`): picking a specific Mac
    /// focuses it, picking All leaves the binding alone. Defaults to All so a
    /// multi-Mac fleet shows everything without hunting for what to toggle.
    enum MachineFilter: Equatable {
        case all
        case machine(String)   // lowercased public-key hex
    }

    var phase: Phase = .connect
    var connectionState: ConnectionState = .idle
    var showPairing = false
    var machineFilter: MachineFilter = .all

    private let fleet: FleetConnectionManager
    let connectionLog: ConnectionLog

    /// Shared on-device dictation controller (Parakeet via Vox + Apple fallback),
    /// used by every conversation composer and reflected/controlled in Settings.
    let dictation = HudDictation()

    var lanRoutingEnabled: Bool
    var tailnetRoutingEnabled: Bool
    var openScoutNetworkRoutingEnabled: Bool

    struct TailnetPairTarget: Identifiable, Equatable {
        let id: String
        let name: String
        let dnsName: String
        let hostName: String?
        let addresses: [String]
        let isOnline: Bool
        let os: String?
        let pairLinks: [String]

        var displayName: String {
            if let hostName = AppModel.cleanTailnetHost(hostName) { return AppModel.prettyMachineName(hostName) }
            return AppModel.prettyMachineName(dnsName)
        }

        var detail: String {
            var parts: [String] = [isOnline ? "online" : "offline"]
            if let os, !os.isEmpty { parts.append(os) }
            if let address = addresses.first, !address.isEmpty { parts.append(address) }
            return parts.joined(separator: " · ")
        }
    }

    struct TailnetPairLogEntry: Identifiable, Equatable {
        let id: Int
        let tsMs: Int64
        let level: ConnectionLogLevel
        let message: String
    }

    var tailnetPairTargets: [TailnetPairTarget] = []
    var isRefreshingTailnetPairTargets = false
    var tailnetPairError: String?
    var tailnetPairDiscoveryOrigin: String?
    var tailnetPairingTargetId: String?
    var tailnetPairLogs: [TailnetPairLogEntry] = []

    /// A Scout Mac found on the local network (Bonjour `_oscout-pair._tcp`). The
    /// nicest first-run path: same Wi-Fi, one tap, no QR. Carries the Mac's
    /// stable identity + relay host; the live pairing payload (room) is fetched
    /// from its `/pair` endpoint at pair time.
    struct LanPairTarget: Identifiable, Equatable {
        let id: String            // public key hex — stable per Mac
        let publicKeyHex: String
        let fingerprint: String
        let hostName: String      // resolved, e.g. "arts-mac-mini.local"
        let relayPort: Int
        let webPort: Int?

        var displayName: String { AppModel.prettyMachineName(hostName) }
        var detail: String { "on your network · \(hostName)" }
    }

    var lanPairTargets: [LanPairTarget] = []
    var isRefreshingLanPairTargets = false
    var lanPairError: String?
    var lanPairingTargetId: String?
    /// True while a LAN pairing is parked waiting for the Mac to approve the
    /// request (trust-on-first-use means a human has to allow the device).
    var lanPairAwaitingApproval = false

    struct OpenScoutNetworkPairTarget: Identifiable, Equatable {
        let candidate: OpenScoutNetworkPairingCandidate

        var id: String { candidate.id }
        var displayName: String { AppModel.prettyMachineName(candidate.nodeName) }
        var detail: String {
            let host = URLComponents(string: candidate.entrypoint.relay)?.host ?? "mesh.oscout.net"
            return "OSN · \(host)"
        }
    }

    var openScoutNetworkPairTargets: [OpenScoutNetworkPairTarget] = []
    var isRefreshingOpenScoutNetworkPairTargets = false
    var openScoutNetworkPairError: String?
    var openScoutNetworkPairingTargetId: String?

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
    private var tailnetPairLogCounter = 0
    private var nextReconnectAt: Date?
    private var scenePhase: ScenePhase = .active
    private let networkMonitor = NWPathMonitor()
    private let networkMonitorQueue = DispatchQueue(label: "Scout.NetworkPath")
    private var networkAvailable = true

    private static let voicePrefKey = "scout.voicePreference"
    private static let reconnectBaseDelayMs = 700
    private static let reconnectMaxDelayMs = 30_000
    // Fixed web contracts. The default port mirrors
    // packages/runtime/src/local-config.ts DEFAULT_LOCAL_CONFIG.ports.web.
    private static let scoutWebMeshPath = "/api/mesh"
    private static let scoutWebPairPath = "/pair"
    private static let defaultScoutWebPort = 43120
    private static let openScoutNetworkFrontDoorBaseURL = defaultOpenScoutNetworkFrontDoorBaseURL
    private static let openScoutNetworkAuthStartPath = "/v1/auth/github/start"
    private static let openScoutNetworkAppleNativePath = "/v1/auth/apple/native"
    private static let openScoutNetworkNativeReturnToPath = "/v1/auth/native/complete"
    private static let openScoutNetworkNodesPath = "/v1/nodes"
    private static let openScoutNetworkMeshId = "openscout"
    private static let openScoutNetworkAuthExpiresAtKey = "scout.osn.sessionExpiresAtMs"

    var openScoutNetworkAuthExpiresAt: Date?
    private var openScoutNetworkSessionToken: String?
    private var pendingAppleSignInNonce: String?
    var isCompletingAppleSignIn = false

    init() {
        let log = ConnectionLog()
        connectionLog = log
        fleet = FleetConnectionManager(connectionLog: log)
        lanRoutingEnabled = BridgeRoutePreferences.lanRoutingEnabled()
        tailnetRoutingEnabled = BridgeRoutePreferences.tailnetRoutingEnabled()
        openScoutNetworkRoutingEnabled = BridgeRoutePreferences.openScoutNetworkRoutingEnabled()
        loadOpenScoutNetworkSession()
        enableOpenScoutNetworkRoutingForSavedOSNRouteIfUnset()
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

    private func enableOpenScoutNetworkRoutingForSavedOSNRouteIfUnset() {
        guard !BridgeRoutePreferences.hasExplicitOpenScoutNetworkRoutingPreference(),
              savedRouteSummary.hasOpenScoutNetworkRelay
        else {
            return
        }
        openScoutNetworkRoutingEnabled = true
        BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(true)
        connectionLog.log(
            "Enabled OpenScout Network routing for saved OSN bridge route",
            event: .lifecycle,
            level: .info,
            route: .oscout
        )
    }

    var openScoutNetworkAuthStatus: String {
        guard let expiresAt = openScoutNetworkAuthExpiresAt,
              openScoutNetworkSessionToken?.isEmpty == false
        else {
            return "Signed out"
        }
        return expiresAt > Date() ? "Signed in" : "Expired"
    }

    var openScoutNetworkAuthHint: String {
        guard let expiresAt = openScoutNetworkAuthExpiresAt,
              openScoutNetworkSessionToken?.isEmpty == false
        else {
            return "GitHub login required"
        }
        if expiresAt <= Date() {
            return "login again"
        }
        return "expires \(expiresAt.formatted(.relative(presentation: .named)))"
    }

    var openScoutNetworkAuthActionLabel: String {
        openScoutNetworkAuthStatus == "Signed in" ? "Refresh" : "Login"
    }

    var isOpenScoutNetworkSignedIn: Bool {
        guard let expiresAt = openScoutNetworkAuthExpiresAt,
              openScoutNetworkSessionToken?.isEmpty == false
        else {
            return false
        }
        return expiresAt > Date()
    }

    func openOpenScoutNetworkLogin() {
        guard let url = Self.openScoutNetworkAuthStartURL() else {
            connectionLog.log("OpenScout Network login URL is invalid", event: .auth, level: .error, route: .oscout)
            return
        }
        connectionLog.log("Opening OpenScout Network login…", event: .auth, route: .oscout)
        #if canImport(UIKit)
        UIApplication.shared.open(url)
        #endif
    }

    func signOutOpenScoutNetwork() {
        try? ScoutIdentity.deleteOSNSessionToken()
        UserDefaults.standard.removeObject(forKey: Self.openScoutNetworkAuthExpiresAtKey)
        openScoutNetworkSessionToken = nil
        openScoutNetworkAuthExpiresAt = nil
        openScoutNetworkPairTargets = []
        connectionLog.log("OpenScout Network session cleared", event: .auth, route: .oscout)
    }

    // MARK: - Sign in with Apple

    private struct AppleNativeAuthResponse: Decodable {
        let session: String
        let expiresAt: Double

        enum CodingKeys: String, CodingKey {
            case session
            case expiresAt = "expires_at"
        }
    }

    /// Configure the native Apple authorization request. The view calls this
    /// from `SignInWithAppleButton(onRequest:)`. We stash the nonce so the
    /// server can confirm the token was minted for this exact request.
    func prepareAppleSignInRequest(_ request: ASAuthorizationAppleIDRequest) {
        let nonce = Self.randomNonce()
        pendingAppleSignInNonce = nonce
        request.requestedScopes = [.fullName, .email]
        request.nonce = nonce
    }

    /// Handle the result from `SignInWithAppleButton(onCompletion:)`.
    func handleAppleSignInCompletion(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case let .success(authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let identityToken = String(data: tokenData, encoding: .utf8)
            else {
                connectionLog.log("Apple sign-in returned no identity token", event: .auth, level: .error, route: .oscout)
                return
            }
            let nonce = pendingAppleSignInNonce
            pendingAppleSignInNonce = nil
            let fullName = Self.formatPersonName(credential.fullName)
            Task { await submitAppleIdentityToken(identityToken, nonce: nonce, fullName: fullName) }
        case let .failure(error):
            pendingAppleSignInNonce = nil
            if let authError = error as? ASAuthorizationError, authError.code == .canceled {
                connectionLog.log("Apple sign-in canceled", event: .auth, route: .oscout)
            } else {
                connectionLog.log("Apple sign-in failed: \(error.localizedDescription)", event: .auth, level: .error, route: .oscout)
            }
        }
    }

    private func submitAppleIdentityToken(_ identityToken: String, nonce: String?, fullName: String?) async {
        guard let url = Self.openScoutNetworkURL(path: Self.openScoutNetworkAppleNativePath) else {
            connectionLog.log("Apple sign-in URL is invalid", event: .auth, level: .error, route: .oscout)
            return
        }
        isCompletingAppleSignIn = true
        defer { isCompletingAppleSignIn = false }
        connectionLog.log("Submitting Apple identity to OpenScout Network…", event: .auth, route: .oscout)

        var body: [String: String] = ["identityToken": identityToken]
        if let nonce { body["nonce"] = nonce }
        if let fullName, !fullName.isEmpty { body["fullName"] = fullName }

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 12)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                connectionLog.log("Apple sign-in: invalid response", event: .auth, level: .error, route: .oscout)
                return
            }
            guard http.statusCode == 200 else {
                let detail = String(data: data, encoding: .utf8)?.prefix(160) ?? ""
                connectionLog.log("Apple sign-in rejected (HTTP \(http.statusCode)): \(detail)", event: .auth, level: .error, route: .oscout)
                return
            }
            let decoded = try JSONDecoder().decode(AppleNativeAuthResponse.self, from: data)
            applyOpenScoutNetworkSession(token: decoded.session, expiresAtMs: decoded.expiresAt, source: "apple")
        } catch {
            connectionLog.log("Apple sign-in request failed: \(error.localizedDescription)", event: .auth, level: .error, route: .oscout)
        }
    }

    private static func formatPersonName(_ components: PersonNameComponents?) -> String? {
        guard let components else { return nil }
        let formatted = PersonNameComponentsFormatter()
            .string(from: components)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return formatted.isEmpty ? nil : formatted
    }

    private static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")
        var bytes = [UInt8](repeating: 0, count: length)
        for index in bytes.indices {
            bytes[index] = UInt8.random(in: 0...255)
        }
        return String(bytes.map { charset[Int($0) % charset.count] })
    }

    private func reconnectIfCurrentRouteWasDisabled(_ route: TransportKind, enabled: Bool) {
        guard !enabled, fleet.hasConnectedRoute(route) else { return }
        Task { await reconnect() }
    }

    func refreshTailnetPairTargets() async {
        guard !isRefreshingTailnetPairTargets else { return }
        isRefreshingTailnetPairTargets = true
        tailnetPairError = nil
        tailnetPairLogs = []
        logTailnetPair("Starting Tailnet discovery", level: .info)
        defer { isRefreshingTailnetPairTargets = false }

        if fleet.focusedClient.isConnected {
            do {
                let mesh = try await loadTailnetMeshStatusFromConnectedBridge()
                let targets = tailnetTargets(from: mesh)
                tailnetPairTargets = targets
                tailnetPairDiscoveryOrigin = "connected Mac"
                logTailnetPair(
                    "Found \(targets.filter(\.isOnline).count)/\(targets.count) online peer(s) via connected Mac",
                    level: targets.isEmpty ? .warning : .success
                )
                connectionLog.log(
                    "Tailnet repair found \(targets.filter(\.isOnline).count)/\(targets.count) online peer(s) via connected Mac over \(fleet.focusedClient.currentRoute.label)",
                    event: .network,
                    level: .info,
                    route: .tailnet
                )
                return
            } catch {
                logTailnetPair(
                    "Connected Mac mesh read failed: \(Self.compactError(error)); trying web origins",
                    level: .warning
                )
                connectionLog.log(
                    "Tailnet repair bridge mesh read failed; trying direct web origins: \(error.localizedDescription)",
                    event: .network,
                    level: .warning,
                    route: .tailnet
                )
            }
        }

        do {
            let (mesh, origin) = try await loadTailnetMeshStatus()
            let targets = tailnetTargets(from: mesh, preferredOrigin: origin.origin)
            tailnetPairTargets = targets
            tailnetPairDiscoveryOrigin = origin.origin.host
            logTailnetPair(
                "Found \(targets.filter(\.isOnline).count)/\(targets.count) online peer(s) via \(origin.displayName)",
                level: targets.isEmpty ? .warning : .success
            )
            connectionLog.log(
                "Tailnet repair found \(targets.filter(\.isOnline).count)/\(targets.count) online peer(s) via \(origin.displayName)",
                event: .network,
                level: .info,
                route: .tailnet
            )
        } catch {
            tailnetPairTargets = []
            tailnetPairError = error.localizedDescription
            logTailnetPair("Discovery failed: \(error.localizedDescription)", level: .error)
            connectionLog.log(
                "Tailnet repair discovery failed: \(error.localizedDescription)",
                event: .network,
                level: .warning,
                route: .tailnet
            )
        }
    }

    @discardableResult
    func pairWithTailnetTarget(_ target: TailnetPairTarget) async -> Bool {
        guard target.isOnline else {
            tailnetPairError = "\(target.displayName) is offline"
            logTailnetPair("\(target.displayName) is offline", level: .warning)
            return false
        }
        guard !target.pairLinks.isEmpty else {
            tailnetPairError = "No pair link for \(target.displayName)"
            logTailnetPair("No pair link for \(target.displayName)", level: .warning)
            return false
        }

        tailnetPairingTargetId = target.id
        tailnetPairError = nil
        defer { tailnetPairingTargetId = nil }

        connectionLog.log(
            "Tailnet repair pairing \(target.displayName) via \(target.dnsName)",
            event: .pairing,
            level: .info,
            route: .tailnet
        )
        logTailnetPair("Pairing \(target.displayName) via \(target.dnsName)", level: .info)
        for link in target.pairLinks {
            if await pairFromLink(link) {
                tailnetPairError = nil
                logTailnetPair("Paired \(target.displayName)", level: .success)
                return true
            }
        }
        tailnetPairError = "Pairing failed for \(target.displayName)"
        logTailnetPair("Pairing failed for \(target.displayName)", level: .error)
        return false
    }

    // MARK: - LAN pairing (same Wi-Fi, one tap)

    /// Browse the local network for Scout Macs advertising `_oscout-pair._tcp`.
    /// Cheap and idempotent; the Connect screen runs it on appear and offers a
    /// manual rescan. Finding nothing is not an error (the QR path stays).
    func refreshLanPairTargets() async {
        guard !isRefreshingLanPairTargets else { return }
        isRefreshingLanPairTargets = true
        lanPairError = nil
        defer { isRefreshingLanPairTargets = false }

        let macs = await BonjourMacDiscovery.discover()
        lanPairTargets = macs.map {
            LanPairTarget(
                id: $0.publicKeyHex,
                publicKeyHex: $0.publicKeyHex,
                fingerprint: $0.fingerprint,
                hostName: $0.hostName,
                relayPort: $0.relayPort,
                webPort: $0.webPort
            )
        }
        connectionLog.log(
            "LAN scan found \(macs.count) Scout Mac(s)",
            event: .discover,
            level: .info,
            route: .lan
        )
    }

    /// Pair with a Mac discovered on the LAN. Fetches the Mac's `/pair` endpoint
    /// over the local network; if pair mode is already live the endpoint hands
    /// back the payload immediately (302). Otherwise — the common case for an
    /// idle Mac — the endpoint registers an approval request and the Mac must
    /// allow it (initial pairing is trust-on-first-use, so a human gates it).
    /// We park on "Waiting for approval…" and poll until the Mac approves (the
    /// payload comes up) or declines, then run the standard handshake.
    @discardableResult
    func pairWithLanTarget(_ target: LanPairTarget) async -> Bool {
        lanPairingTargetId = target.id
        lanPairError = nil
        defer {
            lanPairingTargetId = nil
            lanPairAwaitingApproval = false
        }

        // Try the default web port first so the common case is a clean
        // connecting → connected with no transient failure flicker; fall back to
        // the bare-port / https variants only if that misses.
        let host = Self.cleanTailnetHost(target.hostName) ?? target.hostName
        let preferredPort = Self.normalizedScoutWebPort(target.webPort)
        let preferred = scoutWebOrigin(scheme: "http", host: host, port: preferredPort)
        let candidates = ([preferred].compactMap { $0 }) + scoutWebOriginCandidates(host: host, webPort: target.webPort)
        for origin in dedupeURLs(candidates) {
            guard let url = scoutWebURL(
                origin: origin,
                path: Self.scoutWebPairPath,
                queryItems: [URLQueryItem(name: "route", value: "lan")]
            ) else { continue }

            switch await resolveLanPairing(baseURL: url, target: target) {
            case .payload(let payload):
                // Reached the Mac and have a live payload — finish the handshake.
                // Don't fall through to other candidates regardless of outcome.
                if await completePair(source: "LAN", inputLength: nil, { payload }) {
                    lanPairError = nil
                    return true
                }
                return false
            case .denied:
                lanPairError = "\(target.displayName) declined the pairing request"
                return false
            case .failed(let message):
                lanPairError = message
                return false
            case .unreachable:
                continue // this origin didn't answer — try the next candidate
            }
        }
        lanPairError = "Couldn’t reach \(target.displayName) on your network"
        return false
    }

    private enum LanPairResolution {
        case payload(QRPayload)
        case denied
        case unreachable
        case failed(String)
    }

    /// One `/pair` request: either resolves to a payload now, or — when the Mac
    /// needs to approve — parks and polls until it does.
    private func resolveLanPairing(baseURL: URL, target: LanPairTarget) async -> LanPairResolution {
        switch await fetchLanPair(url: baseURL, token: nil) {
        case .redirect(let payload):
            return .payload(payload)
        case .pending(let token):
            return await pollLanPairing(baseURL: baseURL, token: token, target: target)
        case .denied:
            return .denied
        case .expired:
            return .failed("Pairing request expired before \(target.displayName) responded")
        case .unreachable:
            return .unreachable
        case .failed(let message):
            return .failed(message)
        }
    }

    private func pollLanPairing(baseURL: URL, token: String, target: LanPairTarget) async -> LanPairResolution {
        lanPairAwaitingApproval = true
        defer { lanPairAwaitingApproval = false }
        connectionLog.log(
            "Waiting for \(target.displayName) to approve pairing…",
            event: .pairing,
            level: .info,
            route: .lan
        )
        // Generous: a human has to walk to the Mac and approve. The server
        // touch-extends the request on each poll, so a long wait is safe.
        let deadline = Date().addingTimeInterval(300)
        while Date() < deadline {
            try? await Task.sleep(for: .milliseconds(1300))
            if Task.isCancelled { return .failed("Pairing cancelled") }
            switch await fetchLanPair(url: baseURL, token: token) {
            case .redirect(let payload):
                return .payload(payload)
            case .pending:
                continue
            case .denied:
                return .denied
            case .expired:
                return .failed("Pairing request expired — try pairing again")
            case .unreachable:
                return .failed("Lost connection to \(target.displayName)")
            case .failed(let message):
                return .failed(message)
            }
        }
        return .failed("Timed out waiting for approval on \(target.displayName)")
    }

    private enum LanPairFetch {
        case redirect(QRPayload)
        case pending(String) // polling token
        case denied
        case expired
        case unreachable
        case failed(String)
    }

    /// Single GET to `/pair` (optionally carrying a poll token). Recognises both
    /// the legacy 302→payload response and the approval-gated JSON protocol
    /// (`202 {status,token}` / `403 denied` / `410 expired`).
    private func fetchLanPair(url baseURL: URL, token: String?) async -> LanPairFetch {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return .failed("Invalid pairing URL")
        }
        if let token {
            var items = components.queryItems ?? []
            items.append(URLQueryItem(name: "token", value: token))
            components.queryItems = items
        }
        guard let url = components.url else { return .failed("Invalid pairing URL") }

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 8)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(deviceName, forHTTPHeaderField: "X-Scout-Device-Name")

        let delegate = PairingWebRedirectDelegate()
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            return .unreachable
        }

        // Live payload — the Mac handed us a `scout://pair?…` redirect.
        if let redirectURL = delegate.redirectURL ?? httpLocationRedirect(from: response, relativeTo: url),
           let payload = try? QRPayload.parse(fromLink: redirectURL.absoluteString) {
            return .redirect(payload)
        }

        guard let http = response as? HTTPURLResponse else { return .failed("No response from Mac") }

        // Approval-gated JSON protocol.
        if let parsed = try? JSONDecoder().decode(LanPairStatusResponse.self, from: data) {
            switch parsed.status {
            case "pending", "approved":
                if let resolved = parsed.token ?? token { return .pending(resolved) }
                return .failed("Pairing response missing token")
            case "denied":
                return .denied
            case "expired":
                return .expired
            default:
                break
            }
        }

        switch http.statusCode {
        case 403: return .denied
        case 410: return .expired
        case 404: return .unreachable // pairing not available here — try next candidate
        default: return .failed("Pairing unavailable on \(baseURL.host ?? "Mac") (\(http.statusCode))")
        }
    }

    func refreshOpenScoutNetworkPairTargets() async {
        guard !isRefreshingOpenScoutNetworkPairTargets else { return }
        isRefreshingOpenScoutNetworkPairTargets = true
        openScoutNetworkPairError = nil
        defer { isRefreshingOpenScoutNetworkPairTargets = false }

        do {
            let list = try await loadOpenScoutNetworkRendezvousList()
            let targets = openScoutNetworkPairingCandidates(from: list).map {
                OpenScoutNetworkPairTarget(candidate: $0)
            }
            openScoutNetworkPairTargets = targets
            connectionLog.log(
                "OpenScout Network found \(targets.count) mobile pairing target(s)",
                event: .discover,
                level: .info,
                route: .oscout
            )
        } catch {
            openScoutNetworkPairTargets = []
            openScoutNetworkPairError = error.localizedDescription
            connectionLog.log(
                "OpenScout Network discovery failed: \(error.localizedDescription)",
                event: .discover,
                level: .warning,
                route: .oscout
            )
        }
    }

    @discardableResult
    func pairWithOpenScoutNetworkTarget(_ target: OpenScoutNetworkPairTarget) async -> Bool {
        openScoutNetworkPairingTargetId = target.id
        openScoutNetworkPairError = nil
        defer { openScoutNetworkPairingTargetId = nil }

        openScoutNetworkRoutingEnabled = true
        BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(true)
        return await completePair(source: "OpenScout Network") {
            target.candidate.qrPayload
        }
    }

    private func loadOpenScoutNetworkRendezvousList() async throws -> OpenScoutMeshRendezvousList {
        guard let token = openScoutNetworkSessionToken,
              !token.isEmpty,
              isOpenScoutNetworkSignedIn
        else {
            throw OpenScoutNetworkPairingError.loginRequired
        }
        guard let url = Self.openScoutNetworkURL(
            path: Self.openScoutNetworkNodesPath,
            queryItems: [URLQueryItem(name: "meshId", value: Self.openScoutNetworkMeshId)]
        ) else {
            throw OpenScoutNetworkPairingError.invalidURL
        }

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 8)
        request.httpMethod = "GET"
        request.setValue(Self.openScoutNetworkAuthHeader(sessionToken: token), forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw OpenScoutNetworkPairingError.invalidResponse
        }
        switch http.statusCode {
        case 200:
            return try JSONDecoder().decode(OpenScoutMeshRendezvousList.self, from: data)
        case 401:
            signOutOpenScoutNetwork()
            throw OpenScoutNetworkPairingError.loginRequired
        default:
            throw OpenScoutNetworkPairingError.httpStatus(http.statusCode)
        }
    }

    private func loadTailnetMeshStatus() async throws -> (TailnetMeshStatusResponse, TailnetMeshOriginCandidate) {
        let origins = tailnetMeshOriginCandidates()
        guard !origins.isEmpty else {
            throw TailnetPairingError.noMeshOrigin
        }
        logTailnetPair("Checking \(origins.count) Scout web origin(s)", level: .info)

        var lastError: Error?
        for origin in origins {
            guard let url = scoutWebURL(origin: origin.origin, path: Self.scoutWebMeshPath) else { continue }
            logTailnetPair("GET \(origin.displayName)", level: .info)
            do {
                var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 12)
                request.httpMethod = "GET"
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw TailnetPairingError.invalidMeshResponse(origin: origin.origin.absoluteString)
                }
                guard (200..<300).contains(http.statusCode) else {
                    throw TailnetPairingError.meshHTTPStatus(origin: origin.origin.absoluteString, status: http.statusCode)
                }
                logTailnetPair("OK \(origin.displayName)", level: .success)
                return (try JSONDecoder().decode(TailnetMeshStatusResponse.self, from: data), origin)
            } catch {
                logTailnetPair("Miss \(origin.displayName): \(Self.compactError(error))", level: .warning)
                lastError = error
            }
        }

        throw lastError ?? TailnetPairingError.noMeshEndpoint(host: origins.map(\.host).joined(separator: ", "))
    }

    private func loadTailnetMeshStatusFromConnectedBridge() async throws -> MobileMeshStatusResponse {
        guard fleet.focusedClient.isConnected else {
            throw TailnetPairingError.noMeshOrigin
        }

        logTailnetPair(
            "Reading mesh status from connected Mac over \(fleet.focusedClient.currentRoute.label)",
            level: .info
        )
        return try await fleet.focusedClient.mobileMeshStatus()
    }

    private func tailnetMeshOriginCandidates() -> [TailnetMeshOriginCandidate] {
        var candidates: [TailnetMeshOriginCandidate] = []
        let webPort = fleet.focusedClient.savedWebPort

        func appendHost(_ rawHost: String?, source: String, route: TransportKind? = nil) {
            guard let host = Self.cleanTailnetHost(rawHost) else { return }
            let resolvedRoute = route ?? classifyTransport(host: host)
            guard resolvedRoute != .oscout else { return }
            for origin in scoutWebOriginCandidates(host: host, webPort: webPort) {
                candidates.append(TailnetMeshOriginCandidate(origin: origin, source: source, route: resolvedRoute))
            }
        }

        if let host = fleet.focusedClient.currentHost {
            appendHost(host, source: "current \(fleet.focusedClient.currentRoute.label)", route: fleet.focusedClient.currentRoute)
        }

        for relayURL in savedRouteSummary.allowedRelayURLs {
            guard let host = URLComponents(string: relayURL)?.host else { continue }
            let route = transportKind(forRelayURL: relayURL)
            switch route {
            case .lan, .tailnet, .loopback:
                appendHost(host, source: "saved \(route.label)", route: route)
            case .oscout, .remote, .none:
                continue
            }
        }

        var seen = Set<String>()
        return candidates.filter { candidate in
            let key = candidate.origin.absoluteString.lowercased()
            return seen.insert(key).inserted
        }
    }

    private func tailnetTargets(from mesh: TailnetMeshStatusResponse, preferredOrigin: URL) -> [TailnetPairTarget] {
        (mesh.tailscale?.peers ?? [])
            .compactMap { peer -> TailnetPairTarget? in
                tailnetTarget(
                    id: peer.id,
                    name: peer.name,
                    dnsName: peer.dnsName,
                    hostName: peer.hostName,
                    addresses: peer.addresses,
                    isOnline: peer.online,
                    os: peer.os,
                    preferredOrigin: preferredOrigin,
                    webPort: fleet.focusedClient.savedWebPort
                )
            }
            .sorted { a, b in
                if a.isOnline != b.isOnline { return a.isOnline && !b.isOnline }
                return a.displayName.localizedCaseInsensitiveCompare(b.displayName) == .orderedAscending
            }
    }

    private func tailnetTargets(from mesh: MobileMeshStatusResponse) -> [TailnetPairTarget] {
        (mesh.tailscale?.peers ?? [])
            .compactMap { peer -> TailnetPairTarget? in
                tailnetTarget(
                    id: peer.id,
                    name: peer.name,
                    dnsName: peer.dnsName,
                    hostName: peer.hostName,
                    addresses: peer.addresses,
                    isOnline: peer.online,
                    os: peer.os,
                    preferredOrigin: nil,
                    webPort: fleet.focusedClient.savedWebPort
                )
            }
            .sorted { a, b in
                if a.isOnline != b.isOnline { return a.isOnline && !b.isOnline }
                return a.displayName.localizedCaseInsensitiveCompare(b.displayName) == .orderedAscending
            }
    }

    private func tailnetTarget(
        id: String,
        name: String,
        dnsName rawDNSName: String?,
        hostName: String?,
        addresses: [String],
        isOnline: Bool,
        os: String?,
        preferredOrigin: URL?,
        webPort: Int?
    ) -> TailnetPairTarget? {
        guard let dnsName = Self.cleanTailnetHost(rawDNSName) else { return nil }
        let pairLinks = scoutWebOriginCandidates(host: dnsName, preferredOrigin: preferredOrigin, webPort: webPort)
            .compactMap { scoutWebURL(origin: $0, path: Self.scoutWebPairPath, queryItems: [
                URLQueryItem(name: "route", value: "tsn")
            ])?.absoluteString }
        return TailnetPairTarget(
            id: id,
            name: name,
            dnsName: dnsName,
            hostName: hostName,
            addresses: addresses,
            isOnline: isOnline,
            os: os,
            pairLinks: pairLinks
        )
    }

    private func scoutWebOriginCandidates(host: String, preferredOrigin: URL? = nil, webPort: Int? = nil) -> [URL] {
        var candidates: [URL] = []
        let resolvedWebPort = Self.normalizedScoutWebPort(webPort)
        if let preferredOrigin,
           let scheme = preferredOrigin.scheme {
            candidates.append(contentsOf: [
                scoutWebOrigin(scheme: scheme, host: host, port: preferredOrigin.port),
                scoutWebOrigin(scheme: scheme, host: host, port: resolvedWebPort),
            ].compactMap { $0 })
        }
        candidates.append(contentsOf: [
            scoutWebOrigin(scheme: "http", host: host, port: resolvedWebPort),
            scoutWebOrigin(scheme: "https", host: host, port: resolvedWebPort),
            scoutWebOrigin(scheme: "http", host: host, port: nil),
            scoutWebOrigin(scheme: "https", host: host, port: nil),
        ].compactMap { $0 })
        return dedupeURLs(candidates)
    }

    private static func normalizedScoutWebPort(_ port: Int?) -> Int {
        guard let port, (1...65_535).contains(port) else { return defaultScoutWebPort }
        return port
    }

    private func scoutWebOrigin(scheme: String, host: String, port: Int?) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = port
        return components.url
    }

    private func scoutWebURL(origin: URL, path: String, queryItems: [URLQueryItem] = []) -> URL? {
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)
        components?.path = path
        components?.queryItems = queryItems.isEmpty ? nil : queryItems
        return components?.url
    }

    private func dedupeURLs(_ urls: [URL]) -> [URL] {
        var seen = Set<String>()
        var output: [URL] = []
        for url in urls {
            let key = url.absoluteString.lowercased()
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            output.append(url)
        }
        return output
    }

    private func logTailnetPair(_ message: String, level: ConnectionLogLevel) {
        tailnetPairLogCounter += 1
        tailnetPairLogs.append(
            TailnetPairLogEntry(
                id: tailnetPairLogCounter,
                tsMs: Int64(Date().timeIntervalSince1970 * 1000),
                level: level,
                message: message
            )
        )
        if tailnetPairLogs.count > 24 {
            tailnetPairLogs.removeFirst(tailnetPairLogs.count - 24)
        }
    }

    private nonisolated static func compactError(_ error: Error) -> String {
        if let urlError = error as? URLError {
            return urlError.localizedDescription
        }
        return error.localizedDescription
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

    /// A reload signal for fleet-wide surfaces (the Agents "All" stack): bumps on
    /// ANY paired Mac's connection change, not just the focused one (which is all
    /// `dataReadyToken` tracks). Without it, a Mac that finishes connecting in the
    /// background wouldn't show up in an aggregated list until something else
    /// nudged a reload.
    var fleetRevision: Int { machinesRevision }

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
        await refreshOpenScoutNetworkRoutesForTrustedMachines()
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

    /// Point the fleet surfaces at one Mac or the whole fleet. Picking a specific
    /// Mac also focuses/binds it (single-client surfaces + the status bar follow);
    /// picking All only changes what the lists aggregate — the bound Mac stays put.
    /// `machineFilter` is observed, so the Agents stack reloads off the change.
    func selectMachineFilter(_ filter: MachineFilter) async {
        machineFilter = filter
        if case .machine(let id) = filter {
            await connect(toMachineId: id)
        }
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
        await completePair(source: "scanned QR", inputLength: scanned.count) { try QRPayload.parse(from: scanned) }
    }

    /// Pair from a camera-free pairing link — a pasted payload or a
    /// `scout://pair?…` deep link. Same payload as the QR.
    @discardableResult
    func pairFromLink(_ link: String) async -> Bool {
        await completePair(source: "pairing link", inputLength: link.count) { try await parsePairingPayload(fromLink: link) }
    }

    /// App-level URL router for the shared `scout://` scheme. Auth links are
    /// consumed here; everything else falls through to the existing pair parser.
    @discardableResult
    func handleDeepLink(_ url: URL) async -> Bool {
        if handleOpenScoutNetworkAuthCallback(url) {
            return true
        }
        return await pairFromLink(url.absoluteString)
    }

    private func handleOpenScoutNetworkAuthCallback(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "scout"
        else {
            return false
        }
        let host = components.host?.lowercased()
        let path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
        guard host == "osn-auth" || path == "osn-auth" else {
            return false
        }

        let items = components.queryItems ?? []
        func value(_ key: String) -> String? { items.first { $0.name == key }?.value?.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard let session = value("session"), !session.isEmpty,
              let expiresAtRaw = value("expires_at"),
              let expiresAtMs = Double(expiresAtRaw)
        else {
            connectionLog.log("OpenScout Network auth callback missing session fields", event: .auth, level: .error, route: .oscout)
            return true
        }

        guard let expiresAt = ScoutTimestamp.date(fromEpoch: expiresAtMs) else {
            connectionLog.log("OpenScout Network auth callback had invalid expiry", event: .auth, level: .error, route: .oscout)
            return true
        }
        guard expiresAt > Date() else {
            connectionLog.log("OpenScout Network auth callback was already expired", event: .auth, level: .error, route: .oscout)
            return true
        }

        applyOpenScoutNetworkSession(token: session, expiresAtMs: expiresAtMs, source: "github")
        return true
    }

    /// Persist an OSN session (Keychain + routing prefs) and kick a pair-target
    /// refresh. Shared by the GitHub `scout://osn-auth` deep link and the native
    /// Sign in with Apple flow.
    private func applyOpenScoutNetworkSession(token: String, expiresAtMs: Double, source: String) {
        let expiresAt = Date(timeIntervalSince1970: expiresAtMs / 1000)
        do {
            try ScoutIdentity.saveOSNSessionToken(token)
            UserDefaults.standard.set(expiresAtMs, forKey: Self.openScoutNetworkAuthExpiresAtKey)
            openScoutNetworkSessionToken = token
            openScoutNetworkAuthExpiresAt = expiresAt
            openScoutNetworkRoutingEnabled = true
            BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(true)
            connectionLog.log("OpenScout Network login saved (\(source))", event: .auth, level: .success, route: .oscout)
            Task { await refreshOpenScoutNetworkPairTargets() }
        } catch {
            connectionLog.log("OpenScout Network auth save failed: \(error.localizedDescription)", event: .auth, level: .error, route: .oscout)
        }
    }

    /// Shared pairing tail: build the payload, run the XX handshake, and land in
    /// the shell on success. The `makePayload` closure is the only difference
    /// between the QR and link entry points.
    @discardableResult
    private func completePair(source channel: String, inputLength: Int? = nil, _ makePayload: () async throws -> QRPayload) async -> Bool {
        resetReconnectState()
        backgroundFleetConnectTask?.cancel()
        connectionState = .connecting
        connectionLog.log("Pairing from \(channel)…", event: .pairing, level: .info)
        do {
            let pairingBridge = BridgeBrokerClient(connectionLog: ConnectionLogHandle(connectionLog))
            let payload: QRPayload
            do {
                payload = try await makePayload()
                let remaining = Int(payload.secondsRemaining.rounded(.down))
                connectionLog.log(
                    "Pairing payload parsed: room=\(payload.room) relay=\(payload.relay) fallbacks=\(payload.fallbackRelays?.count ?? 0) expiresIn=\(remaining)s key=\(String(payload.publicKey.prefix(16)))...",
                    event: .pairing,
                    route: transportKind(forRelayURL: payload.relay)
                )
            } catch {
                connectionLog.log(
                    "Pairing payload parse failed: len=\(inputLength.map(String.init) ?? "?") error=\(error.localizedDescription)",
                    event: .pairing,
                    level: .error
                )
                throw error
            }
            try await pairingBridge.pair(qrPayload: payload, primaryName: deviceName)
            let route = pairingBridge.currentRoute
            if route == .oscout {
                openScoutNetworkRoutingEnabled = true
                BridgeRoutePreferences.setOpenScoutNetworkRoutingEnabled(true)
            }
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

    private func parsePairingPayload(fromLink link: String) async throws -> QRPayload {
        do {
            return try QRPayload.parse(fromLink: link)
        } catch {
            guard let url = pairingWebURL(from: link) else {
                throw error
            }
            return try await resolvePairingWebLink(url, originalError: error)
        }
    }

    private func pairingWebURL(from link: String) -> URL? {
        let trimmed = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              components.host?.isEmpty == false,
              components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == "pair"
        else {
            return nil
        }
        return components.url
    }

    private func resolvePairingWebLink(_ url: URL, originalError: Error) async throws -> QRPayload {
        connectionLog.log(
            "Resolving pairing web link: \(url.host ?? "unknown")\(url.path)",
            event: .pairing,
            level: .info
        )

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 8)
        request.httpMethod = "GET"

        let delegate = PairingWebRedirectDelegate()
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        let response: URLResponse
        do {
            (_, response) = try await session.data(for: request)
        } catch {
            connectionLog.log(
                "Pairing web link resolve failed: \(error.localizedDescription)",
                event: .pairing,
                level: .error
            )
            throw error
        }

        let redirectURL = delegate.redirectURL ?? httpLocationRedirect(from: response, relativeTo: url)
        guard let redirectURL else {
            throw originalError
        }

        connectionLog.log(
            "Pairing web link redirected: \(redirectURL.scheme ?? "unknown")://\(redirectURL.host ?? redirectURL.path)",
            event: .pairing,
            level: .info
        )
        return try QRPayload.parse(fromLink: redirectURL.absoluteString)
    }

    private func httpLocationRedirect(from response: URLResponse, relativeTo baseURL: URL) -> URL? {
        guard let http = response as? HTTPURLResponse,
              (300..<400).contains(http.statusCode),
              let location = http.value(forHTTPHeaderField: "Location")
        else {
            return nil
        }
        return URL(string: location, relativeTo: baseURL)?.absoluteURL
    }

    private var deviceName: String {
        #if canImport(UIKit)
        return UIDevice.current.name
        #else
        return "Scout"
        #endif
    }

    private func loadOpenScoutNetworkSession() {
        let expiresAtMs = UserDefaults.standard.double(forKey: Self.openScoutNetworkAuthExpiresAtKey)
        let loadedToken = (try? ScoutIdentity.loadOSNSessionToken()) ?? nil
        guard let token = loadedToken,
              token.isEmpty == false,
              expiresAtMs > 0
        else {
            openScoutNetworkSessionToken = nil
            openScoutNetworkAuthExpiresAt = nil
            return
        }
        guard let expiresAt = ScoutTimestamp.date(fromEpoch: expiresAtMs) else {
            try? ScoutIdentity.deleteOSNSessionToken()
            UserDefaults.standard.removeObject(forKey: Self.openScoutNetworkAuthExpiresAtKey)
            openScoutNetworkSessionToken = nil
            openScoutNetworkAuthExpiresAt = nil
            return
        }
        guard expiresAt > Date() else {
            try? ScoutIdentity.deleteOSNSessionToken()
            UserDefaults.standard.removeObject(forKey: Self.openScoutNetworkAuthExpiresAtKey)
            openScoutNetworkSessionToken = nil
            openScoutNetworkAuthExpiresAt = nil
            return
        }
        openScoutNetworkSessionToken = token
        openScoutNetworkAuthExpiresAt = expiresAt
    }

    private static func openScoutNetworkAuthStartURL() -> URL? {
        openScoutNetworkURL(
            path: openScoutNetworkAuthStartPath,
            queryItems: [
                URLQueryItem(name: "return_to", value: openScoutNetworkNativeReturnToPath),
            ]
        )
    }

    private static func openScoutNetworkURL(path: String, queryItems: [URLQueryItem] = []) -> URL? {
        guard let base = URL(string: openScoutNetworkFrontDoorBaseURL),
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        else {
            return nil
        }
        components.path = path
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        return components.url
    }

    private static func openScoutNetworkAuthHeader(sessionToken: String) -> String {
        if sessionToken.hasPrefix("osn_session_") {
            return "Bearer \(sessionToken)"
        }
        return "Bearer osn_session_\(sessionToken)"
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
        case .connecting: return ScoutInk.muted
        case .failed: return HudPalette.statusError
        case .idle: return ScoutInk.muted
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

    /// A machine the Agents surface renders under the active filter, paired with
    /// its live client for reads + routing. Offline Macs come through with
    /// `client == nil` so the surface can show them collapsed rather than dropping
    /// them — we still surface every Mac we know about.
    struct AgentMachine: Identifiable {
        let id: String
        let name: String
        let isOnline: Bool
        let lastSeen: Date?
        let connectionState: ConnectionState
        let client: (any ScoutBrokerClient)?
    }

    /// Machines the Agents surface should query, honoring `machineFilter`. `.all`
    /// returns every paired Mac (online ones first, each carrying a live client;
    /// offline ones clientless, for a collapsed row); `.machine(id)` narrows to one.
    /// Online leads so the stack opens on live work, with recency preserved inside
    /// each group.
    func agentMachines() -> [AgentMachine] {
        let scoped: [PairedMachine]
        switch machineFilter {
        case .all:
            scoped = pairedMachines
        case .machine(let id):
            scoped = pairedMachines.filter { $0.id == id.lowercased() }
        }
        let online = scoped.filter(\.isOnline)
        let offline = scoped.filter { !$0.isOnline }
        return (online + offline).map { m in
            AgentMachine(
                id: m.id,
                name: m.name,
                isOnline: m.isOnline,
                lastSeen: m.lastSeen,
                connectionState: m.connectionState,
                client: m.isOnline ? fleet.connectedClient(machineId: m.id) : nil
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
    nonisolated static func prettyMachineName(_ raw: String) -> String {
        let isIP = raw.contains(".") && raw.split(separator: ".").allSatisfy { UInt($0) != nil }
        let label = isIP ? raw : (raw.split(separator: ".").first.map(String.init) ?? raw)
        return label.replacingOccurrences(of: "-", with: " ")
    }

    private nonisolated static func cleanTailnetHost(_ raw: String?) -> String? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "."))
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

    private func refreshOpenScoutNetworkRoutesForTrustedMachines() async {
        guard openScoutNetworkRoutingEnabled, isOpenScoutNetworkSignedIn else {
            return
        }

        let trustedIds = trustedMachineIds
        let trustedKeys = Set(trustedIds.map { $0.lowercased() })
        guard !trustedKeys.isEmpty else { return }

        do {
            let list = try await loadOpenScoutNetworkRendezvousList()
            let candidates = openScoutNetworkPairingCandidates(from: list)
            var refreshedKeys = Set<String>()
            let preferredKey = preferredFocusMachineId(in: trustedIds)?.lowercased()
            let activeKey = BridgeBrokerClient.activeConnectionPublicKeyHex()?.lowercased()
            let focusedKey = fleet.focusedMachineId?.lowercased()

            for candidate in candidates {
                let key = candidate.entrypoint.publicKey.lowercased()
                guard trustedKeys.contains(key) else { continue }
                let shouldPromote = key == preferredKey
                    || key == activeKey
                    || key == focusedKey
                BridgeBrokerClient.savePairingConnectionInfo(
                    qrPayload: candidate.qrPayload,
                    promoteActive: shouldPromote
                )
                refreshedKeys.insert(key)
            }

            guard !refreshedKeys.isEmpty else {
                connectionLog.log(
                    "OpenScout Network found no current route for paired Mac keys",
                    event: .discover,
                    level: .warning,
                    route: .oscout
                )
                return
            }

            connectionLog.log(
                "OpenScout Network refreshed \(refreshedKeys.count) paired Mac route(s)",
                event: .discover,
                level: .success,
                route: .oscout
            )
        } catch {
            connectionLog.log(
                "OpenScout Network route refresh failed: \(error.localizedDescription)",
                event: .discover,
                level: .warning,
                route: .oscout
            )
        }
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

private final class PairingWebRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var storedRedirectURL: URL?

    var redirectURL: URL? {
        lock.withLock { storedRedirectURL }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        lock.withLock {
            storedRedirectURL = request.url
        }
        return nil
    }
}

/// `/pair` approval-gated response body (`202`/`403`/`410`). The payload itself
/// arrives as a `scout://pair?…` redirect, not in this JSON.
private struct LanPairStatusResponse: Decodable {
    let status: String
    let token: String?
    let pollAfterMs: Int?
}

private struct TailnetMeshStatusResponse: Decodable {
    let tailscale: TailnetMeshTailscale?
}

private struct TailnetMeshTailscale: Decodable {
    let peers: [TailnetMeshPeer]
}

private struct TailnetMeshPeer: Decodable {
    let id: String
    let name: String
    let dnsName: String?
    let hostName: String?
    let addresses: [String]
    let online: Bool
    let os: String?
}

private struct TailnetMeshOriginCandidate: Equatable {
    let origin: URL
    let source: String
    let route: TransportKind

    var host: String { origin.host ?? origin.absoluteString }
    var displayName: String {
        let routeLabel = route.label.isEmpty ? "WEB" : route.label
        let port = origin.port.map { ":\($0)" } ?? ""
        return "\(host)\(port) · \(source) · \(routeLabel)"
    }
}

private enum OpenScoutNetworkPairingError: LocalizedError {
    case loginRequired
    case invalidURL
    case invalidResponse
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .loginRequired:
            return "OpenScout Network login required"
        case .invalidURL:
            return "OpenScout Network URL is invalid"
        case .invalidResponse:
            return "Invalid OpenScout Network response"
        case .httpStatus(let status):
            return "OpenScout Network returned HTTP \(status)"
        }
    }
}

private enum TailnetPairingError: LocalizedError {
    case noMeshOrigin
    case noMeshEndpoint(host: String)
    case invalidMeshResponse(origin: String)
    case meshHTTPStatus(origin: String, status: Int)

    var errorDescription: String? {
        switch self {
        case .noMeshOrigin:
            return "No saved Mac web route is available for Tailnet discovery"
        case .noMeshEndpoint(let host):
            return "No Scout web mesh endpoint responded on \(host)"
        case .invalidMeshResponse(let origin):
            return "Invalid mesh response from \(origin)"
        case .meshHTTPStatus(let origin, let status):
            return "Mesh endpoint \(origin) returned HTTP \(status)"
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

    /// The live client for a machine, or nil when it isn't connected. Unlike the
    /// private `client(for:)`, this never spins up a new client — it's for
    /// read-side aggregation across the already-connected fleet (the "All" filter).
    func connectedClient(machineId: String) -> BridgeBrokerClient? {
        let key = machineId.lowercased()
        guard let client = clients[key], case .connected = states[key] else { return nil }
        return client
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
