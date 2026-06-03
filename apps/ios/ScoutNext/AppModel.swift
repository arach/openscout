import SwiftUI
import HudsonUI
import ScoutCapabilities
import ScoutIOSCore

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

    /// Attempt to connect the live bridge. No-op on the mock source.
    func connectIfNeeded() async {
        guard source == .bridge else { return }
        if connectionState == .connecting { return }
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
