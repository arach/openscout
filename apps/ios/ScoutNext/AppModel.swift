import SwiftUI
import HudsonUI
import HudsonVoice
import ScoutCapabilities
import ScoutIOSCore
#if canImport(UIKit)
import UIKit
#endif

/// App-level state for ScoutNext: the live encrypted `BridgeBrokerClient`, the
/// connection lifecycle, and the shared `ConnectionLog` that records which
/// transport path (LAN / TSN / OSN) was attempted and won. There is no offline
/// data mode — you're either connected to your Mac or you're in the shell with
/// empty surfaces (so Settings stays reachable while unpaired).
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

    let bridge: BridgeBrokerClient
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

    private static let voicePrefKey = "scoutnext.voicePreference"

    init() {
        let log = ConnectionLog()
        connectionLog = log
        bridge = BridgeBrokerClient(connection: BridgeConnection(connectionLog: ConnectionLogHandle(log)))
        lanRoutingEnabled = BridgeRoutePreferences.lanRoutingEnabled()
        tailnetRoutingEnabled = BridgeRoutePreferences.tailnetRoutingEnabled()
        openScoutNetworkRoutingEnabled = BridgeRoutePreferences.openScoutNetworkRoutingEnabled()
        if let raw = UserDefaults.standard.string(forKey: Self.voicePrefKey),
           let pref = HudDictation.Preference(rawValue: raw) {
            dictation.preference = pref
        }
    }

    /// Persist + apply the user's transcription-engine choice.
    func setVoicePreference(_ pref: HudDictation.Preference) {
        dictation.preference = pref
        UserDefaults.standard.set(pref.rawValue, forKey: Self.voicePrefKey)
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
        guard !enabled, case .connected(let currentRoute) = connectionState, currentRoute == route else { return }
        Task { await reconnect() }
    }

    /// The client every surface consumes.
    var client: any ScoutBrokerClient { bridge }

    /// Refresh the fleet rollup shown in the status bar. A cheap directory read;
    /// callers poll it while the shell is up so `active` stays roughly live.
    func refreshFleetStats() async {
        let agents = (try? await client.listAgents(query: nil, limit: 200)) ?? []
        agentCount = agents.count
        activeAgentCount = agents.filter { $0.state == .live }.count
    }

    /// Saved route inventory for the active pairing. This is route metadata, not
    /// a network probe.
    var savedRouteSummary: BridgeRouteSummary { bridge.savedRouteSummary }

    /// A value that changes when a surface should (re)load its data: the bridge
    /// becomes ready only once connected. Surfaces key their load `.task(id:)` on
    /// this so a list that loaded empty mid-handshake reloads the moment the
    /// connection lands. Disconnected → 0 → surfaces show their empty states.
    var dataReadyToken: Int {
        if case .connected = connectionState { return 1 }
        return 0
    }

    /// The host the live bridge reached the Mac through — the SSH target for the
    /// in-app Terminal when the route is direct (the host IS the Mac). nil on a
    /// relay route (`.remote`), where the bridge host isn't the Mac, so the
    /// Terminal falls back to the broker's advertised `.local` name.
    var terminalSSHHost: String? {
        guard case .connected(let route) = connectionState else { return nil }
        switch route {
        case .lan, .tailnet, .oscout, .loopback: return bridge.currentHost
        case .remote, .none: return nil
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

    /// Attempt to connect the live bridge. Unpaired is reported (the Connect
    /// screen / status chip own the pairing entry point); this never
    /// force-presents the camera.
    func connectIfNeeded() async {
        if connectionState == .connecting { return }
        guard hasTrustedBridge else {
            connectionState = .failed("No bridge paired")
            connectionLog.log("No paired bridge — scan the QR on your Mac to pair", event: .trust, level: .warning)
            return
        }
        connectionState = .connecting
        connectionLog.log("Connecting to paired Mac…", level: .info)
        do {
            try await bridge.connect()
            let route = bridge.currentRoute
            connectionState = .connected(route)
            connectionLog.log("Connected via \(route.label)", event: .connected, level: .success, route: route)
        } catch {
            connectionState = .failed(error.localizedDescription)
            connectionLog.log("Connection failed: \(error.localizedDescription)", event: .routeUnavailable, level: .error)
        }
    }

    func reconnect() async {
        bridge.disconnect()
        connectionState = .idle
        await connectIfNeeded()
    }

    /// Pair from a scanned QR string, then stay connected. Returns true on success.
    @discardableResult
    func pair(scanned: String) async -> Bool {
        await completePair(source: "scanned QR") { try QRPayload.parse(from: scanned) }
    }

    /// Pair from a camera-free pairing link — a pasted payload or a
    /// `scoutnext://pair?…` deep link. Same payload as the QR.
    @discardableResult
    func pairFromLink(_ link: String) async -> Bool {
        await completePair(source: "pairing link") { try QRPayload.parse(fromLink: link) }
    }

    /// Shared pairing tail: build the payload, run the XX handshake, and land in
    /// the shell on success. The `makePayload` closure is the only difference
    /// between the QR and link entry points.
    @discardableResult
    private func completePair(source channel: String, _ makePayload: () throws -> QRPayload) async -> Bool {
        connectionState = .connecting
        connectionLog.log("Pairing from \(channel)…", event: .pairing, level: .info)
        do {
            let payload = try makePayload()
            try await bridge.pair(qrPayload: payload, primaryName: deviceName)
            let route = bridge.currentRoute
            connectionState = .connected(route)
            connectionLog.log("Paired & connected via \(route.label)", event: .connected, level: .success, route: route)
            phase = .shell
            showPairing = false
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
        return "ScoutNext"
        #endif
    }

    // MARK: - Status presentation

    /// Short label for the title-bar status chip.
    var statusLabel: String {
        switch connectionState {
        case .idle: return "not connected"
        case .connecting: return "connecting…"
        case .connected(let route): return route.label.isEmpty ? "connected" : route.label
        case .failed: return "disconnected"
        }
    }

    var statusTint: Color {
        switch connectionState {
        case .connected: return HudPalette.accent
        case .connecting: return HudPalette.muted
        case .failed: return HudPalette.statusError
        case .idle: return HudPalette.muted
        }
    }

    var statusPulses: Bool {
        if case .connecting = connectionState { return true }
        return false
    }

    // MARK: - Paired machines

    /// One paired base machine for the Home machine-rail. `isActive` is the one
    /// we're currently connected to (it alone knows its live `route`); the rest
    /// are paired-but-idle, shown with a last-seen rather than a faked live state.
    struct PairedMachine: Identifiable, Equatable {
        let id: String          // public-key hex
        let name: String
        let lastSeen: Date?
        let isActive: Bool
        let route: TransportKind?
    }

    /// Trusted bridges as rail chips, most-recently-seen first. Until we probe
    /// each machine / connect to several at once, only the active one reports a
    /// live route — the others carry last-seen, not a fabricated reachability.
    var pairedMachines: [PairedMachine] {
        let records = (try? ScoutIdentity.getTrustedBridges()) ?? []
        let activeHex = activeMachineHex
        return records
            .sorted { ($0.lastSeen ?? $0.pairedAt) > ($1.lastSeen ?? $1.pairedAt) }
            .map { record in
                let isActive = record.publicKeyHex == activeHex
                var route: TransportKind?
                if isActive, case .connected(let r) = connectionState { route = r }
                // Prefer the Mac's live advertised host for the active machine —
                // the stored record name can be stale (older pairs saved the
                // phone's name). Fall back to the record, then a generic label.
                let rawName = (isActive ? bridge.currentHost : nil) ?? record.name
                return PairedMachine(
                    id: record.publicKeyHex,
                    name: rawName.map(Self.prettyMachineName) ?? "Mac",
                    lastSeen: record.lastSeen,
                    isActive: isActive,
                    route: route
                )
            }
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

    /// Heuristic for "which trusted bridge are we connected to": the most-recently
    /// touched one (connect bumps its `lastSeen`). Exact once we target a specific
    /// bridge by key; fine while there's a single active connection.
    private var activeMachineHex: String? {
        guard case .connected = connectionState else { return nil }
        let bridges = (try? ScoutIdentity.getTrustedBridges()) ?? []
        return bridges.max { ($0.lastSeen ?? $0.pairedAt) < ($1.lastSeen ?? $1.pairedAt) }?.publicKeyHex
    }
}
