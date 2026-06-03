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

    var source: Source = .bridge
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

    /// True once at least one bridge has been paired (keychain-backed).
    var hasTrustedBridge: Bool {
        ((try? ScoutIdentity.getTrustedBridges()) ?? []).isEmpty == false
    }

    /// Attempt to connect the live bridge. No-op on the mock source. If nothing
    /// is paired yet, surface the pairing flow instead of failing silently.
    func connectIfNeeded() async {
        guard source == .bridge else { return }
        if connectionState == .connecting { return }
        guard hasTrustedBridge else {
            connectionState = .failed("No bridge paired")
            connectionLog.log("No paired bridge — scan the QR on your Mac to pair", level: .warning)
            showPairing = true
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
        connectionState = .connecting
        connectionLog.log("Pairing from scanned QR…", level: .info)
        do {
            let payload = try QRPayload.parse(from: scanned)
            try await bridge.pair(qrPayload: payload, primaryName: deviceName)
            let route = bridge.currentRoute
            connectionState = .connected(route)
            connectionLog.log("Paired & connected via \(route.label)", level: .success, route: route)
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
