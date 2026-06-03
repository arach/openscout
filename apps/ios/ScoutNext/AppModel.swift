import SwiftUI
import HudsonUI
import ScoutCapabilities
import ScoutIOSCore
#if canImport(UIKit)
import UIKit
#endif

/// App-level state for ScoutNext: which data source is active (the live
/// encrypted `BridgeBrokerClient` or the offline `MockBrokerClient`), the
/// connection lifecycle, and the shared `ConnectionLog` that records which
/// transport path (LAN / TSN / OSN) was attempted and won.
@MainActor
@Observable
final class AppModel {
    enum Source: String, CaseIterable, Identifiable {
        case bridge = "Bridge"
        case mock = "Mock"
        var id: String { rawValue }
    }

    enum ConnectionState: Equatable {
        case idle
        case connecting
        case connected(TransportKind)
        case failed(String)
    }

    /// Top-level navigation gate. `connect` is the first-run screen (a single
    /// pair CTA + an offline escape hatch); `shell` is the tab app. We never
    /// drop straight into the camera — pairing is always a deliberate tap.
    enum Phase: Equatable {
        case connect
        case shell
    }

    var source: Source = .bridge
    var phase: Phase = .connect
    var connectionState: ConnectionState = .idle
    var showPairing = false

    let bridge: BridgeBrokerClient
    let mock = MockBrokerClient()
    let connectionLog: ConnectionLog

    init() {
        let log = ConnectionLog()
        connectionLog = log
        bridge = BridgeBrokerClient(connection: BridgeConnection(connectionLog: ConnectionLogHandle(log)))
    }

    /// The client every surface consumes. Swapping source re-keys the surfaces.
    var client: any ScoutBrokerClient { source == .bridge ? bridge : mock }

    /// A value that changes when a surface should (re)load its data: mock is
    /// always ready; the bridge becomes ready only once connected. Surfaces key
    /// their load `.task(id:)` on this so a list that loaded empty mid-handshake
    /// reloads the moment the connection lands.
    var dataReadyToken: Int {
        switch source {
        case .mock: return 1
        case .bridge:
            if case .connected = connectionState { return 1 }
            return 0
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

    /// Skip pairing for now and explore the app on offline mock data. The status
    /// chip still routes back to pairing whenever the operator is ready.
    func exploreOffline() {
        source = .mock
        phase = .shell
    }

    /// Attempt to connect the live bridge. No-op on the mock source. Unpaired is
    /// reported (the Connect screen / status chip own the pairing entry point);
    /// this never force-presents the camera.
    func connectIfNeeded() async {
        guard source == .bridge else { return }
        if connectionState == .connecting { return }
        guard hasTrustedBridge else {
            connectionState = .failed("No bridge paired")
            connectionLog.log("No paired bridge — scan the QR on your Mac to pair", level: .warning)
            return
        }
        connectionState = .connecting
        connectionLog.log("Connecting to paired Mac…", level: .info)
        do {
            try await bridge.connect()
            let route = bridge.currentRoute
            connectionState = .connected(route)
            connectionLog.log("Connected via \(route.label)", level: .success, route: route)
        } catch {
            connectionState = .failed(error.localizedDescription)
            connectionLog.log("Connection failed: \(error.localizedDescription)", level: .error)
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
        connectionLog.log("Pairing from \(channel)…", level: .info)
        do {
            let payload = try makePayload()
            try await bridge.pair(qrPayload: payload, primaryName: deviceName)
            let route = bridge.currentRoute
            connectionState = .connected(route)
            connectionLog.log("Paired & connected via \(route.label)", level: .success, route: route)
            source = .bridge
            phase = .shell
            showPairing = false
            return true
        } catch {
            connectionState = .failed(error.localizedDescription)
            connectionLog.log("Pairing failed: \(error.localizedDescription)", level: .error)
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

    func switchTo(_ newSource: Source) {
        guard newSource != source else { return }
        source = newSource
        if newSource == .bridge { Task { await connectIfNeeded() } }
    }

    // MARK: - Status presentation

    /// Short label for the title-bar status chip.
    var statusLabel: String {
        switch source {
        case .mock: return "offline mock"
        case .bridge:
            switch connectionState {
            case .idle: return "not connected"
            case .connecting: return "connecting…"
            case .connected(let route): return route.label.isEmpty ? "connected" : route.label
            case .failed: return "disconnected"
            }
        }
    }

    var statusTint: Color {
        switch source {
        case .mock: return HudPalette.statusWarn
        case .bridge:
            switch connectionState {
            case .connected: return HudPalette.accent
            case .connecting: return HudPalette.muted
            case .failed: return HudPalette.statusError
            case .idle: return HudPalette.muted
            }
        }
    }

    var statusPulses: Bool {
        if case .connecting = connectionState, source == .bridge { return true }
        return false
    }
}
